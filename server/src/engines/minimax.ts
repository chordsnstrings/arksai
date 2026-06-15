import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';

/**
 * MiniMax engine: the capabilities DeepSeek (text-only) lacks — vision, image
 * generation, text-to-speech, and video. Each is gated on MINIMAX_API_KEY and
 * surfaced to the agent as a tool, so the orchestrator calls the right one for
 * the task.
 *
 * NOTE: the request shapes follow MiniMax's documented OpenAI-compatible /
 * platform APIs but could NOT be validated from the build sandbox (egress is
 * blocked). They fail gracefully (return {ok:false, error}) so a wrong shape
 * surfaces to the agent/user instead of crashing — validate + adjust on the
 * Droplet. Model ids and the base URL are env-overridable.
 */

const base = () => config.minimaxBaseUrl.replace(/\/$/, '');
// M3 only behaves on the Anthropic-compatible surface (on the OpenAI `/v1` surface its
// thinking is forced on + unbounded → it stalls). Derive the Anthropic base from the /v1 base.
const anthropicBase = () => config.minimaxBaseUrl.replace(/\/v1\/?$/, '').replace(/\/$/, '') + '/anthropic';
const authHeaders = () => ({
  Authorization: `Bearer ${config.minimaxApiKey}`,
  'Content-Type': 'application/json',
});

export interface EngineFile {
  path: string; // workspace-relative
  kind: 'image' | 'audio' | 'video';
}
export interface EngineResult {
  ok: boolean;
  files: EngineFile[];
  text?: string;
  error?: string;
}

