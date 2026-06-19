import type { FastifyInstance } from 'fastify';
import { scopeOf } from '../auth';
import { listIncidents, setIncidentStatus } from '../incidents/store';
import { config } from '../config';

/** Operator-only view of captured incidents (self-healing). Metadata only. */
export function registerIncidentRoutes(app: FastifyInstance) {
  app.get('/api/admin/incidents', async (req, reply) => {
    const s = scopeOf(req);
    if (!s?.isSuperadmin) return reply.code(403).send({ error: 'Operator only.' });
    const { status } = (req.query ?? {}) as { status?: string };
    return { enabled: config.autoHeal, incidents: await listIncidents(status) };
  });

  app.post('/api/admin/incidents/:id/status', async (req, reply) => {
    const s = scopeOf(req);
    if (!s?.isSuperadmin) return reply.code(403).send({ error: 'Operator only.' });
    const { id } = req.params as { id: string };
    const { status } = (req.body ?? {}) as { status?: string };
    if (!['open', 'fixing', 'resolved', 'wontfix'].includes(String(status))) {
      return reply.code(400).send({ error: 'Bad status' });
    }
    await setIncidentStatus(id, status as any);
    return { ok: true };
  });
}
