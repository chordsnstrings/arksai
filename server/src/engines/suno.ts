import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';

export interface MusicOptions {
  prompt: string;
  instrumental?: boolean;
  style?: string;
  title?: string;
  model?: string;
}

export interface MusicResult {
  ok: boolean;
  files: { path: string; title: string }[];
  error?: string;
}

const POLL_MS = 8000;
const DEADLINE_MS = 240_000;

/**
 * Generate music via the sunoapi.org / apibox API: submit a job, poll for the
 * audio URL, then download the track(s) into the workspace's music/ folder.
 */
export async function generateMusic(
  opts: MusicOptions,
  repoDir: string,
  signal: AbortSignal,
): Promise<MusicResult> {
  const base = config.sunoBaseUrl.replace(/\/$/, '');
  const headers = {
    Authorization: `Bearer ${config.sunoApiKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  const customMode = !!(opts.style || opts.title);
  const body: Record<string, unknown> = {
    prompt: opts.prompt,
    customMode,
    instrumental: !!opts.instrumental,
    model: opts.model || 'V4',
    callBackUrl: config.sunoCallbackUrl,
  };
  if (opts.style) body.style = opts.style;
  if (opts.title) body.title = opts.title;

  let taskId: string;
  try {
    const res = await fetch(`${base}/api/v1/generate`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok || (data.code && data.code !== 200) || !data?.data?.taskId) {
      return { ok: false, files: [], error: `submit failed (HTTP ${res.status}): ${JSON.stringify(data).slice(0, 300)}` };
    }
    taskId = data.data.taskId;
  } catch (e: any) {
    return { ok: false, files: [], error: `submit error: ${String(e?.message ?? e)}` };
  }

  // Poll for completion.
  let tracks: any[] = [];
  const deadline = Date.now() + DEADLINE_MS;
  while (Date.now() < deadline && !signal.aborted) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    try {
      const res = await fetch(`${base}/api/v1/generate/record-info?taskId=${encodeURIComponent(taskId)}`, {
        headers,
        signal,
      });
      const data: any = await res.json().catch(() => ({}));
      const d = data?.data;
      const status: string = d?.status ?? '';
      const arr: any[] = d?.response?.sunoData ?? d?.response?.data ?? [];
      const withAudio = arr.filter((x) => x.audioUrl || x.audio_url);
      if (status === 'SUCCESS' || (withAudio.length && /SUCCESS/i.test(status))) {
        tracks = withAudio;
        break;
      }
      if (status && /FAIL|ERROR/i.test(status)) {
        return { ok: false, files: [], error: `generation failed: ${status}` };
      }
      if (withAudio.length) tracks = withAudio; // keep latest; loop until SUCCESS or deadline
    } catch {
      /* transient poll error — keep trying */
    }
  }
  if (!tracks.length) return { ok: false, files: [], error: 'timed out waiting for audio' };

  // Download the tracks into the workspace.
  const dir = path.join(repoDir, 'music');
  fs.mkdirSync(dir, { recursive: true });
  const files: { path: string; title: string }[] = [];
  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i];
    const url = t.audioUrl || t.audio_url;
    const title = String(t.title || opts.title || 'track').replace(/[^\w.\- ]/g, '_').slice(0, 60) || 'track';
    const fname = `${title}-${i + 1}.mp3`;
    try {
      const res = await fetch(url, { signal });
      if (!res.ok) continue;
      fs.writeFileSync(path.join(dir, fname), Buffer.from(await res.arrayBuffer()));
      files.push({ path: `music/${fname}`, title });
    } catch {
      /* skip this track */
    }
  }
  return files.length
    ? { ok: true, files }
    : { ok: false, files: [], error: 'audio generated but download failed' };
}
