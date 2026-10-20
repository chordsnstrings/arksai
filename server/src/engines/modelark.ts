import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from '../config';
import { byteplusKey, byteplusConfigured } from '../agent/byteplusRuntime';
import { Semaphore } from '../lib/semaphore';
import { scrubSecrets } from '../lib/exec';

/**
 * ModelArk engine — ArksAI's single model provider (BytePlus ModelArk). Everything the agent
 * loop itself doesn't stream goes through here:
 *   • vision (Seed 2.1 Turbo, image_url parts on chat/completions — screenshots, renders, uploads)
 *   • one-shot text (design brief, logo SVG, classification, digests, story planning)
 *   • image generation (Seedream 5.0 Pro)
 *   • multimodal embeddings (Skylark vision — screenshot + video-frame similarity checks)
 * Video lives in engines/seedance.ts (async task API). There is NO speech model on ModelArk, so
 * speech is a stub (engines/speech.ts). Every call is never-throw: {ok:false, error} on failure.
 *
 * Request shapes were verified live on 2026-10-20 (coding-plan endpoint for chat/vision/
 * embeddings, general endpoint for images; see the comments on each function).
 */

const execFileP = promisify(execFile);

export interface EngineFile {
  path: string; // workspace-relative
  kind: 'image' | 'audio' | 'video';
}
export interface EngineResult {
  ok: boolean;
  files: EngineFile[];
  text?: string;
  error?: string;
  /** Real or estimated spend for this call (USD), for the session cost bar. */
  costUsd?: number;
}
export interface TextResult {
  ok: boolean;
  text?: string;
  error?: string;
  costUsd?: number;
}

/** ModelArk is configured (env ARK_API_KEY or the encrypted app_settings key). */
export const modelarkReady = (): boolean => byteplusConfigured();

/** Plain-language reason for tools/UI when the key is missing. */
export const MODELARK_MISSING =
  'The AI models are not configured yet — an admin needs to add the model key under Admin → Keys.';

const codingBase = (): string => config.byteplusBaseUrl.replace(/\/$/, '');
const mediaBase = (): string => config.byteplusVideoBaseUrl.replace(/\/$/, '');
const authHeaders = () => ({ Authorization: `Bearer ${byteplusKey()}`, 'Content-Type': 'application/json' });

// Per-kind limiters (separate endpoints/quotas — a burst of page reviews must not starve a robot
// reply or a design brief). Waiting for a slot has its OWN bound (config.arkQueueWaitMs, default
// 3 min — never unbounded); the call's deadline then covers only the request itself. Counting the
// queue against the call deadline made the tail pages of a 25-page deck time out un-reviewed.
const limiters = {
  vision: new Semaphore(config.arkVisionConcurrency),
  text: new Semaphore(Math.max(1, Number(process.env.ARK_TEXT_CONCURRENCY || '4') || 4)),
  embed: new Semaphore(Math.max(1, Number(process.env.ARK_EMBED_CONCURRENCY || '4') || 4)),
};
type LimiterKind = keyof typeof limiters;

/** Acquire a slot, giving up when the caller aborts OR the queue-wait bound passes. */
async function acquireSlot(kind: LimiterKind, signal: AbortSignal | undefined): Promise<() => void> {
  const bound = AbortSignal.timeout(config.arkQueueWaitMs);
  return limiters[kind].acquire(signal ? AbortSignal.any([signal, bound]) : bound);
}

// ---------------------------------------------------------------- pricing

/** Official ModelArk prices (USD per M tokens, ≤128K prompt tier), 2026-10-20. */
export const ARK_PRICES: Record<string, { input: number; cached: number; output: number }> = {
  'seed-2-0-pro-260328': { input: 0.5, cached: 0.1, output: 3.0 },
  'seed-2-0-lite-260228': { input: 0.25, cached: 0.05, output: 2.0 },
  'seed-2-0-lite-260428': { input: 0.25, cached: 0.05, output: 2.0 },
  'seed-2-0-mini-260215': { input: 0.1, cached: 0.02, output: 0.4 },
  'seed-2-0-mini-260428': { input: 0.1, cached: 0.02, output: 0.4 },
  'glm-5-2-260617': { input: 1.4, cached: 0.26, output: 4.4 },
  'glm-5-3-flash-260828': { input: 0.15, cached: 0.03, output: 0.5 },
  'deepseek-v4-pro-ga-260813': { input: 1.32, cached: 0.044, output: 3.96 },
  'deepseek-v4-pro-260425': { input: 1.32, cached: 0.044, output: 3.96 },
  'deepseek-v4-flash-ga-260731': { input: 0.44, cached: 0.014, output: 1.32 },
  'dola-seed-2-1-turbo-260628': { input: 0.5, cached: 0.1, output: 2.5 },
};

