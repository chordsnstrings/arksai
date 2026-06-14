import type { FastifyInstance } from 'fastify';
import type { CreateScheduleRequest } from '../../../shared/types';
import { createSchedule, deleteSchedule, listSchedules, setEnabled } from '../schedule/scheduler';

export function registerScheduleRoutes(app: FastifyInstance) {
  app.get('/api/schedules', async () => ({ schedules: await listSchedules() }));

  app.post('/api/schedules', async (req, reply) => {
    const b = (req.body ?? {}) as CreateScheduleRequest;
    if (!b.prompt || !String(b.prompt).trim()) return reply.code(400).send({ error: 'A prompt is required.' });
    if (!b.label || !String(b.label).trim()) return reply.code(400).send({ error: 'A label is required.' });
    const s = await createSchedule(b);
    return reply.code(201).send(s);
  });

  app.patch('/api/schedules/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = (req.body ?? {}) as { enabled?: boolean };
    if (typeof b.enabled === 'boolean') await setEnabled(id, b.enabled);
    return reply.send({ ok: true });
  });

  app.delete('/api/schedules/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    await deleteSchedule(id);
    return reply.send({ ok: true });
  });
}
