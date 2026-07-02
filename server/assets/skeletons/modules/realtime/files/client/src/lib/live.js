import { useEffect } from 'react';

/** Subscribe to a live event: useLive('item.created', (data) => …). Auto-reconnects. */
export function useLive(event, handler) {
  useEffect(() => {
    const es = new EventSource('/api/live/events');
    es.addEventListener(event, (e) => { try { handler(JSON.parse(e.data)); } catch {} });
    return () => es.close();
  }, [event]);
}
