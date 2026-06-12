import type { FastifyInstance } from 'fastify';
import * as store from '../sessions/store';

export function registerMemoryRoutes(app: FastifyInstance) {
  // ?scope=owner/repo also returns that repo's project memory alongside global
  app.get('/api/memory', async (req) => {
    const scope = (req.query as any)?.scope as string | undefined;
    const scopes = scope && scope !== 'global' ? ['global', scope] : ['global'];
    return { memory: await store.listMemory(scopes) };
  });

  app.post('/api/memory', async (req, reply) => {
    const body = (req.body ?? {}) as { scope?: string; text?: string };
    const text = String(body.text ?? '').trim();
    if (!text) return reply.code(400).send({ error: 'Empty memory' });
    const scope = (body.scope ?? 'global').trim() || 'global';
    return store.addMemory(scope, text.slice(0, 2000));
  });

  app.delete('/api/memory/:id', async (req) => {
    const { id } = req.params as { id: string };
    await store.deleteMemory(id);
    return { ok: true };
  });
}