/** Cost of one completion from its returned usage. PURE (unit-tested). Unknown model → `fallback`. */
export function costFromUsage(model: string, usage: any, fallback = 0): number {
  const p = ARK_PRICES[model];
  if (!p || !usage) return fallback;
  const prompt = Number(usage.prompt_tokens) || 0;
  const cached = Number(usage.prompt_tokens_details?.cached_tokens) || 0;
  const completion = Number(usage.completion_tokens) || 0;
  return ((prompt - cached) * p.input + cached * p.cached + completion * p.output) / 1e6;
}

// ---------------------------------------------------------------- transport

/** Redact every known secret — and always the CURRENT key, registered or not. */
export function scrubKey(text: string): string {
  const key = byteplusKey();
  const out = scrubSecrets(text);
  return key ? out.split(key).join('[redacted]') : out;
}

/**
 * POST JSON with a hard deadline. NB: aborting the controller does NOT reliably reject an undici
 * fetch still awaiting response headers, so the await is ALSO raced against a deadline promise —
 * a slow call degrades to {ok:false} instead of freezing a verify/report gate. Never throws.
 * Every error string is secret-scrubbed: undici quotes a rejected header value (i.e. the key) in
 * its TypeError, and these errors reach tenants (robot drafts, voice replies, tool output).
 */
