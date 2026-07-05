import fs from 'node:fs';
import path from 'node:path';
import { execBash } from '../../lib/exec';
import { frameCount, frameName } from './encode';

/**
 * Deterministic motion QC — the checks the 2026-07-05 audit proved the vision spot-frames
 * could never make (a frozen scene passes two spot frames by construction; a 65%-empty
 * frame reads "clean"). Pure command builders + parsers, exec wrappers kept thin.
 *
 * 1. STILLNESS: pixel-diff pairs of already-captured frames 0.5s apart at 40/60/80% of the
 *    scene. ffmpeg blend=difference + signalstats YAVG — 0.00 means bit-identical (both
 *    delivered LDL videos measured 0.00 over 5s spans). A static scene is a HARD failure.
 * 2. FRAME FILL: 3×3 grid of YSTDEV per cell on the mid frame — a cell of one flat color
 *    has ~0 luma deviation. ≥6 flat cells = a mostly-empty frame (advisory defect: some
 *    deliberately sparse beats are legitimate, so this reports rather than fails).
 */

const q = (s: string) => JSON.stringify(s);

/** Mean luma of the difference between two stills — 0 = identical frames. */
export function frameDiffCmd(a: string, b: string): string {
  return (
    `ffmpeg -hide_banner -loglevel info -i ${q(a)} -i ${q(b)} ` +
    `-filter_complex "[0:v][1:v]blend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-" ` +
    `-frames:v 1 -f null -`
  );
}

/** Luma standard deviation of one region of a still (flat color ⇒ ~0). */
export function cellStdevCmd(frame: string, cell: { w: number; h: number; x: number; y: number }): string {
  return (
    `ffmpeg -hide_banner -loglevel info -i ${q(frame)} ` +
    `-vf "crop=${cell.w}:${cell.h}:${cell.x}:${cell.y},signalstats,metadata=print:key=lavfi.signalstats.YSTDEV:file=-" ` +
    `-frames:v 1 -f null -`
  );
}

export function parseSignalstat(output: string, key: 'YAVG' | 'YSTDEV'): number | null {
  const m = output.match(new RegExp(`signalstats\\.${key}=([0-9.]+)`));
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/** The frame-index pairs (0.5s apart, at 40/60/80%) the stillness audit samples. Pure. */
export function stillnessPairs(durationMs: number, fps: number): Array<[number, number]> {
  const total = frameCount(durationMs, fps);
  const gap = Math.max(1, Math.round(fps * 0.5));
  const pairs: Array<[number, number]> = [];
  for (const frac of [0.4, 0.6, 0.8]) {
    const i = Math.min(total - 1, Math.max(0, Math.floor(total * frac)));
    const j = Math.min(total - 1, i + gap);
    if (j > i && !pairs.some(([a, b]) => a === i && b === j)) pairs.push([i, j]);
  }
  return pairs;
}

export interface StillnessVerdict {
  maxDiff: number;
  sampled: number;
  static: boolean;
}

const STILLNESS_THRESHOLD = 0.18; // YAVG of the diff; alive scenes with a camera move clear this by 5-50×

/** Measure motion across the captured frames of one scene (frames still on disk). */
export async function auditSceneMotion(
  framesDir: string,
  durationMs: number,
  fps: number,
  signal?: AbortSignal,
): Promise<StillnessVerdict | null> {
  const pairs = stillnessPairs(durationMs, fps);
  let maxDiff = 0;
  let sampled = 0;
  for (const [i, j] of pairs) {
    const a = path.join(framesDir, frameName(i));
    const b = path.join(framesDir, frameName(j));
    if (!fs.existsSync(a) || !fs.existsSync(b)) continue;
    try {
      const r = await execBash(frameDiffCmd(a, b), { cwd: framesDir, timeoutMs: 30_000, signal });
      const v = parseSignalstat(r.output || '', 'YAVG');
      if (v == null) continue;
      sampled++;
      maxDiff = Math.max(maxDiff, v);
    } catch {
      /* measurement is best-effort per pair */
    }
  }
  if (!sampled) return null; // could not measure — never fail a scene on missing evidence
  return { maxDiff, sampled, static: maxDiff < STILLNESS_THRESHOLD };
}

export interface FillVerdict {
  flatCells: number; // of 9
  mostlyEmpty: boolean;
}

const FLAT_STDEV = 1.1; // a wash-gradient cell measures above this; a solid color ~0

/** 3×3 ink-coverage audit on one captured frame. */
export async function auditFrameFill(
  frameAbs: string,
  width: number,
  height: number,
  signal?: AbortSignal,
): Promise<FillVerdict | null> {
  if (!fs.existsSync(frameAbs)) return null;
  const cw = Math.floor(width / 3);
  const ch = Math.floor(height / 3);
  let flat = 0;
  let measured = 0;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      try {
        const res = await execBash(cellStdevCmd(frameAbs, { w: cw, h: ch, x: c * cw, y: r * ch }), {
          cwd: path.dirname(frameAbs),
          timeoutMs: 20_000,
          signal,
        });
        const v = parseSignalstat(res.output || '', 'YSTDEV');
        if (v == null) continue;
        measured++;
        if (v < FLAT_STDEV) flat++;
      } catch {
        /* best-effort */
      }
    }
  }
  if (measured < 6) return null;
  return { flatCells: flat, mostlyEmpty: flat >= 6 };
}

/** Uniform-pacing detector: true when every scene sits within ±15% of the median. Pure. */
export function isPacingMonotone(durationsMs: number[]): boolean {
  if (durationsMs.length < 4) return false;
  const sorted = [...durationsMs].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  if (!median) return false;
  return durationsMs.every((d) => Math.abs(d - median) / median <= 0.15);
}

/** Hook-killer opening lines — rejected before any TTS is paid for. Pure. */
export function hookProblems(firstNarration: string): string | null {
  const t = firstNarration.trim();
  if (!t) return null; // silent opening beat is allowed (visual hook)
  const throatClearing =
    /^(hi\b|hello\b|hey\b|welcome\b|good (morning|afternoon|evening)|today,? (we|i|let)|in this video|this video (is|will|covers)|let's talk about|we're going to (talk|look|discuss)|i'm going to (show|tell|walk)|(this is|here's) a video about)/i;
  if (throatClearing.test(t)) {
    return (
      `scene 1 opens with throat-clearing ("${t.slice(0, 60)}…") — 55% of viewers are lost in the first minute. ` +
      `Open with the payoff as a QUESTION, a BOLD CLAIM, a STAKE or a SHOCKING NUMBER (see motion-kit/MOTION.md "THE HOOK" templates), never a greeting or topic statement.`
    );
  }
  const w = t.split(/\s+/).filter(Boolean).length;
  if (w > 30) {
    return `scene 1 narration is ${w} words — a hook beat is ≤5 seconds (~12 words). Cut it to one sharp question/claim and move the rest to scene 2.`;
  }
  return null;
}
