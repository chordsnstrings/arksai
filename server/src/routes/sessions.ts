import type { FastifyInstance } from 'fastify';
import type {
  CreateSessionRequest,
  PatchSessionRequest,
  SendMessageRequest,
  SessionDetail,
} from '../../../shared/types';
import { DEFAULT_MODEL, SESSION_MODES } from '../../../shared/types';
import { randomUUID } from 'node:crypto';
import * as store from '../sessions/store';
import * as manager from '../sessions/manager';
import { isValidModel } from '../agent/models';
import { deleteWorkspace, fullDiff, listFiles, parseRepoUrl, setupWorkspace } from '../sessions/workspace';
import { bus } from '../events/bus';
import { processRegistry } from '../agent/processes';

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
    const model = body.model && (await isValidModel(body.model)) ? body.model : DEFAULT_MODEL;
    const session = await store.createSession({
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
    const meta = await store.getSession(id);
    if (!meta) return reply.code(404).send({ error: 'Not found' });
    const detail: SessionDetail = { meta, timeline: await store.getTimeline(id) };
    return detail;
  });

  app.patch('/api/sessions/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const meta = await store.getSession(id);
    if (!meta) return reply.code(404).send({ error: 'Not found' });
    if (manager.isRunning(id)) return reply.code(409).send({ error: 'Cannot change settings mid-run' });
    const body = (req.body ?? {}) as PatchSessionRequest;
    const patch: PatchSessionRequest = {};
    if (SESSION_MODES.includes(body.mode as any)) patch.mode = body.mode;
    if (body.model && (await isValidModel(body.model))) patch.model = body.model;
    if (typeof body.title === 'string' && body.title.trim()) patch.title = body.title.trim().slice(0, 80);
    await store.updateSession(id, patch);
    const updated = (await store.getSession(id))!;
    bus.sessionChanged(updated);
    return updated;
  });

  app.delete('/api/sessions/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await store.getSession(id))) return reply.code(404).send({ error: 'Not found' });
    manager.interrupt(id);
    processRegistry.killAllForSession(id);
    deleteWorkspace(id);
    await store.deleteSession(id);
    bus.emitGlobal({ type: 'session_deleted', sessionId: id });
    return { ok: true };
  });

  app.post('/api/sessions/:id/messages', async (req, reply) => {
    const { id } = req.params as { id: string };
    const meta = await store.getSession(id);
    if (!meta) return reply.code(404).send({ error: 'Not found' });
    const body = (req.body ?? {}) as SendMessageRequest;
    const text = String(body.text ?? '').trim();
    if (!text) return reply.code(400).send({ error: 'Empty message' });

    await store.appendTimeline(id, { kind: 'user', id: randomUUID(), text, ts: Date.now() });
    const result = await manager.startRun(id, text);
    if (!result.ok) return reply.code(result.code).send({ error: result.error });
    return reply.code(202).send({ ok: true });
  });

  app.post('/api/sessions/:id/interrupt', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await store.getSession(id))) return reply.code(404).send({ error: 'Not found' });
    const interrupted = manager.interrupt(id);
    return { ok: true, interrupted };
  });

  app.post('/api/sessions/:id/clear', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await store.getSession(id))) return reply.code(404).send({ error: 'Not found' });
    if (manager.isRunning(id)) return reply.code(409).send({ error: 'Cannot clear mid-run' });
    processRegistry.killAllForSession(id);
    await store.clearConversation(id);
    await store.updateSession(id, { status: 'idle', diffStat: null });
    bus.sessionChanged((await store.getSession(id))!);
    return { ok: true };
  });

  // --- read-only command helpers (no agent run, no token cost) ---

  app.get('/api/sessions/:id/diff', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await store.getSession(id))) return reply.code(404).send({ error: 'Not found' });
    return { diff: await fullDiff(id) };
  });

  app.get('/api/sessions/:id/tree', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await store.getSession(id))) return reply.code(404).send({ error: 'Not found' });
    return { files: await listFiles(id) };
  });

  app.get('/api/sessions/:id/processes', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await store.getSession(id))) return reply.code(404).send({ error: 'Not found' });
    const processes = processRegistry.listForSession(id).map((p) => ({
      id: p.id,
      name: p.name,
      running: !p.exited,
      exitCode: p.exitCode,
      startedAt: p.startedAt,
    }));
    return { processes };
  });

  app.post('/api/sessions/:id/processes/:pid/kill', async (req, reply) => {
    const { id, pid } = req.params as { id: string; pid: string };
    if (!(await store.getSession(id))) return reply.code(404).send({ error: 'Not found' });
    const proc = processRegistry.get(pid);
    if (!proc || proc.sessionId !== id) return reply.code(404).send({ error: 'Process not found' });
    const killed = processRegistry.kill(pid);
    return { ok: true, killed };
  });

  // listening TCP ports inside the container (for the canvas preview picker)
  app.get('/api/sessions/:id/ports', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await store.getSession(id))) return reply.code(404).send({ error: 'Not found' });
    return { ports: await listListeningPorts() };
  });
}

import { execBash } from '../lib/exec';
import { config } from '../config';

/** Best-effort list of locally-listening TCP ports, excluding the app's own. */
async function listListeningPorts(): Promise<number[]> {
  const res = await execBash(
    `ss -tlnH 2>/dev/null | grep -oE ':[0-9]+ ' || netstat -tlnH 2>/dev/null | grep -oE ':[0-9]+ '`,
    { cwd: '/tmp', timeoutMs: 8000 },
  );
  const own = new Set([config.port, 5432, 25060]);
  const ports = new Set<number>();
  for (const m of res.output.matchAll(/:(\d+)/g)) {
    const p = Number(m[1]);
    if (p > 0 && p < 65536 && !own.has(p)) ports.add(p);
  }
  return [...ports].sort((a, b) => a - b);
}
