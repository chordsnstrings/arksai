import type { FastifyInstance } from 'fastify';
import * as store from '../sessions/store';

const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

// Custom commands are ORG-SCOPED: the org comes from the authenticated identity, so
// a tenant only ever lists/creates/edits/deletes its OWN org's commands (and two
// orgs can each define the same command name without colliding).
export function registerCommandRoutes(app: FastifyInstance) {
  app.get('/api/commands', async (req) => ({ commands: await store.listCommands(req.identity?.orgId ?? null) }));

  app.put('/api/commands/:name', async (req, reply) => {
    const { name } = req.params as { name: string };
    const body = (req.body ?? {}) as { description?: string; template?: string };
    const lower = name.toLowerCase();
    if (!NAME_RE.test(lower)) {
      return reply.code(400).send({ error: 'Name must be lowercase letters, digits, and hyphens.' });
    }
    if (!body.template?.trim()) return reply.code(400).send({ error: 'Template is required.' });
    return store.upsertCommand(req.identity?.orgId ?? null, lower, (body.description ?? '').slice(0, 200), body.template);
  });

  app.delete('/api/commands/:name', async (req) => {
    const { name } = req.params as { name: string };
    await store.deleteCommand(req.identity?.orgId ?? null, name.toLowerCase());
    return { ok: true };
  });
}
