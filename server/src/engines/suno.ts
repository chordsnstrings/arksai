import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';

export interface MusicOptions {
  /** Non-custom: a short DESCRIPTION. Custom: the LYRICS (omit for instrumental). */
  prompt: string;
  instrumental?: boolean;
  style?: string;
  title?: string;
  model?: string;
  vocalGender?: 'm' | 'f';
  styleWeight?: number;
  weirdnessConstraint?: number;
  audioWeight?: number;
  negativeTags?: string;
}

export interface MusicResult {
  ok: boolean;
  files: { path: string; title: string }[];
  error?: string;
}

const POLL_MS = 8000;
const DEADLINE_MS = 300_000; // up to 5 min — newer models render longer (up to ~8-min songs)

// Verified against the live sunoapi.org docs. The style budget is MODEL-DEPENDENT:
// V4 (legacy) caps style at 200 chars; V4_5 / V4_5PLUS / V4_5ALL / V5 allow 1000.
export const SUNO_LIMITS = { nonCustomPrompt: 500, customLyrics: 5000, style: 1000, styleV4: 200, title: 80, negativeTags: 200 };
/** Max style length for a given model id (V4/legacy = 200, modern = 1000). */
export function styleLimit(model: string | undefined): number {
  const m = String(model || '').toUpperCase();
  return m === 'V4' || m === 'V3_5' || m === 'V3' ? SUNO_LIMITS.styleV4 : SUNO_LIMITS.style;
}
const cut = (s: string | undefined, n: number) => (s == null ? s : String(s).slice(0, n));
const unit = (n: number) => Math.max(0, Math.min(1, n));