async function postJson(
  url: string,
  body: unknown,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<{ ok: boolean; status: number; data: any; error?: string }> {
  const ac = new AbortController();
  const onAbort = () => ac.abort();
  if (signal?.aborted) ac.abort();
  else signal?.addEventListener('abort', onAbort, { once: true });
  let rejectDeadline: ((e: any) => void) | null = null;
  const deadline = new Promise<never>((_, rej) => {
    rejectDeadline = rej;
  });
  deadline.catch(() => {});
  const timer = setTimeout(() => {
    ac.abort();
    rejectDeadline?.(new Error(`timed out after ${Math.round(timeoutMs / 1000)}s`));
  }, timeoutMs);
  try {
    const res = await Promise.race([
      fetch(url, { method: 'POST', headers: authHeaders(), body: JSON.stringify(body), signal: ac.signal }),
      deadline,
    ]);
    const raw = await Promise.race([res.text(), deadline]);
    let data: any;
    try {
      data = JSON.parse(raw);
    } catch {
      return { ok: false, status: res.status, data: null, error: scrubKey(`HTTP ${res.status}: non-JSON response (${raw.slice(0, 120)})`) };
    }
    if (!res.ok) {
      const msg = data?.error?.message || JSON.stringify(data).slice(0, 300);
      return { ok: false, status: res.status, data, error: scrubKey(`HTTP ${res.status}: ${msg}`) };
    }
    return { ok: true, status: res.status, data };
  } catch (e: any) {
    return { ok: false, status: 0, data: null, error: scrubKey(String(e?.message ?? e)) };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

const stripThink = (s: string): string => s.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

// ---------------------------------------------------------------- one-shot chat

export interface ChatOpts {
  model?: string;
  system?: string;
  maxTokens?: number;
  /** 'disabled' (default) = fast, decisive; 'enabled' = let the model reason first. */
  thinking?: 'enabled' | 'disabled' | 'default';
  temperature?: number;
  timeoutMs?: number;
  /** Endpoint: 'coding' (default — the flat-rate coding plan) or 'general' (pay-as-you-go; needed
   *  for models the coding plan doesn't serve, e.g. Seed 2.1 Turbo → "UnsupportedModel"). */
  endpoint?: 'coding' | 'general';
  /** Cost to report when a SUCCESSFUL reply carries no token usage (default config.arkTextCost). */
  fallbackCost?: number;
  /** Which concurrency pool (default: 'text'). */
  pool?: 'vision' | 'text';
}

/** Models the coding plan does NOT serve (a real call returns "UnsupportedModel"; note the free
 *  validation probe can't detect this) — they go to the general endpoint. The configured vision
 *  model follows config.arkVisionEndpoint. */
const GENERAL_ONLY_MODELS = new Set(['dola-seed-2-1-turbo-260628']);
export function endpointFor(model: string): 'coding' | 'general' {
  if (model === config.arkVisionModel) return config.arkVisionEndpoint;
  return GENERAL_ONLY_MODELS.has(model) ? 'general' : 'coding';
}

/** A non-streaming chat/completions call (endpoint chosen per model unless opts.endpoint). Never throws. */
export async function arkChat(content: any[] | string, signal: AbortSignal | undefined, opts: ChatOpts = {}): Promise<TextResult> {
  if (!modelarkReady()) return { ok: false, error: MODELARK_MISSING, costUsd: 0 };
  const model = opts.model || config.arkTextModel;
  const messages: any[] = [];
  if (opts.system) messages.push({ role: 'system', content: opts.system });
  messages.push({ role: 'user', content });
  const body: Record<string, unknown> = { model, messages, max_tokens: opts.maxTokens ?? 4000 };
  const thinking = opts.thinking ?? 'disabled';
  if (thinking !== 'default') body.thinking = { type: thinking };
  if (opts.temperature != null) body.temperature = opts.temperature;
  const timeoutMs = opts.timeoutMs ?? 120_000;
  let release: (() => void) | null = null;
  try {
    release = await acquireSlot(opts.pool ?? 'text', signal);
  } catch {
    return { ok: false, error: signal?.aborted ? 'aborted' : 'the model service is busy — no free slot within the wait limit', costUsd: 0 };
  }
  try {
    const base = (opts.endpoint ?? endpointFor(model)) === 'general' ? mediaBase() : codingBase();
    const r = await postJson(`${base}/chat/completions`, body, signal, timeoutMs);
    if (!r.ok) return { ok: false, error: r.error, costUsd: 0 }; // a failed call is not billed
    const text = stripThink(String(r.data?.choices?.[0]?.message?.content ?? ''));
    const costUsd = costFromUsage(model, r.data?.usage, opts.fallbackCost ?? config.arkTextCost);
    if (!text) return { ok: false, error: `empty reply (finish_reason: ${r.data?.choices?.[0]?.finish_reason ?? 'unknown'})`, costUsd };
    return { ok: true, text, costUsd };
  } finally {
    release?.();
  }
}

/** One-shot TEXT completion. Default model = config.arkTextModel (thinking off → fast, decisive). */
export async function generateText(
  prompt: string,
  signal: AbortSignal,
  opts: { maxTokens?: number; system?: string; model?: string; thinking?: ChatOpts['thinking']; timeoutMs?: number } = {},
): Promise<TextResult> {
  return arkChat(prompt, signal, {
    model: opts.model,
    system: opts.system,
    maxTokens: opts.maxTokens,
    thinking: opts.thinking,
    timeoutMs: opts.timeoutMs ?? (Number(process.env.ARK_TEXT_TIMEOUT_MS || '150000') || 150_000),
  });
}

// ---------------------------------------------------------------- vision

/** Read a workspace image file as a data URL. */
export function fileToDataUrl(absPath: string): string {
  const buf = fs.readFileSync(absPath);
  return `data:${mimeFromBytes(buf, absPath)};base64,${buf.toString('base64')}`;
}

function mimeFromBytes(buf: Buffer, nameHint = ''): string {
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf[0] === 0x47 && buf[1] === 0x49) return 'image/gif';
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[8] === 0x57) return 'image/webp';
  const ext = path.extname(nameHint).slice(1).toLowerCase();
  return `image/${ext === 'jpg' ? 'jpeg' : ext || 'png'}`;
}

/** A real image isn't tiny and starts with a known magic header (PNG/JPEG/GIF/WebP). PURE. */
export function isValidImageBytes(buf: Buffer): boolean {
  if (!buf || buf.length < 512) return false;
  const png = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  const jpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const gif = buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38;
  const webp =
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50;
  return png || jpeg || gif || webp;
}

/** Pixel dimensions from a PNG / JPEG / WebP header (no decode). PURE (unit-tested). */
export function imageDims(buf: Buffer): { w: number; h: number } | null {
  try {
    if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    if (buf[0] === 0xff && buf[1] === 0xd8) {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) {
          i++;
          continue;
        }
        const marker = buf[i + 1];
        const len = buf.readUInt16BE(i + 2);
        // SOF0–SOF15 except DHT(C4), JPG(C8), DAC(CC) carry the frame size.
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
        }
        i += 2 + len;
      }
      return null;
    }
    if (buf.length >= 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
      const chunk = buf.toString('ascii', 12, 16);
      if (chunk === 'VP8X') return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
      if (chunk === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
      if (chunk === 'VP8L') {
        const b = buf.readUInt32LE(21);
        return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 };
      }
    }
  } catch {
    /* malformed header */
  }
  return null;
}

