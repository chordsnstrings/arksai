import { useEffect } from 'react';
import { useStore } from '../state/sessionStore';
import { api } from './client';

/**
 * Per-session SSE subscription. On mount: load persisted detail first, then attach the stream
 * (the server replays the current run's buffered events). Survives server restarts: a restart
 * behind the proxy returns a 502, which closes EventSource for good (the browser only auto-retries
 * network drops, not HTTP errors) — so we reconnect ourselves, and on every RECONNECT we re-pull
 * the session so a run that ended / errored / auto-resumed while we were disconnected is reflected.
 * Without this, a run interrupted by a restart left the spinner stuck forever.
 */
export function useSessionEvents(sessionId: string | null) {
  const loadDetail = useStore((s) => s.loadDetail);
  const applyEvent = useStore((s) => s.applyEvent);

  useEffect(() => {
    if (!sessionId) return;
    let es: EventSource | null = null;
    let cancelled = false;
    let opened = false;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const sync = () =>
      api
        .getSession(sessionId)
        .then((detail) => {
          if (!cancelled) loadDetail(detail); // running = (status === 'running') → clears a stale spinner
        })
        .catch(() => {});

    const connect = () => {
      if (cancelled) return;
      es = new EventSource(`/api/sessions/${sessionId}/events`);
      es.onopen = () => {
        if (opened) sync(); // reconnected after a drop/restart → re-sync the truth
        opened = true;
      };
      es.onmessage = (msg) => {
        try {
          applyEvent(sessionId, JSON.parse(msg.data));
        } catch {}
      };
      es.onerror = () => {
        // CLOSED = a fatal error (e.g. the 502 while the server restarts). Reconnect with backoff.
        if (es && es.readyState === EventSource.CLOSED) {
          es.close();
          if (!cancelled && !retry) retry = setTimeout(() => { retry = null; connect(); }, 2000);
        }
      };
    };

    sync().then(() => connect());

    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
      es?.close();
    };
  }, [sessionId, loadDetail, applyEvent]);
}

/** Global SSE channel keeping the sidebar (status dots, titles) live — also restart-resilient. */
export function useGlobalEvents(enabled: boolean) {
  const applyGlobalEvent = useStore((s) => s.applyGlobalEvent);
  const setSessions = useStore((s) => s.setSessions);

  useEffect(() => {
    if (!enabled) return;
    let es: EventSource | null = null;
    let stopped = false;
    let opened = false;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (stopped) return;
      es = new EventSource('/api/sessions-events');
      es.onopen = () => {
        // On reconnect, refresh the list so sidebar status dots re-sync (a run cleared to idle/error
        // during a restart, or a resumed one).
        if (opened) api.listSessions().then((l) => !stopped && setSessions(l)).catch(() => {});
        opened = true;
      };
      es.onmessage = (msg) => {
        try {
          applyGlobalEvent(JSON.parse(msg.data));
        } catch {}
      };
      es.onerror = () => {
        if (es && es.readyState === EventSource.CLOSED) {
          es.close();
          if (!stopped && !retry) retry = setTimeout(() => { retry = null; connect(); }, 2500);
        }
      };
    };
    connect();

    return () => {
      stopped = true;
      if (retry) clearTimeout(retry);
      es?.close();
    };
  }, [enabled, applyGlobalEvent, setSessions]);
}
