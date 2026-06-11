import { useEffect } from 'react';
import { useStore } from '../state/sessionStore';
import { api } from './client';

/**
 * Per-session SSE subscription. On mount: load persisted detail first, then
 * attach the stream — the server replays the current run's buffered events,
 * which is exactly the delta missing from the persisted timeline.
 */
export function useSessionEvents(sessionId: string | null) {
  const loadDetail = useStore((s) => s.loadDetail);
  const applyEvent = useStore((s) => s.applyEvent);

  useEffect(() => {
    if (!sessionId) return;
    let es: EventSource | null = null;
    let cancelled = false;

    api
      .getSession(sessionId)
      .then((detail) => {
        if (cancelled) return;
        loadDetail(detail);
        es = new EventSource(`/api/sessions/${sessionId}/events`);
        es.onmessage = (msg) => {
          try {
            applyEvent(sessionId, JSON.parse(msg.data));
          } catch {}
        };
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      es?.close();
    };
  }, [sessionId, loadDetail, applyEvent]);
}

/** Global SSE channel keeping the sidebar (status dots, titles) live. */
export function useGlobalEvents(enabled: boolean) {
  const applyGlobalEvent = useStore((s) => s.applyGlobalEvent);

  useEffect(() => {
    if (!enabled) return;
    const es = new EventSource('/api/sessions-events');
    es.onmessage = (msg) => {
      try {
        applyGlobalEvent(JSON.parse(msg.data));
      } catch {}
    };
    return () => es.close();
  }, [enabled, applyGlobalEvent]);
}