/**
 * Plan crops for a TALL image (e.g. a full-page screenshot) so a vision model reads it at full
 * resolution instead of a squashed thumbnail: tiles of width w and height ≈ w·tileRatio, at most
 * maxTiles (beyond that the remaining height is folded into the last tile). PURE (unit-tested).
 */
export function planTiles(w: number, h: number, maxTiles = 6, tileRatio = 1.25): Array<{ y: number; h: number }> {
  const tileH = Math.max(1, Math.round(w * tileRatio));
  if (h <= tileH * 1.6) return [{ y: 0, h }];
  const n = Math.min(maxTiles, Math.ceil(h / tileH));
  const step = Math.ceil(h / n);
  const tiles: Array<{ y: number; h: number }> = [];
  for (let i = 0; i < n; i++) {
    const y = i * step;
    tiles.push({ y, h: Math.min(step, h - y) });
  }
  return tiles;
}

/**
 * Data URLs for a workspace image, TILED when it's tall (full-page screenshots) so every part is
 * legible to the vision model. Uses ffmpeg crop (already a runtime dependency). Fail-soft: any
 * error → the single original image.
 */
export async function visionUrlsForFile(absPath: string, maxTiles = 6): Promise<string[]> {
  try {
    const buf = fs.readFileSync(absPath);
    const dims = imageDims(buf);
    if (!dims) return [fileToDataUrl(absPath)];
    const tiles = planTiles(dims.w, dims.h, maxTiles);
    if (tiles.length === 1) return [fileToDataUrl(absPath)];
    const tileExt = mimeFromBytes(buf) === 'image/png' ? 'png' : 'jpg';
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ark-tiles-'));
    try {
      const out: string[] = [];
      let bytes = 0;
      for (let i = 0; i < tiles.length; i++) {
        const t = tiles[i];
        const dest = path.join(dir, `t${i}.${tileExt}`);
        // Crop by FRACTIONS of the decoded frame (iw/ih), not header pixels: ffmpeg applies EXIF
        // rotation before filtering, so header-pixel offsets would clamp every tile to the same
        // slice on a rotated JPEG. Tiles are ≤1600px wide (the model downsamples anyway). PNG
        // sources stay PNG (JPEG would flatten transparency onto black); JPEG/WebP sources become
        // compact JPEG tiles (a PNG re-encode grew those requests ~6–7×).
        const fh = (t.h / dims.h).toFixed(6);
        const fy = (t.y / dims.h).toFixed(6);
        await execFileP(
          'ffmpeg',
          ['-v', 'error', '-y', '-i', absPath, '-vf', `crop=iw:ih*${fh}:0:ih*${fy},scale='min(iw,1600)':-2`, ...(tileExt === 'jpg' ? ['-q:v', '3'] : []), dest],
          { timeout: 30_000 },
        );
        const tile = fs.readFileSync(dest);
        bytes += tile.length;
        out.push(`data:image/${tileExt === 'jpg' ? 'jpeg' : 'png'};base64,${tile.toString('base64')}`);
      }
      // Payload guard: past ~12 MB of tiles, the single original image is the safer request.
      return bytes > 12 * 1024 * 1024 ? [fileToDataUrl(absPath)] : out;
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } catch {
    return [fileToDataUrl(absPath)];
  }
}

async function toDataUrl(imageUrl: string, signal: AbortSignal | undefined): Promise<string> {
  if (imageUrl.startsWith('data:')) return imageUrl;
  // Fetch http(s) URLs ourselves: ModelArk can't reach private/preview hosts.
  const r = await fetch(imageUrl, { signal });
  if (!r.ok) throw new Error(`could not fetch image: HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  return `data:${mimeFromBytes(buf, imageUrl)};base64,${buf.toString('base64')}`;
}

/**
 * Ask the vision model (Seed 2.1 Turbo) about one or more images (data URLs or http URLs). Several
 * images go into ONE message (verified: the model counts and compares them), which is how tiled
 * screenshots and before/after pairs are read. Thinking is off: in a planted-defect test it caught
 * 5/5 defects in ~14s — the same recall as its default reasoning at a quarter of the latency.
 */
export async function analyzeImage(
  imageUrl: string | string[],
  prompt: string,
  signal: AbortSignal,
  opts: { maxTokens?: number; model?: string } = {},
): Promise<TextResult> {
  if (!modelarkReady()) return { ok: false, error: MODELARK_MISSING, costUsd: 0 };
  let parts: any[];
  try {
    const urls = Array.isArray(imageUrl) ? imageUrl : [imageUrl];
    const data = await Promise.all(urls.map((u) => toDataUrl(u, signal)));
    parts = data.map((url) => ({ type: 'image_url', image_url: { url } }));
  } catch (e: any) {
    return { ok: false, error: `image read failed: ${String(e?.message ?? e)}`, costUsd: 0 };
  }
  parts.push({ type: 'text', text: prompt });
  const r = await arkChat(parts, signal, {
    model: opts.model || config.arkVisionModel,
    maxTokens: opts.maxTokens ?? 1500,
    thinking: 'disabled',
    timeoutMs: Number(process.env.ARK_VISION_TIMEOUT_MS || '60000') || 60_000,
    fallbackCost: config.arkVisionCost,
    pool: 'vision',
  });
  return r;
}

// ---------------------------------------------------------------- image generation

/** Seedream 5.0 Pro size per aspect ratio — every entry is ≥921,600 px (the model's floor) and
 *  ≤2.61 MP (the cheaper $0.045 tier). Probed 2026-10-20. */
export const SEEDREAM_SIZES: Record<string, string> = {
  '1:1': '1600x1600',
  '4:5': '1440x1800',
  '5:4': '1800x1440',
  '3:4': '1392x1856',
  '4:3': '1856x1392',
  '2:3': '1312x1968',
  '3:2': '1968x1312',
  '9:16': '1152x2048',
  '16:9': '2048x1152',
  '21:9': '2464x1056',
  '1.91:1': '2208x1156',
};

/** Size for an aspect ratio: the table, else computed for any "W:H" (≈2.5 MP, multiples of 16,
 *  ratio clamped to 1:3…3:1). PURE (unit-tested). */
export function seedreamSize(aspect?: string): string {
  const a = String(aspect || '1:1').trim();
  if (SEEDREAM_SIZES[a]) return SEEDREAM_SIZES[a];
  const m = /^(\d+(?:\.\d+)?)\s*[:x/]\s*(\d+(?:\.\d+)?)$/.exec(a);
  if (!m) return SEEDREAM_SIZES['1:1'];
  const ratio = Math.min(3, Math.max(1 / 3, Number(m[1]) / Number(m[2])));
  const area = 2_500_000;
  const r16 = (n: number) => Math.max(16, Math.round(n / 16) * 16);
  return `${r16(Math.sqrt(area * ratio))}x${r16(Math.sqrt(area / ratio))}`;
}

/** Pure request builder for Seedream (unit-tested). `referenceDataUri` → the `image` field
 *  (image-to-image / subject reference). b64_json avoids a second download from an expiring URL. */
export function buildImageRequest(
  model: string,
  prompt: string,
  opts: { aspectRatio?: string; referenceDataUri?: string; seed?: number },
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    prompt,
    size: seedreamSize(opts.aspectRatio),
    response_format: 'b64_json',
    watermark: false,
  };
  if (opts.referenceDataUri) body.image = opts.referenceDataUri;
  if (Number.isInteger(opts.seed) && (opts.seed as number) >= -1) body.seed = opts.seed;
  return body;
}

/** Readable message for a provider refusal (real-person reference / content policy). */
export function imageErrorMessage(err: string): string {
  if (/real person|portrait right|likeness/i.test(err)) {
    return "the image service won't use a photo of a real person as a reference — describe the person instead, or use an illustration as the reference";
  }
  if (/sensitive|policy|risk|moderation/i.test(err)) {
    return 'the image service declined that prompt on content-policy grounds — rephrase it (no real names, brands or sensitive content)';
  }
  return err;
}

/**
 * Generate image(s) with Seedream 5.0 Pro (general endpoint, synchronous, ~30s each). `n` > 1 =
 * independent variants (parallel calls). Saves to images/ with the real extension; every file is
 * byte-validated. `subjectReference` = absolute path of a reference image (image-to-image).
 */
export async function generateImage(
  prompt: string,
  opts: { aspectRatio?: string; n?: number; subjectReference?: string; seed?: number },
  repoDir: string,
  signal: AbortSignal,
): Promise<EngineResult> {
  if (!modelarkReady()) return { ok: false, files: [], error: MODELARK_MISSING };
  let referenceDataUri: string | undefined;
  if (opts.subjectReference) {
    try {
      referenceDataUri = fileToDataUrl(opts.subjectReference);
    } catch (e: any) {
      return { ok: false, files: [], error: `couldn't read the reference image "${opts.subjectReference}" — ${String(e?.message ?? e)}` };
    }
  }
  const n = Math.min(Math.max(opts.n ?? 1, 1), 4);
  const dir = path.join(repoDir, 'images');
  fs.mkdirSync(dir, { recursive: true });
  const body = buildImageRequest(config.arkImageModel, prompt, { aspectRatio: opts.aspectRatio, referenceDataUri, seed: opts.seed });
  const stamp = Date.now();
  const timeoutMs = Number(process.env.ARK_IMAGE_TIMEOUT_MS || '150000') || 150_000;
  const results = await Promise.all(
    Array.from({ length: n }, async (_, i) => {
      const r = await postJson(`${mediaBase()}/images/generations`, body, signal, timeoutMs);
      if (!r.ok) return { error: imageErrorMessage(r.error || 'image generation failed') };
      const item = r.data?.data?.[0];
      let buf: Buffer | null = null;
      if (item?.b64_json) buf = Buffer.from(item.b64_json, 'base64');
      else if (item?.url) {
        try {
          const res = await fetch(item.url, { signal });
          if (res.ok) buf = Buffer.from(await res.arrayBuffer());
        } catch {
          /* fall through to the invalid-bytes error */
        }
      }
      if (!buf || !isValidImageBytes(buf)) return { error: 'the image came back empty or unreadable — try again' };
      const ext = mimeFromBytes(buf).split('/')[1].replace('jpeg', 'jpg');
      const name = `image-${stamp}-${i + 1}.${ext}`;
      fs.writeFileSync(path.join(dir, name), buf);
      return { file: { path: `images/${name}`, kind: 'image' as const } };
    }),
  );
  const files = results.flatMap((r) => ('file' in r && r.file ? [r.file] : []));
  const costUsd = files.length * config.arkImageCost;
  if (!files.length) return { ok: false, files: [], error: (results.find((r) => 'error' in r) as any)?.error || 'image generation failed', costUsd };
  return { ok: true, files, costUsd };
}