function ensureDir(repoDir: string, sub: string): string {
  const dir = path.join(repoDir, sub);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function downloadTo(url: string, absPath: string, signal: AbortSignal): Promise<boolean> {
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return false;
    fs.writeFileSync(absPath, Buffer.from(await res.arrayBuffer()));
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- Vision (VLM)

/**
 * Ask a vision-language model about an image (data URL or http URL). Returns the
 * model's textual answer — this is how the agent "sees" mockups, screenshots,
 * and rendered UI.
 */
export async function analyzeImage(
  imageUrl: string,
  prompt: string,
  signal: AbortSignal,
): Promise<{ ok: boolean; text?: string; error?: string }> {
  // M3 vision MUST go through the Anthropic endpoint: on the OpenAI `/v1` surface M3's
  // thinking is forced on + unbounded and it stalls (verified live); on /anthropic thinking
  // is OFF by default → a fast, decisive verdict (~12s). Build the Anthropic image block
  // from the data URL (both internal callers pass one); fetch+base64 an http URL if given.
  let imageBlock: any;
  try {
    const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/s.exec(imageUrl);
    if (m) {
      imageBlock = { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } };
    } else {
      const r = await fetch(imageUrl, { signal });
      if (!r.ok) return { ok: false, error: `could not fetch image: HTTP ${r.status}` };
      const buf = Buffer.from(await r.arrayBuffer());
      const mt = r.headers.get('content-type')?.split(';')[0] || 'image/png';
      imageBlock = { type: 'image', source: { type: 'base64', media_type: mt, data: buf.toString('base64') } };
    }
  } catch (e: any) {
    return { ok: false, error: `image read failed: ${String(e?.message ?? e)}` };
  }
  // Vision has no model fallback, so bound it: abort on the run's signal OR a local timeout
  // and degrade to {ok:false} rather than hang the gate.
  const ac = new AbortController();
  const onAbort = () => ac.abort();
  if (signal.aborted) ac.abort();
  else signal.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => ac.abort(), 60_000);
  try {
    const res = await fetch(`${anthropicBase()}/v1/messages`, {
      method: 'POST',
      headers: { ...authHeaders(), 'anthropic-version': '2023-06-01' },
      signal: ac.signal,
      body: JSON.stringify({
        model: config.minimaxVlModel,
        max_tokens: 1500,
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, imageBlock] }],
      }),
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}: ${JSON.stringify(data).slice(0, 300)}` };
    // Anthropic response: content is an array of blocks; concatenate the text blocks.
    const text = Array.isArray(data?.content)
      ? data.content.filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('').trim()
      : undefined;
    if (typeof text !== 'string' || !text) return { ok: false, error: `unexpected response: ${JSON.stringify(data).slice(0, 300)}` };
    return { ok: true, text };
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e) };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
}

/** Read a workspace image file as a data URL (for analyzeImage). */
export function fileToDataUrl(absPath: string): string {
  const ext = path.extname(absPath).slice(1).toLowerCase() || 'png';
  const mime = ext === 'jpg' ? 'jpeg' : ext;
  return `data:image/${mime};base64,${fs.readFileSync(absPath).toString('base64')}`;
}

// ----------------------------------------------------------- Image generation

export async function generateImage(
  prompt: string,
  opts: { aspectRatio?: string; n?: number },
  repoDir: string,
  signal: AbortSignal,
): Promise<EngineResult> {
  try {
    const res = await fetch(`${base()}/image_generation`, {
      method: 'POST',
      headers: authHeaders(),
      signal,
      body: JSON.stringify({
        model: config.minimaxImageModel,
        prompt,
        aspect_ratio: opts.aspectRatio || '1:1',
        n: Math.min(Math.max(opts.n ?? 1, 1), 4),
        response_format: 'url',
      }),
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, files: [], error: `HTTP ${res.status}: ${JSON.stringify(data).slice(0, 300)}` };
    // MiniMax returns image urls (and/or base64) under data.image_urls.
    const urls: string[] = data?.data?.image_urls ?? data?.data?.images ?? [];
    if (!urls.length) return { ok: false, files: [], error: `no images in response: ${JSON.stringify(data).slice(0, 300)}` };
    const dir = ensureDir(repoDir, 'images');
    const files: EngineFile[] = [];
    for (let i = 0; i < urls.length; i++) {
      const name = `minimax-image-${Date.now()}-${i + 1}.png`;
      if (await downloadTo(urls[i], path.join(dir, name), signal)) files.push({ path: `images/${name}`, kind: 'image' });
    }
    if (!files.length) return { ok: false, files: [], error: 'could not download generated image(s)' };
    return { ok: true, files };
  } catch (e: any) {
    return { ok: false, files: [], error: String(e?.message ?? e) };
  }
}

// ----------------------------------------------------------- Text-to-speech

export async function textToSpeech(
  text: string,
  opts: { voiceId?: string; speed?: number },
  repoDir: string,
  signal: AbortSignal,
): Promise<EngineResult> {
  if (!config.minimaxGroupId) {
    return { ok: false, files: [], error: 'MiniMax T2A needs MINIMAX_GROUP_ID set in the environment.' };
  }
  try {
    const res = await fetch(`${base()}/t2a_v2?GroupId=${encodeURIComponent(config.minimaxGroupId)}`, {
      method: 'POST',
      headers: authHeaders(),
      signal,
      body: JSON.stringify({
        model: config.minimaxTtsModel,
        text,
        stream: false,
        voice_setting: { voice_id: opts.voiceId || 'male-qn-qingse', speed: opts.speed ?? 1.0, vol: 1.0, pitch: 0 },
        audio_setting: { format: 'mp3', sample_rate: 32000, bitrate: 128000 },
      }),
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, files: [], error: `HTTP ${res.status}: ${JSON.stringify(data).slice(0, 300)}` };
    // T2A v2 returns the audio as a hex string in data.audio (non-streaming).
    const hex: string | undefined = data?.data?.audio;
    if (!hex) return { ok: false, files: [], error: `no audio in response: ${JSON.stringify(data).slice(0, 300)}` };
    const dir = ensureDir(repoDir, 'audio');
    const name = `minimax-speech-${Date.now()}.mp3`;
    fs.writeFileSync(path.join(dir, name), Buffer.from(hex, 'hex'));
    return { ok: true, files: [{ path: `audio/${name}`, kind: 'audio' }] };
  } catch (e: any) {
    return { ok: false, files: [], error: String(e?.message ?? e) };
  }
}

// ----------------------------------------------------------- Video (Hailuo)

const VIDEO_POLL_MS = 10_000;
const VIDEO_DEADLINE_MS = 360_000;

export async function generateVideo(
  prompt: string,
  opts: { firstFrameImage?: string },
  repoDir: string,
  signal: AbortSignal,
): Promise<EngineResult> {
  try {
    // 1) submit
    const submit = await fetch(`${base()}/video_generation`, {
      method: 'POST',
      headers: authHeaders(),
      signal,
      body: JSON.stringify({
        model: config.minimaxVideoModel,
        prompt,
        ...(opts.firstFrameImage ? { first_frame_image: opts.firstFrameImage } : {}),
      }),
    });
    const sub: any = await submit.json().catch(() => ({}));
    const taskId = sub?.task_id ?? sub?.data?.task_id;
    if (!submit.ok || !taskId) {
      return { ok: false, files: [], error: `submit failed (HTTP ${submit.status}): ${JSON.stringify(sub).slice(0, 300)}` };
    }
    // 2) poll
    let fileId: string | undefined;
    const deadline = Date.now() + VIDEO_DEADLINE_MS;
    while (Date.now() < deadline && !signal.aborted) {
      await new Promise((r) => setTimeout(r, VIDEO_POLL_MS));
      const q = await fetch(`${base()}/query/video_generation?task_id=${encodeURIComponent(taskId)}`, {
        headers: authHeaders(),
        signal,
      });
      const qd: any = await q.json().catch(() => ({}));
      const status = qd?.status ?? qd?.data?.status;
      if (status === 'Success' || qd?.file_id) {
        fileId = qd?.file_id ?? qd?.data?.file_id;
        break;
      }
      if (status === 'Fail' || status === 'Failed') {
        return { ok: false, files: [], error: `generation failed: ${JSON.stringify(qd).slice(0, 300)}` };
      }
    }
    if (!fileId) return { ok: false, files: [], error: 'timed out waiting for the video' };
    // 3) retrieve download url
    const fr = await fetch(`${base()}/files/retrieve?file_id=${encodeURIComponent(fileId)}`, {
      headers: authHeaders(),
      signal,
    });
    const frd: any = await fr.json().catch(() => ({}));
    const url = frd?.file?.download_url ?? frd?.data?.download_url;
    if (!url) return { ok: false, files: [], error: `no download url: ${JSON.stringify(frd).slice(0, 300)}` };
    const dir = ensureDir(repoDir, 'video');
    const name = `minimax-video-${Date.now()}.mp4`;
    if (!(await downloadTo(url, path.join(dir, name), signal))) {
      return { ok: false, files: [], error: 'could not download the video' };
    }
    return { ok: true, files: [{ path: `video/${name}`, kind: 'video' }] };
  } catch (e: any) {
    return { ok: false, files: [], error: String(e?.message ?? e) };
  }
}
