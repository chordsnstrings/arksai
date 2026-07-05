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

/** Number of frames a scene needs at fps for durationMs (last frame inclusive-safe). */
export function frameCount(durationMs: number, fps: number): number {
  return Math.max(1, Math.round((durationMs / 1000) * fps));
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
