import type { FastifyInstance } from 'fastify';
import * as store from '../sessions/store';
import { orgScope } from '../orgs/store';

/**
 * Memory API. ORG ISOLATION is enforced here: an org member can only read, write,
 * or delete memory in THEIR OWN org's shared scope (`org:<their orgId>`) — never the
 * deployment-wide `global` scope and never another org's. The org id comes from the
 * authenticated identity, never from client input. The platform operator
 * (super-admin) manages the deployment-global scope as before.
 */
export function registerMemoryRoutes(app: FastifyInstance) {
  app.get('/api/memory', async (req, reply) => {
    const id = req.identity;
    if (!id) return reply.code(401).send({ error: 'Unauthorized' });
    // Org member → ONLY their org's shared memory.
    if (id.orgId && !id.isSuperadmin) {
      return { memory: await store.listMemory([orgScope(id.orgId)]) };
    }
    // Operator / super-admin → deployment-global (+ an optional requested scope).
    const scope = (req.query as any)?.scope as string | undefined;
    const scopes = scope && scope !== 'global' ? ['global', scope] : ['global'];
    return { memory: await store.listMemory(scopes) };
  });

  app.post('/api/memory', async (req, reply) => {
    const id = req.identity;
    if (!id) return reply.code(401).send({ error: 'Unauthorized' });
    const body = (req.body ?? {}) as { scope?: string; text?: string };
    const text = String(body.text ?? '').trim();
    if (!text) return reply.code(400).send({ error: 'Empty memory' });
    // Org member → force their own org scope, ignoring any client-supplied scope.
    const scope = id.orgId && !id.isSuperadmin ? orgScope(id.orgId) : (body.scope ?? 'global').trim() || 'global';
    return store.addMemory(scope, text.slice(0, 2000));
  });

  app.delete('/api/memory/:id', async (req, reply) => {
    const id = req.identity;
    if (!id) return reply.code(401).send({ error: 'Unauthorized' });
    const { id: memId } = req.params as { id: string };
    // Org member → may only delete entries that live in their own org scope.
    if (id.orgId && !id.isSuperadmin) {
      const own = await store.listMemory([orgScope(id.orgId)]).catch(() => []);
      if (!own.some((e) => e.id === memId)) return reply.code(404).send({ error: 'Not found' });
    }
    await store.deleteMemory(memId);
    return { ok: true };
  });
}
