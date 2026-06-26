import { AgentRun } from '../agent/runner';
import { config } from '../config';
import { processRegistry } from '../agent/processes';
import { ensureRepoCloned } from './workspace';
import * as store from './store';

/** Live AgentRun registry: one run per session, global concurrency cap. */
const liveRuns = new Map<string, AgentRun>();

export function isRunning(sessionId: string): boolean {
  return liveRuns.has(sessionId);
}

export async function startRun(
  sessionId: string,
  userText: string,
): Promise<{ ok: true } | { ok: false; error: string; code: number }> {
  if (liveRuns.has(sessionId)) {
    return { ok: false, error: 'A run is already active for this session.', code: 409 };
  }
  if (liveRuns.size >= config.maxConcurrentRuns) {
    return {
      ok: false,
      error: `Too many concurrent runs (max ${config.maxConcurrentRuns}). Try again shortly.`,
      code: 429,
    };
  }
  let session = await store.getSession(sessionId);
  if (!session) return { ok: false, error: 'Session not found.', code: 404 };

  // If a repo was connected to this session but never cloned (e.g. attached via the Connect modal
  // AFTER creation), pull it in now so the agent actually has the code to read/edit — then re-load
  // the session so the run sees the resolved branch. Best-effort; an empty/failed clone still runs.
  try {
    if (await ensureRepoCloned(session)) session = (await store.getSession(sessionId)) || session;
  } catch (err) {
    console.error(`[run ${sessionId}] clone-on-demand failed:`, err);
  }

  const run = new AgentRun(session);
  liveRuns.set(sessionId, run);
  void run
    .run(userText)
    .catch((err) => console.error(`[run ${sessionId}] crashed:`, err))
    .finally(() => liveRuns.delete(sessionId));
  return { ok: true };
}

export function interrupt(sessionId: string): boolean {
  // Stop runaway background servers too, not just the agent loop.
  processRegistry.killAllForSession(sessionId);
  const run = liveRuns.get(sessionId);
  if (!run) return false;
  run.interrupt();
  return true;
}
