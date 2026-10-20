import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';
import { byteplusKey, byteplusConfigured } from '../agent/byteplusRuntime';
import { scrubSecrets } from '../lib/exec';

/**
 * Seedance video engine (BytePlus ModelArk) — the "ArksAI Video" capability.
 * Branded models (provider name never surfaces in the UI):
 *   arksai-video-25 → Seedance 2.5      (the default for new renders; 4–15 s, no draft)
 *   arksai-video-15 → Seedance 1.5 Pro  (t2v + i2v, 4–12 s, 480p–4K, native audio, DRAFT mode)
 *   arksai-video-20 → Seedance 2.0      (reference/editing/extension, 4–15 s, no draft)
 * DRAFTS are a cheap 480p preview on EVERY model: 1.5 uses its native draft mode; 2.x has none,
 * so a draft renders at 480p on the SAME model (same look as the final, just smaller).
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
  resolution?: string; // 480p | 720p | 1080p | 4k  (finals; a draft is always 480p; a 2.5 4K final renders on 2.0)
  draft?: boolean; // cheap 480p preview — 1.5's native draft mode, a 480p render on 2.x
  audio?: boolean; // native synchronized audio; DEFAULT TRUE (the headline capability)
  imageUrl?: string; // i2v: first-frame / start image (https or data URL)
  lastFrameUrl?: string; // end-frame image — the clip animates from first_frame → last_frame
  referenceUrls?: string[]; // subject/style reference images (Seedance 2.0 keeps their look/identity)
  /** Reference VIDEO (Seedance 2.0 r2v) — extension/"continue this clip"/style-of-this-clip.
   *  MUST be a public web URL: the API rejects data URLs for video (probed 2026-07-03). */
  videoUrl?: string;
}

export const VIDEO_MODELS: Record<string, { api: string; label: string; min: number; max: number; draft: boolean; fallback?: string }> = {
  // Seedance 2.5 — duration range assumed from 2.0 (4–15 s); to be live-verified. Probed
  // 2026-10-20: the model must be ACTIVATED per account in the ModelArk console ("ModelNotOpen"
  // until then), so it falls back to 2.0 automatically and lights up once activated.
  'arksai-video-25': { api: 'dreamina-seedance-2-5-260628', label: 'ArksAI Video 2.5', min: 4, max: 15, draft: false, fallback: 'arksai-video-20' },
  'arksai-video-15': { api: 'seedance-1-5-pro-251215', label: 'ArksAI Video 1.5', min: 4, max: 12, draft: true },
  'arksai-video-20': { api: 'dreamina-seedance-2-0-260128', label: 'ArksAI Video 2.0', min: 4, max: 15, draft: false },
  // Internal cost tier for continuity work (extension/reference scenes in stories) — never shown
  // as a selectable model. The `-fast` suffix sits BEFORE the date (probed 2026-07-03; the
  // date-then-fast guess 404s). No -mini/-pro exist on our account.
  'arksai-video-20-fast': { api: 'dreamina-seedance-2-0-fast-260128', label: 'ArksAI Video 2.0', min: 4, max: 15, draft: false },
};

const VALID_RES = new Set(['480p', '720p', '1080p', '4k']);
const VALID_ASPECT = new Set(['16:9', '9:16', '1:1', '4:3', '21:9']);

/** Build the ModelArk task body from a spec. PURE (unit-tested): clamps the duration to the
 *  model's verified range, forces 480p for drafts, defaults audio ON, and appends the
 *  --params the API parses from the prompt text. The returned `draft` is true only when the
 *  model's NATIVE draft mode was used (1.5); a 2.x draft is an ordinary 480p render. */
/**
 * The branded model a spec actually renders on. PURE. Unknown ids resolve to 1.5. Seedance 2.5 is
 * only listed (and priced) at 480p / 720p / 1080p, so a 4K FINAL is routed to Video 2.0 — which IS
 * offered at 4K — until 2.5 4K is verified live. A draft is always 480p, so it never reroutes.
 */
export function effectiveVideoModel(spec: Pick<VideoSpec, 'model' | 'resolution' | 'draft'>): string {
  const modelId = spec.model && VIDEO_MODELS[spec.model] ? spec.model : 'arksai-video-15';
  if (modelId === 'arksai-video-25' && !spec.draft && String(spec.resolution || '').toLowerCase() === '4k') return 'arksai-video-20';
  return modelId;
}

