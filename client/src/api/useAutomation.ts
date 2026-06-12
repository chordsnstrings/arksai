import { useEffect, useRef } from 'react';
import { api } from './client';
import { useStore } from '../state/sessionStore';

const GOAL_SENTINEL = 'GOAL_ACHIEVED';
const MAX_GOAL_ROUNDS = 12;

// Loop timers live outside React state.
const loopTimers = new Map<string, ReturnType<typeof setInterval>>();

export function clearLoopTimer(sessionId: string) {
  const t = loopTimers.get(sessionId);
  if (t) clearInterval(t);
  loopTimers.delete(sessionId);
}

export function startLoopTimer(sessionId: string, prompt: string, intervalMs: number) {
  clearLoopTimer(sessionId);
  loopTimers.set(
    sessionId,
    setInterval(() => {
      const live = useStore.getState().live[sessionId];
      if (!live?.running) api.sendMessage(sessionId, prompt).catch(() => {});
    }, intervalMs),
  );
}

/**
 * Drives /goal (auto-continue until a condition is met) by watching each run
 * finish and either declaring success or sending a continuation prompt.
 */
export function useAutomation(sessionId: string | null) {
  const running = useStore((s) => (sessionId ? s.live[sessionId]?.running : false));
  const wasRunning = useRef(false);

  useEffect(() => {
    if (!sessionId) return;
    const justFinished = wasRunning.current && !running;
    wasRunning.current = !!running;
    if (!justFinished) return;

    const store = useStore.getState();
    const auto = store.automation[sessionId];
    if (!auto?.goalCondition) return;

    const items = store.live[sessionId]?.items ?? [];
    const lastAssistant = [...items].reverse().find((i) => i.kind === 'assistant') as { text: string } | undefined;
    const achieved = lastAssistant?.text.includes(GOAL_SENTINEL);

    if (achieved) {
      store.addLocalSystem(sessionId, `✅ Goal reached: ${auto.goalCondition}`);
      store.setAutomation(sessionId, null);
      return;
    }
    if (auto.goalRounds >= MAX_GOAL_ROUNDS) {
      store.addLocalSystem(sessionId, `Goal stopped after ${MAX_GOAL_ROUNDS} rounds — needs your input.`, 'error');
      store.setAutomation(sessionId, null);
      return;
    }
    store.setAutomation(sessionId, { ...auto, goalRounds: auto.goalRounds + 1 });
    const msg =
      `Continue working toward this goal: ${auto.goalCondition}\n\n` +
      `When it is fully achieved, reply with ${GOAL_SENTINEL} on its own line. ` +
      `If you are blocked and need my input, say so instead of continuing.`;
    store.addUserMessage(sessionId, `↻ (auto) continuing toward goal`);
    api.sendMessage(sessionId, msg).catch(() => {});
  }, [running, sessionId]);
}

export { GOAL_SENTINEL };
