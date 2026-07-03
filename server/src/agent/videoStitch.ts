import fs from 'node:fs';
import path from 'node:path';
import { execBash } from '../lib/exec';

/**
 * Video stitching for multi-scene stories (STORY_PLAN Phase 0) — thin ffmpeg wrappers with
 * PURE command builders so the exact invocations are unit-tested without ffmpeg installed.
 *
 * Facts these builders encode (probed live 2026-07-03, SCENES_RESEARCH §8.7):
 *  - Every Seedance clip comes out h264 + aac @ 24 fps → the concat DEMUXER with stream copy
 *    joins losslessly in milliseconds. That is the default cut.
 *  - Transitions (xfade) force a re-encode; audio needs its own acrossfade. Only on explicit ask.
 *  - The last frame of a clip anchors the NEXT scene (frame chaining): `-sseof -0.15`.
 * ffmpeg itself is an OPTIONAL dependency (Dockerfile installs it non-fatally, LibreOffice
 * pattern): every exec path degrades with a plain-language error instead of crashing a run.
 */

const q = (s: string) => JSON.stringify(s);

/** The concat-demuxer list file body. Paths are quoted the way the demuxer expects. */
export function buildConcatList(files: string[]): string {
  return files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n') + '\n';
}

/** Lossless stream-copy join (same codec/params across clips — true for our pipeline). */
export function concatCmd(listFile: string, out: string): string {
  return `ffmpeg -v error -f concat -safe 0 -i ${q(listFile)} -c copy -y ${q(out)}`;
}

/**
 * A/V cross-dissolve between exactly two clips (re-encode). `offsetS` = where in clip A the
 * video fade begins (usually A's duration − fade).
 */
export function xfadeCmd(a: string, b: string, out: string, opts: { fadeS: number; offsetS: number }): string {
  const f = Math.max(0.2, Math.min(2, opts.fadeS));
  const o = Math.max(0, opts.offsetS);
  return (
    `ffmpeg -v error -i ${q(a)} -i ${q(b)} -filter_complex ` +
    `"[0:v][1:v]xfade=transition=fade:duration=${f}:offset=${o}[v];[0:a][1:a]acrossfade=d=${Math.min(2, f * 2)}[a]" ` +
    `-map "[v]" -map "[a]" -c:v libx264 -crf 20 -c:a aac -y ${q(out)}`
  );
}

/** Extract the final frame of a clip (the anchor for a frame-chained next scene). */
export function lastFrameCmd(clip: string, outJpg: string): string {
  return `ffmpeg -v error -sseof -0.15 -i ${q(clip)} -frames:v 1 -y ${q(outJpg)}`;
}

export function probeDurationCmd(clip: string): string {
  return `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 ${q(clip)}`;
}

const FFMPEG_MISSING =
  'video stitching is not available on this server (ffmpeg is not installed) — the scenes were still generated individually';

async function run(cmd: string, cwd: string, signal?: AbortSignal): Promise<string> {
  const r = await execBash(cmd, { cwd, timeoutMs: 180_000, signal });
  const out = (r.output || '').trim();
  if (/ffmpeg: (command )?not found|ffprobe: (command )?not found|No such file or directory: '?ff(mpeg|probe)/i.test(out)) {
    throw new Error(FFMPEG_MISSING);
  }
  return out;
}

export async function ffmpegAvailable(): Promise<boolean> {
  try {
    const r = await execBash('ffmpeg -version 2>/dev/null | head -1', { cwd: process.cwd(), timeoutMs: 15_000 });
    return /ffmpeg version/i.test(r.output || '');
  } catch {
    return false;
  }
}

/**
 * Join clips into one file. Default = lossless stream-copy cut; `transition:'dissolve'`
 * cross-fades each seam (re-encode, pairwise fold). Throws plain-language errors.
 */
export async function stitchClips(
  files: string[],
  outAbs: string,
  opts: { transition?: 'cut' | 'dissolve'; fadeS?: number; signal?: AbortSignal } = {},
): Promise<void> {
  if (files.length === 0) throw new Error('nothing to stitch — no scene clips were produced');
  const dir = path.dirname(outAbs);
  fs.mkdirSync(dir, { recursive: true });
  if (files.length === 1) {
    fs.copyFileSync(files[0], outAbs);
    return;
  }
  if ((opts.transition ?? 'cut') === 'cut') {
    const listFile = path.join(dir, `.concat-${Date.now()}.txt`);
    fs.writeFileSync(listFile, buildConcatList(files));
    try {
      await run(concatCmd(listFile, outAbs), dir, opts.signal);
    } finally {
      fs.rmSync(listFile, { force: true });
    }
  } else {
    // Pairwise fold: ((s1 ⨯ s2) ⨯ s3) … — each xfade needs the running clip's duration.
    const fadeS = opts.fadeS ?? 0.4;
    let acc = files[0];
    for (let i = 1; i < files.length; i++) {
      const durS = await probeDuration(acc, dir, opts.signal);
      const step = i === files.length - 1 ? outAbs : path.join(dir, `.xfade-${Date.now()}-${i}.mp4`);
      await run(xfadeCmd(acc, files[i], step, { fadeS, offsetS: Math.max(0, durS - fadeS) }), dir, opts.signal);
      if (acc !== files[0]) fs.rmSync(acc, { force: true });
      acc = step;
    }
  }
  if (!fs.existsSync(outAbs) || fs.statSync(outAbs).size < 10_000) {
    throw new Error('stitching produced no usable output');
  }
}

/** Extract a clip's final frame to a JPEG; returns the output path. */
export async function extractLastFrame(clipAbs: string, outJpgAbs: string, signal?: AbortSignal): Promise<string> {
  fs.mkdirSync(path.dirname(outJpgAbs), { recursive: true });
  await run(lastFrameCmd(clipAbs, outJpgAbs), path.dirname(outJpgAbs), signal);
  if (!fs.existsSync(outJpgAbs) || fs.statSync(outJpgAbs).size < 1_000) {
    throw new Error('could not extract the final frame of the previous scene');
  }
  return outJpgAbs;
}

/** Clip duration in seconds (0 on failure — callers treat 0 as "unknown", never crash). */
export async function probeDuration(clipAbs: string, cwd?: string, signal?: AbortSignal): Promise<number> {
  try {
    const out = await run(probeDurationCmd(clipAbs), cwd || path.dirname(clipAbs), signal);
    const n = Number(out.split('\n').pop());
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}