export function buildVideoTask(spec: VideoSpec): {
  /** Branded model actually used (unknown ids resolve to 1.5; a 2.5 4K final resolves to 2.0). */
  model: string;
  apiModel: string;
  label: string;
  body: Record<string, unknown>;
  duration: number;
  resolution: string;
  draft: boolean;
} {
  const modelId = effectiveVideoModel(spec);
  const m = VIDEO_MODELS[modelId];
  const duration = Math.min(m.max, Math.max(m.min, Math.round(Number(spec.duration) || 8)));
  const draft = !!spec.draft && m.draft; // 2.x has no draft mode (verified: API rejects it)
  let resolution = String(spec.resolution || '1080p').toLowerCase();
  if (!VALID_RES.has(resolution)) resolution = '1080p';
  // Every draft is 480p (verified: "draft task only support resolution 480p" on 1.5). On 2.x it
  // MUST be forced here too — otherwise a draft request silently rendered (and billed) a 1080p
  // final. Same model, smaller frame, so the approved look carries into the final.
  if (spec.draft) resolution = '480p';
  const aspect = VALID_ASPECT.has(String(spec.aspect)) ? String(spec.aspect) : '16:9';
  const text = `${spec.prompt.trim()} --ratio ${aspect} --resolution ${resolution} --duration ${duration}`;
  const content: any[] = [{ type: 'text', text }];
  // Image roles the ModelArk Seedance API accepts: first_frame (start / i2v), last_frame (end —
  // the clip interpolates start→end), reference_image (subject/style the model keeps consistent).
  if (spec.imageUrl) content.push({ type: 'image_url', image_url: { url: spec.imageUrl }, role: 'first_frame' });
  if (spec.lastFrameUrl) content.push({ type: 'image_url', image_url: { url: spec.lastFrameUrl }, role: 'last_frame' });
  for (const ref of spec.referenceUrls ?? []) {
    if (ref) content.push({ type: 'image_url', image_url: { url: ref }, role: 'reference_image' });
  }
  // Reference video (2.0 r2v): the ONLY video role the API accepts is reference_video, and it
  // must be a WEB url (data URLs rejected: "must be provided as a web url"). Extension =
  // reference_video + a "continue this exact video" prompt — there is no separate flag.
  if (spec.videoUrl) content.push({ type: 'video_url', video_url: { url: spec.videoUrl }, role: 'reference_video' });
  const body: Record<string, unknown> = {
    model: m.api,
    content,
    generate_audio: spec.audio !== false, // native audio ON unless explicitly off
  };
  if (draft) body.draft = true;
  return { model: modelId, apiModel: m.api, label: m.label, body, duration, resolution, draft };
}

/** Short side of each output tier in pixels. Frame AREA scales with its square whatever the aspect
 *  (3840×2160 is exactly 4× the pixels of 1920×1080). */
const RES_SHORT_SIDE: Record<string, number> = { '480p': 480, '720p': 720, '1080p': 1080, '4k': 2160 };

/** Session-cost estimate for one render: the official per-second table (branded model ×
 *  resolution) × output seconds. A KNOWN resolution the model's table doesn't list is estimated by
 *  pixel ratio from that model's highest listed tier (below). Unknown models/resolutions fall back
 *  to the flat final rate. PURE. */
export function videoCostEstimate(model: string | undefined, resolution: string, durationS: number): number {
  const res = String(resolution).toLowerCase();
  const table = config.seedanceCostPerSec[model ?? 'arksai-video-15'];
  let rate = table?.[res];
  if (rate === undefined && table && RES_SHORT_SIDE[res]) {
    // ESTIMATE pending the official row: Video 1.5 is verified to accept 4K, but the price table
    // lists it only up to 1080p — the flat fallback ($0.08/s) would bill 4K BELOW 1.5's own 1080p
    // rate. Scale the highest listed tier by pixel area instead (4K = 4× 1080p's per-second rate).
    const top = Object.keys(table)
      .filter((r) => RES_SHORT_SIDE[r])
      .sort((a, b) => RES_SHORT_SIDE[b] - RES_SHORT_SIDE[a])[0];
    if (top) rate = table[top] * (RES_SHORT_SIDE[res] / RES_SHORT_SIDE[top]) ** 2;
  }
  return (rate ?? config.seedanceFinalCostPerSec) * Math.max(0, durationS || 0);
}

/** True when the provider declined the request because an input image contains a real person. */
export const isRealPersonRejection = (msg: string): boolean => /input image may contain (a )?real person/i.test(msg || '');

/**
 * True when the OUTPUT was blocked by the provider's content/copyright moderation
 * (`OutputVideoSensitiveContentDetected.PolicyViolation` — hit twice on 2.0-fast t2v in the
 * 2026-07-03 probes while identical prompts rendered fine on 1.5 and on 2.0 r2v). The story
 * executor's ladder: one reworded retry → downgrade the mechanism to 1.5 → honest note.
 */
export const isContentPolicyError = (msg: string): boolean =>
  /OutputVideoSensitiveContentDetected|sensitive\s?content|copyright restriction/i.test(msg || '');

export interface RealPersonFallback {
  /** The rerouted spec: Video 1.5 + ONE image as first_frame, every other image dropped. */
  spec: VideoSpec;
  /** Which input became the first frame. */
  animated: 'first_frame' | 'reference_image' | 'last_frame';
  /** True only when the animated image is NECESSARILY the declined real-person photo (it was the
   *  spec's ONLY image) — the one case where "exact likeness preserved" is a truthful claim. */
  isPersonImage: boolean;
  /** How many other images were dropped to fit the single-first-frame path. */
  dropped: number;
}

