import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';
import { byteplusKey, byteplusConfigured } from '../agent/byteplusRuntime';

/**
 * Seedance video engine (BytePlus ModelArk) — the "ArksAI Video" capability.
 * Branded models (provider name never surfaces in the UI):
 *   arksai-video-15 → Seedance 1.5 Pro  (t2v + i2v, 4–12 s, 480p–4K, native audio, DRAFT mode)
 *   arksai-video-20 → Seedance 2.0      (reference/editing/extension, 4–15 s, no draft)
 * Async task API (all verified live 2026-07-02, see SEEDANCE_PLAN.md):
 *   POST /contents/generations/tasks → {id} → GET …/tasks/{id} until succeeded → download the
 *   video URL IMMEDIATELY (external URLs expire). DELETE cancels.
 */

export interface VideoSpec {
  /** The compiled, director-grade prompt (subject + action + camera + style + audio cues). */
  prompt: string;
  /** Branded model id; default arksai-video-15. Unknown ids fall back to 1.5. */
  model?: string;
  aspect?: string; // 16:9 | 9:16 | 1:1 | 4:3 | 21:9
  duration?: number; // seconds; clamped to the model's verified range
  resolution?: string; // 480p | 720p | 1080p | 4k  (finals; a draft is always 480p)
  draft?: boolean; // 1.5 only — cheap/fast 480p preview
  audio?: boolean; // native synchronized audio; DEFAULT TRUE (the headline capability)
  imageUrl?: string; // i2v: first-frame image (https or data URL)
}

export const VIDEO_MODELS: Record<string, { api: string; label: string; min: number; max: number; draft: boolean }> = {
  'arksai-video-15': { api: 'seedance-1-5-pro-251215', label: 'ArksAI Video 1.5', min: 4, max: 12, draft: true },
  'arksai-video-20': { api: 'dreamina-seedance-2-0-260128', label: 'ArksAI Video 2.0', min: 4, max: 15, draft: false },
};

const VALID_RES = new Set(['480p', '720p', '1080p', '4k']);
const VALID_ASPECT = new Set(['16:9', '9:16', '1:1', '4:3', '21:9']);

/** Build the ModelArk task body from a spec. PURE (unit-tested): clamps the duration to the
 *  model's verified range, forces 480p for drafts, defaults audio ON, and appends the
 *  --params the API parses from the prompt text. */
export function buildVideoTask(spec: VideoSpec): {
  apiModel: string;
  label: string;
  body: Record<string, unknown>;
  duration: number;
  resolution: string;
  draft: boolean;
} {
  const m = VIDEO_MODELS[spec.model ?? 'arksai-video-15'] ?? VIDEO_MODELS['arksai-video-15'];
  const duration = Math.min(m.max, Math.max(m.min, Math.round(Number(spec.duration) || 8)));
  const draft = !!spec.draft && m.draft; // 2.0 has no draft mode (verified: API rejects it)
  let resolution = String(spec.resolution || '1080p').toLowerCase();
  if (!VALID_RES.has(resolution)) resolution = '1080p';
  if (draft) resolution = '480p'; // verified: "draft task only support resolution 480p"
  const aspect = VALID_ASPECT.has(String(spec.aspect)) ? String(spec.aspect) : '16:9';
  const text = `${spec.prompt.trim()} --ratio ${aspect} --resolution ${resolution} --duration ${duration}`;
  const content: any[] = [{ type: 'text', text }];
  if (spec.imageUrl) content.push({ type: 'image_url', image_url: { url: spec.imageUrl }, role: 'first_frame' });
  const body: Record<string, unknown> = {
    model: m.api,
    content,
    generate_audio: spec.audio !== false, // native audio ON unless explicitly off
  };
  if (draft) body.draft = true;
  return { apiModel: m.api, label: m.label, body, duration, resolution, draft };
}

const base = (): string => config.byteplusVideoBaseUrl.replace(/\/$/, '');
const headers = (): Record<string, string> => ({ Authorization: `Bearer ${byteplusKey()}`, 'Content-Type': 'application/json' });

export const seedanceOn = (): boolean => byteplusConfigured();

export async function createVideoTask(spec: VideoSpec, signal: AbortSignal): Promise<{ id: string; built: ReturnType<typeof buildVideoTask> }> {
  const built = buildVideoTask(spec);
  const res = await fetch(`${base()}/contents/generations/tasks`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(built.body),
    signal,
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok || !data?.id) {
    const msg = data?.error?.message || `HTTP ${res.status}`;
    throw new Error(`video task rejected — ${msg}`);
  }
  return { id: String(data.id), built };
}

/** Poll until the task finishes (typ. 45 s–3 min; generous 10-min ceiling). Returns the
 *  temporary video URL — download it immediately, it expires. */
export async function pollVideoTask(
  id: string,
  signal: AbortSignal,
  onPhase?: (phase: string) => void,
): Promise<{ ok: true; videoUrl: string } | { ok: false; error: string }> {
  const deadline = Date.now() + 10 * 60_000;
  let lastStatus = '';
  for (;;) {
    if (signal.aborted) return { ok: false, error: 'interrupted' };
    if (Date.now() > deadline) return { ok: false, error: 'video generation timed out (10 min)' };
    await new Promise((r) => setTimeout(r, 5000));
    let d: any;
    try {
      const res = await fetch(`${base()}/contents/generations/tasks/${id}`, { headers: headers(), signal });
      d = await res.json().catch(() => ({}));
    } catch {
      continue; // transient poll failure — keep waiting
    }
    const status = String(d?.status || '');
    if (status !== lastStatus) {
      lastStatus = status;
      onPhase?.(status);
    }
    if (status === 'succeeded') {
      const url = d?.content?.video_url ?? d?.video_url ?? d?.content?.url ?? d?.outputs?.[0];
      if (typeof url === 'string' && url) return { ok: true, videoUrl: url };
      return { ok: false, error: 'task succeeded but no video URL was returned' };
    }
    if (status === 'failed' || status === 'cancelled' || status === 'expired') {
      return { ok: false, error: d?.failure_reason || d?.error?.message || `task ${status}` };
    }
  }
}

export async function cancelVideoTask(id: string): Promise<void> {
  try {
    await fetch(`${base()}/contents/generations/tasks/${id}`, { method: 'DELETE', headers: headers() });
  } catch {
    /* best-effort */
  }
}

/** Download the (expiring) video URL into the workspace. Returns the byte size. */
export async function downloadVideo(url: string, destAbs: string, signal: AbortSignal): Promise<number> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`could not download the video (HTTP ${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 10_000) throw new Error('downloaded video is implausibly small — treating as failed');
  fs.mkdirSync(path.dirname(destAbs), { recursive: true });
  fs.writeFileSync(destAbs, buf);
  return buf.length;
}
