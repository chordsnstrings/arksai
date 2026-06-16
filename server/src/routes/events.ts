import type { FastifyInstance } from 'fastify';
import { bus } from '../events/bus';
import { lastEventId, openSse } from '../lib/sse';
import { scopeOf } from '../auth';
import * as store from '../sessions/store';

export function registerEventRoutes(app: FastifyInstance) {
  // Per-session event stream with Last-Event-ID replay (mid-run reconnects).
  // Scoped: a cross-org session id resolves to null → 404 (defence-in-depth on
  // top of the global sessions preHandler).
  app.get('/api/sessions/:id/events', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await store.getSession(id, scopeOf(req)))) {
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

  // Global stream for sidebar status dots / titles. ORG-SCOPED: a request only
  // receives events for ITS OWN org's sessions (never another org's titles/status) —
  // the operator is scoped to its own workspace too. Only internal/unscoped (no
  // org-bound identity) sees all.
  app.get('/api/sessions-events', (req, reply) => {
    const scope = scopeOf(req);
    const onlyOrg = scope ? scope.orgId : null; // operator included; null only for unscoped/internal
    const channel = openSse(req, reply);
    const unsubscribe = bus.subscribeGlobal((e) => {
      if (onlyOrg !== null) {
        const evOrg = e.type === 'session_status' ? e.session.orgId : e.orgId;
        if (evOrg !== onlyOrg) return; // don't leak another org's session metadata
      }
      channel.send(e);
    });
    channel.onClose(unsubscribe);
  });
}
