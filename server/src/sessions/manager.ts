import { AgentRun } from '../agent/runner';
import { config } from '../config';
import * as store from './store';

/** Live AgentRun registry: one run per session, global concurrency cap. */
const liveRuns = new Map<string, AgentRun>();

export function isRunning(sessionId: string): boolean {
  return liveRuns.has(sessionId);
}

export function startRun(sessionId: string, userText: string): { ok: true } | { ok: false; error: string; code: number } {
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
  const session = store.getSession(sessionId);
  if (!session) return { ok: false, error: 'Session not found.', code: 404 };

  const run = new AgentRun(session);
  liveRuns.set(sessionId, run);
  void run
    .run(userText)
    .catch((err) => console.error(`[run ${sessionId}] crashed:`, err))
    .finally(() => liveRuns.delete(sessionId));
  return { ok: true };
}

export function interrupt(sessionId: string): boolean {
  const run = liveRuns.get(sessionId);
  if (!run) return false;
  run.interrupt();
  return true;
}