/**
 * The legitimate real-person path (verified live 2026-07-02): Video 2.0 declines real-person
 * photos on EVERY image role (provider anti-deepfake policy), but Video 1.5 officially supports
 * a real person as the FIRST FRAME — image-to-video of the user's own photo, which also preserves
 * true likeness best (the clip starts from their actual pixels). This maps a rejected spec onto
 * that supported path: 1.5 + the person's image as first_frame. PURE.
 *
 * The provider never says WHICH image it declined, so the reroute only happens when the declined
 * photo can actually become the first frame: no start frame is set (a reference / end frame is
 * animated instead), or the start frame is the ONLY image (so it IS the declined one). A start
 * frame set ALONGSIDE other images returns null — the person may be one of the others, and the
 * single-first-frame path would silently drop them while claiming a likeness it can't deliver; the
 * caller rethrows so the agent tells the user plainly. Also null when there's no image at all.
 */
export function realPersonFallbackSpec(spec: VideoSpec): RealPersonFallback | null {
  const refs = (spec.referenceUrls ?? []).filter(Boolean);
  const images = [spec.imageUrl, spec.lastFrameUrl, ...refs].filter(Boolean);
  if (!images.length) return null;
  if (spec.imageUrl && images.length > 1) return null;
  const animated: RealPersonFallback['animated'] = spec.imageUrl ? 'first_frame' : refs.length ? 'reference_image' : 'last_frame';
  const image = spec.imageUrl || refs[0] || spec.lastFrameUrl;
  return {
    spec: {
      ...spec,
      model: 'arksai-video-15',
      imageUrl: image,
      lastFrameUrl: undefined,
      referenceUrls: [],
    },
    animated,
    isPersonImage: images.length === 1,
    dropped: images.length - 1,
  };
}

const base = (): string => config.byteplusVideoBaseUrl.replace(/\/$/, '');
const headers = (): Record<string, string> => ({ Authorization: `Bearer ${byteplusKey()}`, 'Content-Type': 'application/json' });

export const seedanceOn = (): boolean => byteplusConfigured();

/** The account can't use this model (not activated / not entitled / not served). PURE. */
export const isModelUnavailable = (msg: string): boolean =>
  /ModelNotOpen|has not activated|InvalidEndpointOrModel|NotFound|UnsupportedModel/i.test(msg || '');

// Models found NOT activated on this account → skipped (straight to their fallback) for an hour,
// so we don't spend a doomed round-trip per clip; re-checked after that, so activating 2.5 in the
// console makes it the default within the hour without a deploy.
const UNAVAILABLE_TTL_MS = 60 * 60 * 1000;
const unavailableUntil = new Map<string, number>();
export function __resetVideoAvailabilityForTest(): void {
  unavailableUntil.clear();
}

export async function createVideoTask(spec: VideoSpec, signal: AbortSignal): Promise<{ id: string; built: ReturnType<typeof buildVideoTask> }> {
  let current: VideoSpec = spec;
  for (let hop = 0; hop < 3; hop++) {
    // Resolve the model this hop will REALLY render on (a 2.5 4K final → 2.0), so the
    // availability bookkeeping below is keyed on the model actually asked of the provider.
    current = { ...current, model: effectiveVideoModel(current) };
    const meta = current.model ? VIDEO_MODELS[current.model] : undefined;
    const skipUntil = current.model ? unavailableUntil.get(current.model) ?? 0 : 0;
    if (meta?.fallback && skipUntil > Date.now()) {
      current = { ...current, model: meta.fallback };
      continue;
    }
    const built = buildVideoTask(current);
    let res: Response;
    try {
      res = await fetch(`${base()}/contents/generations/tasks`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(built.body),
        signal,
      });
    } catch (e: any) {
      // undici quotes a rejected header value (the key) in its TypeError — never let it surface.
      const err = new Error(scrubSecrets(String(e?.message ?? e)));
      err.name = e?.name || 'Error';
      throw err;
    }
    const data: any = await res.json().catch(() => ({}));
    if (res.ok && data?.id) return { id: String(data.id), built };
    const msg = [data?.error?.code, data?.error?.message].filter(Boolean).join(': ') || `HTTP ${res.status}`;
    // Not activated on this account → remember it and transparently use the fallback model.
    if (meta?.fallback && isModelUnavailable(msg)) {
      unavailableUntil.set(current.model as string, Date.now() + UNAVAILABLE_TTL_MS);
      current = { ...current, model: meta.fallback };
      continue;
    }
    throw new Error(`video task rejected — ${data?.error?.message || msg}`);
  }
  throw new Error('video task rejected — no available video model');
}

/** Poll until the task finishes (typ. 45 s–3 min; generous 10-min ceiling). Returns the
 *  temporary video URL — download it immediately, it expires. */
export async function pollVideoTask(
  id: string,
  signal: AbortSignal,
  onPhase?: (phase: string) => void,
): Promise<{ ok: true; videoUrl: string; tokens?: number } | { ok: false; error: string }> {
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
      const tokens = Number(d?.usage?.total_tokens) || undefined;
      if (typeof url === 'string' && url) return { ok: true, videoUrl: url, tokens };
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
