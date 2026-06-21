import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';
import type { ProgressPhase } from '../../../shared/types';

/**
 * Self-calibrating ETA: the static PHASE_TYPICAL_SEC heuristic is only a cold-start prior.
 * After each successful run we fold its REAL per-phase durations into a per-mode EWMA, so the
 * "time remaining" estimate converges on what THIS deployment actually does (a Droplet on a
 * slow link, a heavy-report tenant, etc.). Persisted as a tiny JSON on the data volume so it
 * survives restarts — no DB migration, dual-driver-agnostic, and a lost write is harmless
 * (it's a heuristic). Keyed by mode; only phases with enough samples are trusted.
 */

type PhaseStat = { sec: number; n: number }; // EWMA seconds + sample count
type ModeStats = Partial<Record<ProgressPhase, PhaseStat>>;
type Store = Record<string, ModeStats>; // mode → stats

const FILE = path.join(config.dataDir, 'eta-calibration.json');
const ALPHA = 0.25; // EWMA weight on the newest run
const MIN_SAMPLES = 3; // don't trust a calibrated phase until we've seen it a few times
const MIN_SEC = 0.3; // ignore sub-second blips
const MAX_SEC = 1800; // ignore stalled/outlier phases

let cache: Store | null = null;

function load(): Store {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(FILE, 'utf8')) as Store;
  } catch {
    cache = {};
  }
  return cache;
}

function persist(s: Store): void {
  try {
    fs.mkdirSync(config.dataDir, { recursive: true });
    const tmp = `${FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(s));
    fs.renameSync(tmp, FILE); // atomic
  } catch {
    /* best-effort: a missing calibration just means we use the static prior */
  }
}

/** The learned typical seconds per phase for a mode (only phases with ≥ MIN_SAMPLES runs).
 *  Returns undefined when there's nothing trustworthy yet → caller keeps the static prior. */
export function calibratedTypical(mode: string): Partial<Record<ProgressPhase, number>> | undefined {
  const m = load()[mode];
  if (!m) return undefined;
  const out: Partial<Record<ProgressPhase, number>> = {};
  let any = false;
  for (const [phase, stat] of Object.entries(m) as [ProgressPhase, PhaseStat][]) {
    if (stat && stat.n >= MIN_SAMPLES) {
      out[phase] = Math.round(stat.sec);
      any = true;
    }
  }
  return any ? out : undefined;
}

/** Fold a finished run's real per-phase durations (seconds) into the per-mode EWMA. */
export function recordRunDurations(mode: string, durationsSec: Partial<Record<ProgressPhase, number>>): void {
  const s = load();
  const m = (s[mode] ??= {});
  let changed = false;
  for (const [phase, secRaw] of Object.entries(durationsSec) as [ProgressPhase, number][]) {
    const sec = Number(secRaw);
    if (!Number.isFinite(sec) || sec < MIN_SEC || sec > MAX_SEC) continue;
    const prev = m[phase];
    m[phase] = prev ? { sec: prev.sec * (1 - ALPHA) + sec * ALPHA, n: prev.n + 1 } : { sec, n: 1 };
    changed = true;
  }
  if (changed) persist(s);
}

/** Test-only: drop the in-memory cache so a temp DATA_DIR is re-read. */
export function _resetEtaCalibrationCache(): void {
  cache = null;
}
