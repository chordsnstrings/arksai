import type { FastifyInstance } from 'fastify';
import type {
  CreateSessionRequest,
  PatchSessionRequest,
  SendMessageRequest,
  SessionDetail,
} from '../../../shared/types';
import { MODELS, SESSION_MODES } from '../../../shared/types';
import { randomUUID } from 'node:crypto';
import * as store from '../sessions/store';
import * as manager from '../sessions/manager';
import { deleteWorkspace, parseRepoUrl, setupWorkspace } from '../sessions/workspace';
import { bus } from '../events/bus';

export function registerSessionRoutes(app: FastifyInstance) {
  app.get('/api/sessions', async () => store.listSessions());

  app.post('/api/sessions', async (req, reply) => {
    const body = (req.body ?? {}) as CreateSessionRequest;
    let repoUrl: string | null = null;
    let repoName: string | null = null;
    if (body.repoUrl?.trim()) {
      const parsed = parseRepoUrl(body.repoUrl);
      if (!parsed) {
        return reply.code(400).send({ error: 'Invalid repo. Use https://github.com/owner/repo or owner/repo.' });
      }
      repoUrl = parsed.url;
      repoName = parsed.name;
    }
    const mode = SESSION_MODES.includes(body.mode as any) ? body.mode! : 'code';
    const model = MODELS.includes(body.model as any) ? body.model! : 'deepseek-chat';
    const session = store.createSession({
      repoUrl,
      repoName,
      branch: body.branch?.trim() || null,
      mode,
      model,
    });
    bus.emitGlobal({ type: 'session_status', session });
    void setupWorkspace(session).catch((err) => console.error('[workspace]', err));
    return reply.code(201).send(session);
  });

  app.get('/api/sessions/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const meta = store.getSession(id);
    if (!meta) return reply.code(404).send({ error: 'Not found' });
    const detail: SessionDetail = { meta, timeline: store.getTimeline(id) };
    return detail;
  });

  app.patch('/api/sessions/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const meta = store.getSession(id);
    if (!meta) return reply.code(404).send({ error: 'Not found' });
    if (manager.isRunning(id)) return reply.code(409).send({ error: 'Cannot change settings mid-run' });
    const body = (req.body ?? {}) as PatchSessionRequest;
    const patch: PatchSessionRequest = {};
    if (SESSION_MODES.includes(body.mode as any)) patch.mode = body.mode;
    if (MODELS.includes(body.model as any)) patch.model = body.model;
    store.updateSession(id, patch);
    const updated = store.getSession(id)!;
    bus.sessionChanged(updated);
    return updated;
  });

  app.delete('/api/sessions/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!store.getSession(id)) return reply.code(404).send({ error: 'Not found' });
    manager.interrupt(id);
    deleteWorkspace(id);
    store.deleteSession(id);
    bus.emitGlobal({ type: 'session_deleted', sessionId: id });
    return { ok: true };
  });

  app.post('/api/sessions/:id/messages', async (req, reply) => {
    const { id } = req.params as { id: string };
    const meta = store.getSession(id);
    if (!meta) return reply.code(404).send({ error: 'Not found' });
    const body = (req.body ?? {}) as SendMessageRequest;
    const text = String(body.text ?? '').trim();
    if (!text) return reply.code(400).send({ error: 'Empty message' });

    store.appendTimeline(id, { kind: 'user', id: randomUUID(), text, ts: Date.now() });
    const result = manager.startRun(id, text);
    if (!result.ok) return reply.code(result.code).send({ error: result.error });
    return reply.code(202).send({ ok: true });
  });

  app.post('/api/sessions/:id/interrupt', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!store.getSession(id)) return reply.code(404).send({ error: 'Not found' });
    const interrupted = manager.interrupt(id);
    return { ok: true, interrupted };
  });

  app.post('/api/sessions/:id/clear', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!store.getSession(id)) return reply.code(404).send({ error: 'Not found' });
    if (manager.isRunning(id)) return reply.code(409).send({ error: 'Cannot clear mid-run' });
    store.clearConversation(id);
    store.updateSession(id, { status: 'idle', diffStat: null });
    bus.sessionChanged(store.getSession(id)!);
    return { ok: true };
  });
}
