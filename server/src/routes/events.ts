import type { FastifyInstance } from 'fastify';
import { bus } from '../events/bus';
import { lastEventId, openSse } from '../lib/sse';
import * as store from '../sessions/store';

export function registerEventRoutes(app: FastifyInstance) {
  // Per-session event stream with Last-Event-ID replay (mid-run reconnects).
  app.get('/api/sessions/:id/events', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await store.getSession(id))) {
      reply.code(404).send({ error: 'Not found' });
      return;
    }
    const channel = openSse(req, reply);
    const after = lastEventId(req);
    for (const buffered of bus.replayAfter(id, after)) {
      channel.send(buffered.event, buffered.seq);
    }
    const unsubscribe = bus.subscribe(id, (e) => channel.send(e.event, e.seq));
    channel.onClose(unsubscribe);
  });

  // Global stream for sidebar status dots / titles.
  app.get('/api/sessions-events', (req, reply) => {
    const channel = openSse(req, reply);
    const unsubscribe = bus.subscribeGlobal((e) => channel.send(e));
    channel.onClose(unsubscribe);
  });
}
