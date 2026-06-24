import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';
import type { ProgressPhase } from '../../../shared/types';

/**
 * Self-calibrating ETA: the static PHASE_TYPICAL_SEC heuristic is only a cold-start prior.
 * After each successful run we fold its REAL per-phase durations into an EWMA, so the "time
 * remaining" estimate converges on what THIS deployment actually does (a Droplet on a slow
 * link, a heavy-report tenant, etc.). Persisted as a tiny JSON on the data volume so it
 * survives restarts — no DB migration, dual-driver-agnostic, and a lost write is harmless
 * (it's a heuristic).
 *
 * Two levels of granularity, because the variance that drives "how long will this take?" is
 * the KIND of query, not just the mode (a one-line tweak and a multi-sheet financial model
 * are both `code` mode yet minutes apart):
 *   - a per-mode aggregate (key = `mode`) — the broad prior, always updated, reaches enough
 *     samples quickly, and
 *   - a per-(mode, task) bucket (key = `mode::task`, e.g. `code::finance.cashflow`) — the
 *     precise estimate for THAT kind of work once it has enough samples of its own.
 * Lookups prefer the task bucket per-phase and fall back to the mode aggregate, then to the
 * static prior — so the estimate is as specific as the history allows and degrades gracefully.
 * (Old files keyed by bare `mode` keep working: they're read as the mode aggregate.)
 */

type PhaseStat = { sec: number; n: number }; // EWMA seconds + sample count
type ModeStats = Partial<Record<ProgressPhase, PhaseStat>>;
type Store = Record<string, ModeStats>; // key (`mode` or `mode::task`) → stats

const FILE = path.join(config.dataDir, 'eta-calibration.json');
const ALPHA = 0.25; // EWMA weight on the newest run
const MIN_SAMPLES = 3; // don't trust a calibrated phase until we've seen it a few times
const MIN_SEC = 0.3; // ignore sub-second blips
const MAX_SEC = 1800; // ignore stalled/outlier phases
const SEP = '::'; // mode::task composite-key separator

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

/** Composite key for a (mode, task) bucket. A blank task → the bare mode aggregate. */
function keyFor(mode: string, task?: string | null): string {
  const t = (task ?? '').trim();
  return t ? `${mode}${SEP}${t}` : mode;
}

/** Trusted (≥ MIN_SAMPLES) learned seconds for a single bucket, or undefined. */
function trusted(stats: ModeStats | undefined): Partial<Record<ProgressPhase, number>> {
  const out: Partial<Record<ProgressPhase, number>> = {};
  if (!stats) return out;
  for (const [phase, stat] of Object.entries(stats) as [ProgressPhase, PhaseStat][]) {
    if (stat && stat.n >= MIN_SAMPLES) out[phase] = Math.round(stat.sec);
  }
  return out;
}

/** The learned typical seconds per phase for a query, as specific as the history allows.
 *  Prefers the (mode, task) bucket per-phase, falls back to the mode aggregate; phases with
 *  too few samples in both are omitted so the caller keeps the static prior for them.
 *  Returns undefined when there's nothing trustworthy yet. */
export function calibratedTypical(
  mode: string,
  task?: string | null,
): Partial<Record<ProgressPhase, number>> | undefined {
  const s = load();
  const modeLevel = trusted(s[mode]);
  const taskLevel = task ? trusted(s[keyFor(mode, task)]) : {};
  // Task-specific values win per-phase; mode aggregate fills the rest.
  const merged: Partial<Record<ProgressPhase, number>> = { ...modeLevel, ...taskLevel };
  return Object.keys(merged).length ? merged : undefined;
}

function fold(s: Store, key: string, durationsSec: Partial<Record<ProgressPhase, number>>): boolean {
  const m = (s[key] ??= {});
  let changed = false;
  for (const [phase, secRaw] of Object.entries(durationsSec) as [ProgressPhase, number][]) {
    const sec = Number(secRaw);
    if (!Number.isFinite(sec) || sec < MIN_SEC || sec > MAX_SEC) continue;
    const prev = m[phase];
    m[phase] = prev ? { sec: prev.sec * (1 - ALPHA) + sec * ALPHA, n: prev.n + 1 } : { sec, n: 1 };
    changed = true;
  }
  return changed;
}

/** Fold a finished run's real per-phase durations (seconds) into the EWMA — into BOTH the
 *  per-mode aggregate and, when a task is known, the per-(mode, task) bucket. */
export function recordRunDurations(
  mode: string,
  durationsSec: Partial<Record<ProgressPhase, number>>,
  task?: string | null,
): void {
  const s = load();
  let changed = fold(s, mode, durationsSec);
  const t = (task ?? '').trim();
  if (t) changed = fold(s, keyFor(mode, t), durationsSec) || changed;
  if (changed) persist(s);
}

/** Test-only: drop the in-memory cache so a temp DATA_DIR is re-read. */
export function _resetEtaCalibrationCache(): void {
  cache = null;
}
