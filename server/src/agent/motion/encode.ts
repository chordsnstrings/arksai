import fs from 'node:fs';
import path from 'node:path';
import { execBash } from '../../lib/exec';

/**
 * Motion-graphics encoding — PURE ffmpeg command builders (unit-tested without ffmpeg,
 * the videoStitch pattern) + thin exec wrappers.
 *
 * Uniformity is the whole game: every scene is encoded with IDENTICAL video params
 * (h264/yuv420p, same size+fps) and a MANDATORY audio stream (real narration re-encoded
 * to aac 44.1k stereo, or generated silence) so the final join is the lossless
 * concat-demuxer stream copy from videoStitch.ts.
 */

const q = (s: string) => JSON.stringify(s);

/** One scene: numbered JPEG frames (+ narration mp3 or silence) → mp4. */
export function framesToVideoCmd(
  framesDir: string,
  fps: number,
  out: string,
  opts: { audioIn?: string; durationS: number },
): string {
  const pattern = path.join(framesDir, 'frame%05d.jpg');
  const audio = opts.audioIn
    ? `-i ${q(opts.audioIn)}`
    : `-f lavfi -t ${opts.durationS.toFixed(3)} -i anullsrc=r=44100:cl=stereo`;
  return (
    `ffmpeg -v error -framerate ${fps} -i ${q(pattern)} ${audio} ` +
    // Narration is PADDED with silence to the exact scene length (the old -shortest left
    // the audio track ending at the last spoken word — the concatenated video then had
    // audio shorter than picture, and the music-bed mix died with it before the ending).
    `-c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -r ${fps} ` +
    `-c:a aac -b:a 160k -ar 44100 -ac 2 ${opts.audioIn ? `-af "apad=whole_dur=${opts.durationS.toFixed(3)}" ` : ''}` +
    `-movflags +faststart -y ${q(out)}`
  );
}

/**
 * COMPOSITE a transparent OVERLAY frame sequence (crisp HTML/CSS text/callouts, rendered with
 * an alpha channel) ON TOP of a base video CLIP (a generative illustrated scene), producing ONE
 * uniform scene mp4 with the SAME params as framesToVideoCmd so the final join stays a lossless
 * concat. This is the "animated explainer" keystone: the illustrated look comes from the clip,
 * every WORD comes from the pixel-crisp overlay — never baked into the generated pixels.
 *
 * - The base clip is scaled+cropped to the exact WxH, and its last frame is CLONE-padded so a
 *   clip shorter than the scene still fills it; the final `-t durationS` cuts to the exact length.
 * - The clip's own audio is dropped (one narrator carries the piece): narration mp3 (padded to
 *   the scene length) or generated silence, matching the motion pipeline.
 * - Overlay PNGs are drawn at 0,0 over the clip; `format=yuv420p` at the end flattens for h264.
 */
export function compositeOverlayCmd(
  baseClip: string,
  overlayFramesDir: string,
  fps: number,
  out: string,
  opts: { audioIn?: string; durationS: number; width: number; height: number },
): string {
  const overlayPattern = path.join(overlayFramesDir, 'o%05d.png');
  const dur = opts.durationS.toFixed(3);
  const audio = opts.audioIn
    ? `-i ${q(opts.audioIn)}`
    : `-f lavfi -t ${dur} -i anullsrc=r=44100:cl=stereo`;
  const audioMap = '2:a'; // inputs: 0=clip, 1=overlay image seq, 2=audio (narration OR anullsrc)
  const filter =
    `[0:v]scale=${opts.width}:${opts.height}:force_original_aspect_ratio=increase,` +
    `crop=${opts.width}:${opts.height},setsar=1,fps=${fps},tpad=stop_mode=clone:stop_duration=3600[bg];` +
    `[1:v]scale=${opts.width}:${opts.height}[ov];` +
    `[bg][ov]overlay=0:0:format=auto[v];[v]format=yuv420p[vout]`;
  return (
    `ffmpeg -v error -i ${q(baseClip)} -framerate ${fps} -i ${q(overlayPattern)} ${audio} ` +
    `-filter_complex ${q(filter)} -map "[vout]" -map ${audioMap} ` +
    `-c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -r ${fps} ` +
    `-c:a aac -b:a 160k -ar 44100 -ac 2 ${opts.audioIn ? `-af "apad=whole_dur=${dur}" ` : ''}` +
    `-t ${dur} -movflags +faststart -y ${q(out)}`
  );
}

/** Number of frames a scene needs at fps for durationMs (last frame inclusive-safe). */
export function frameCount(durationMs: number, fps: number): number {
  return Math.max(1, Math.round((durationMs / 1000) * fps));
}

/** Overlay frame file name (transparent PNGs: o00000.png …) — matches compositeOverlayCmd's pattern. */
export function overlayFrameName(i: number): string {
  return `o${String(i).padStart(5, '0')}.png`;
}

/** Zero-padded frame file name the pattern above expects (frame00000.jpg …). */
export function frameName(i: number): string {
  return `frame${String(i).padStart(5, '0')}.jpg`;
}

/** fps policy per operator decision: 30 for short pieces, 24 past ~2 minutes. */
export function pickFps(totalDurationMs: number): number {
  return totalDurationMs > 120_000 ? 24 : 30;
}

export const DIMENSION_PRESETS: Record<string, { w: number; h: number }> = {
  '16:9': { w: 1920, h: 1080 },
  '9:16': { w: 1080, h: 1920 },
  '1:1': { w: 1080, h: 1080 },
  '4:5': { w: 1080, h: 1350 },
};

export async function encodeSceneVideo(
  framesDir: string,
  fps: number,
  outAbs: string,
  opts: { audioIn?: string; durationS: number },
  cwd: string,
  signal?: AbortSignal,
): Promise<void> {
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  // execBash caps at 120s — plenty for one scene (≤ ~60s of content encodes well under that).
  const r = await execBash(framesToVideoCmd(framesDir, fps, outAbs, opts), { cwd, timeoutMs: 120_000, signal });
  if (!r.ok || !fs.existsSync(outAbs)) {
    throw new Error(`scene encode failed: ${(r.output || '').slice(-400)}`);
  }
}

/** Composite a transparent overlay frame sequence over a base clip into one uniform scene mp4. */
export async function compositeOverlayScene(
  baseClip: string,
  overlayFramesDir: string,
  fps: number,
  outAbs: string,
  opts: { audioIn?: string; durationS: number; width: number; height: number },
  cwd: string,
  signal?: AbortSignal,
): Promise<void> {
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  const r = await execBash(compositeOverlayCmd(baseClip, overlayFramesDir, fps, outAbs, opts), {
    cwd,
    timeoutMs: 180_000,
    signal,
  });
  if (!r.ok || !fs.existsSync(outAbs)) {
    throw new Error(`overlay composite failed: ${(r.output || '').slice(-400)}`);
  }
}