// ---------------------------------------------------------------- embeddings

/** Cosine similarity of two vectors. PURE (unit-tested). 0 for mismatched/empty input. */
export function cosine(a: number[] | null | undefined, b: number[] | null | undefined): number {
  if (!a || !b || !a.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

async function embed(input: any[], signal: AbortSignal | undefined): Promise<{ ok: boolean; vector?: number[]; error?: string }> {
  if (!modelarkReady()) return { ok: false, error: MODELARK_MISSING };
  let release: (() => void) | null = null;
  try {
    release = await acquireSlot('embed', signal);
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e) };
  }
  try {
    const r = await postJson(`${codingBase()}/embeddings/multimodal`, { model: config.arkEmbedModel, input }, signal, 30_000);
    if (!r.ok) return { ok: false, error: r.error };
    const d = Array.isArray(r.data?.data) ? r.data.data[0] : r.data?.data;
    const vector = d?.embedding;
    if (!Array.isArray(vector) || !vector.length) return { ok: false, error: 'no embedding in response' };
    return { ok: true, vector };
  } finally {
    release?.();
  }
}

/** Skylark multimodal embedding of ONE image (data URL / http URL / workspace path). */
export async function embedImage(image: string, signal?: AbortSignal): Promise<{ ok: boolean; vector?: number[]; error?: string }> {
  try {
    const url = image.startsWith('data:') || /^https?:/i.test(image) ? await toDataUrl(image, signal) : fileToDataUrl(image);
    return embed([{ type: 'image_url', image_url: { url } }], signal);
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e) };
  }
}

/** Skylark embedding of a text (same space as images — text↔image similarity works). */
export async function embedText(text: string, signal?: AbortSignal): Promise<{ ok: boolean; vector?: number[]; error?: string }> {
  return embed([{ type: 'text', text }], signal);
}

/** Cosine similarity of two images (paths or URLs); null when either embedding fails. */
export async function imageSimilarity(a: string, b: string, signal?: AbortSignal): Promise<number | null> {
  const [ea, eb] = await Promise.all([embedImage(a, signal), embedImage(b, signal)]);
  return ea.ok && eb.ok ? cosine(ea.vector, eb.vector) : null;
}
