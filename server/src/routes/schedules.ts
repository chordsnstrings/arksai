import type { FastifyInstance } from 'fastify';
import type { CreateScheduleRequest } from '../../../shared/types';
import { createSchedule, deleteSchedule, listSchedules, setEnabled } from '../schedule/scheduler';
import { scopeOf } from '../auth';

// All schedule endpoints are ORG-SCOPED (the org comes from the authenticated
// identity, never the client): a tenant only ever lists/creates/edits/deletes its
// own org's schedules — never another org's.
export function registerScheduleRoutes(app: FastifyInstance) {
  app.get('/api/schedules', async (req) => ({ schedules: await listSchedules(scopeOf(req)) }));

  app.post('/api/schedules', async (req, reply) => {
    const b = (req.body ?? {}) as CreateScheduleRequest;
    if (!b.prompt || !String(b.prompt).trim()) return reply.code(400).send({ error: 'A prompt is required.' });
    if (!b.label || !String(b.label).trim()) return reply.code(400).send({ error: 'A label is required.' });
    const s = await createSchedule(b, req.identity?.orgId ?? null);
    return reply.code(201).send(s);
  });

  app.patch('/api/schedules/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = (req.body ?? {}) as { enabled?: boolean };
    if (typeof b.enabled === 'boolean') await setEnabled(id, b.enabled, scopeOf(req));
    return reply.send({ ok: true });
  });

  app.delete('/api/schedules/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    await deleteSchedule(id, scopeOf(req));
    return reply.send({ ok: true });
  });
}