function headers() {
  return {
    Authorization: `Bearer ${config.sunoApiKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}
function base() {
  return config.sunoBaseUrl.replace(/\/$/, '');
}

/**
 * Pure: build the POST /api/v1/generate body per the REAL API rules (no network → unit-testable).
 * Custom mode requires BOTH style AND title; in custom mode `prompt` is the LYRICS; in non-custom
 * mode `prompt` is a short description. Optional controls are passed through when provided.
 */
export function buildGenerateBody(opts: MusicOptions): Record<string, unknown> {
  const customMode = !!(opts.style && opts.title);
  const instrumental = !!opts.instrumental;
  const model = opts.model || config.sunoModel;
  const body: Record<string, unknown> = {
    customMode,
    instrumental,
    model,
    callBackUrl: config.sunoCallbackUrl,
  };
  if (customMode) {
    body.style = cut(opts.style, styleLimit(model));
    body.title = cut(opts.title, SUNO_LIMITS.title);
    if (!instrumental && opts.prompt?.trim()) body.prompt = cut(opts.prompt, SUNO_LIMITS.customLyrics);
  } else {
    body.prompt = cut(opts.prompt, SUNO_LIMITS.nonCustomPrompt) ?? '';
  }
  if (opts.vocalGender === 'm' || opts.vocalGender === 'f') body.vocalGender = opts.vocalGender;
  if (typeof opts.styleWeight === 'number') body.styleWeight = unit(opts.styleWeight);
  if (typeof opts.weirdnessConstraint === 'number') body.weirdnessConstraint = unit(opts.weirdnessConstraint);
  if (typeof opts.audioWeight === 'number') body.audioWeight = unit(opts.audioWeight);
  if (opts.negativeTags) body.negativeTags = cut(opts.negativeTags, SUNO_LIMITS.negativeTags);
  return body;
}

/** Pure: interpret a record-info poll body → tracks-with-audio, a terminal failure, or pending. */
export function parseRecordInfo(data: any): { status: string; tracks: any[]; failed?: string } {
  const d = data?.data;
  const status: string = d?.status ?? '';
  const arr: any[] = d?.response?.sunoData ?? d?.response?.data ?? [];
  const tracks = arr.filter((x) => x?.audioUrl || x?.audio_url);
  if (/SENSITIVE_WORD/i.test(status))
    return { status, tracks, failed: 'Suno’s content filter flagged the prompt — rephrase and try again.' };
  if (/FAIL|ERROR/i.test(status)) return { status, tracks, failed: `generation failed: ${status}` };
  return { status, tracks };
}

async function submitJob(pathname: string, body: Record<string, unknown>, signal: AbortSignal): Promise<{ taskId?: string; error?: string }> {
  try {
    const res = await fetch(`${base()}${pathname}`, { method: 'POST', headers: headers(), body: JSON.stringify(body), signal });
    const data: any = await res.json().catch(() => ({}));
    const taskId = data?.data?.taskId ?? data?.data?.task_id;
    if (!res.ok || (data.code && data.code !== 200) || !taskId)
      return { error: `submit failed (HTTP ${res.status}): ${JSON.stringify(data).slice(0, 300)}` };
    return { taskId };
  } catch (e: any) {
    return { error: `submit error: ${String(e?.message ?? e)}` };
  }
}

/** Poll a music job's record-info until it has audio (or fails/times out). */
async function pollAudio(taskId: string, signal: AbortSignal): Promise<{ tracks: any[]; error?: string }> {
  let tracks: any[] = [];
  const deadline = Date.now() + DEADLINE_MS;
  while (Date.now() < deadline && !signal.aborted) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    try {
      const res = await fetch(`${base()}/api/v1/generate/record-info?taskId=${encodeURIComponent(taskId)}`, { headers: headers(), signal });
      const parsed = parseRecordInfo(await res.json().catch(() => ({})));
      if (parsed.failed) return { tracks: [], error: parsed.failed };
      if (parsed.tracks.length) tracks = parsed.tracks; // keep the latest set
      if (/SUCCESS/i.test(parsed.status) && tracks.length) break;
    } catch {
      /* transient poll error — keep trying */
    }
  }
  return tracks.length ? { tracks } : { tracks: [], error: 'timed out waiting for audio' };
}

async function downloadTracks(tracks: any[], repoDir: string, fallbackTitle: string, signal: AbortSignal): Promise<MusicResult> {
  const dir = path.join(repoDir, 'music');
  fs.mkdirSync(dir, { recursive: true });
  const files: { path: string; title: string }[] = [];
  for (let i = 0; i < tracks.length; i++) {
    const t = tracks[i];
    const url = t.audioUrl || t.audio_url;
    const title = String(t.title || fallbackTitle || 'track').replace(/[^\w.\- ]/g, '_').slice(0, 60) || 'track';
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
  return files.length ? { ok: true, files } : { ok: false, files: [], error: 'audio generated but download failed' };
}

/** Generate music (submit → poll → download into the workspace's music/ folder). */
export async function generateMusic(opts: MusicOptions, repoDir: string, signal: AbortSignal): Promise<MusicResult> {
  const { taskId, error } = await submitJob('/api/v1/generate', buildGenerateBody(opts), signal);
  if (error || !taskId) return { ok: false, files: [], error };
  const polled = await pollAudio(taskId, signal);
  if (polled.error) return { ok: false, files: [], error: polled.error };
  return downloadTracks(polled.tracks, repoDir, opts.title || 'track', signal);
}

export interface ExtendOptions {
  audioId: string;
  continueAt?: number; // seconds into the source to continue from
  prompt?: string;
  style?: string;
  title?: string;
  model?: string;
}

/** Pure: build the POST /api/v1/generate/extend body. */
export function buildExtendBody(opts: ExtendOptions): Record<string, unknown> {
  const hasParams = !!(opts.style || opts.title || opts.prompt);
  const model = opts.model || config.sunoModel;
  const body: Record<string, unknown> = {
    audioId: opts.audioId,
    defaultParamFlag: hasParams, // true → use the params below; false → inherit from the source
    model,
    callBackUrl: config.sunoCallbackUrl,
  };
  if (typeof opts.continueAt === 'number') body.continueAt = opts.continueAt;
  if (opts.prompt) body.prompt = cut(opts.prompt, SUNO_LIMITS.customLyrics);
  if (opts.style) body.style = cut(opts.style, styleLimit(model));
  if (opts.title) body.title = cut(opts.title, SUNO_LIMITS.title);
  return body;
}

/** Extend/continue an existing track by its audioId. */
export async function extendMusic(opts: ExtendOptions, repoDir: string, signal: AbortSignal): Promise<MusicResult> {
  const { taskId, error } = await submitJob('/api/v1/generate/extend', buildExtendBody(opts), signal);
  if (error || !taskId) return { ok: false, files: [], error };
  const polled = await pollAudio(taskId, signal);
  if (polled.error) return { ok: false, files: [], error: polled.error };
  return downloadTracks(polled.tracks, repoDir, opts.title || 'extended', signal);
}

/** Pure: extract lyric variants from a /lyrics record-info body. */
export function parseLyrics(data: any): { status: string; lyrics: { title?: string; text: string }[] } {
  const d = data?.data;
  const status: string = d?.status ?? '';
  const arr: any[] = d?.response?.data ?? d?.response?.lyricsData ?? d?.lyricsData ?? [];
  const lyrics = arr
    .map((x: any) => ({ title: x?.title, text: String(x?.text ?? x?.lyrics ?? x?.content ?? '') }))
    .filter((x) => x.text.trim());
  return { status, lyrics };
}

/** Generate structured lyrics only (no audio). Returns the lyric variants as text. */
export async function generateLyrics(prompt: string, signal: AbortSignal): Promise<{ ok: boolean; lyrics: { title?: string; text: string }[]; error?: string }> {
  const { taskId, error } = await submitJob('/api/v1/lyrics', { prompt: cut(prompt, 1000), callBackUrl: config.sunoCallbackUrl }, signal);
  if (error || !taskId) return { ok: false, lyrics: [], error };
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline && !signal.aborted) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    try {
      const res = await fetch(`${base()}/api/v1/lyrics/record-info?taskId=${encodeURIComponent(taskId)}`, { headers: headers(), signal });
      const data: any = await res.json().catch(() => ({}));
      const status: string = data?.data?.status ?? '';
      if (/FAIL|ERROR/i.test(status)) return { ok: false, lyrics: [], error: `lyrics failed: ${status}` };
      const { lyrics } = parseLyrics(data);
      if (lyrics.length && /SUCCESS/i.test(status)) return { ok: true, lyrics };
    } catch {
      /* keep trying */
    }
  }
  return { ok: false, lyrics: [], error: 'timed out waiting for lyrics' };
}

export interface CoverOptions {
  /** A publicly-reachable URL to the source audio to cover (≤ ~8 min). */
  uploadUrl: string;
  style?: string;
  title?: string;
  prompt?: string;
  instrumental?: boolean;
  model?: string;
}

/** Pure: build the POST /api/v1/upload-and-cover-audio body. */
export function buildCoverBody(opts: CoverOptions): Record<string, unknown> {
  const customMode = !!(opts.style && opts.title);
  const model = opts.model || config.sunoModel;
  const body: Record<string, unknown> = {
    uploadUrl: opts.uploadUrl,
    customMode,
    instrumental: !!opts.instrumental,
    model,
    callBackUrl: config.sunoCallbackUrl,
  };
  if (opts.style) body.style = cut(opts.style, styleLimit(model));
  if (opts.title) body.title = cut(opts.title, SUNO_LIMITS.title);
  if (opts.prompt && !opts.instrumental) body.prompt = cut(opts.prompt, SUNO_LIMITS.customLyrics);
  return body;
}

/** AI-cover an uploaded/source audio track. */
export async function coverAudio(opts: CoverOptions, repoDir: string, signal: AbortSignal): Promise<MusicResult> {
  const { taskId, error } = await submitJob('/api/v1/upload-and-cover-audio', buildCoverBody(opts), signal);
  if (error || !taskId) return { ok: false, files: [], error };
  const polled = await pollAudio(taskId, signal);
  if (polled.error) return { ok: false, files: [], error: polled.error };
  return downloadTracks(polled.tracks, repoDir, opts.title || 'cover', signal);
}
