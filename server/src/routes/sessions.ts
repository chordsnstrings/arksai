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
import { deleteWorkspace, fullDiff, listFiles, parseRepoUrl, repoDir, setupWorkspace } from '../sessions/workspace';
import { bus } from '../events/bus';
import { processRegistry } from '../agent/processes';
import { detectStartCommand, verifyProject } from '../agent/verify';
import { probeApp } from '../agent/runtimeCheck';
import { scopeOf } from '../auth';

export function registerSessionRoutes(app: FastifyInstance) {
  // Org-scope every /api/sessions/:id access in one place: a caller may only touch
  // sessions in their current org (cross-org → 404). This now applies to the platform
  // operator too — it sees only its own workspace, not every org's chats.
  app.addHook('preHandler', async (req, reply) => {
    const m = req.url.split('?')[0].match(/^\/api\/sessions\/([^/]+)/);
    if (!m) return;
    const scope = scopeOf(req);
    if (!scope) return;
    if (!(await store.getSession(m[1], scope))) return reply.code(404).send({ error: 'Not found' });
  });

  app.get('/api/sessions', async (req) => store.listSessions(scopeOf(req)));

  app.post('/api/sessions', async (req, reply) => {
    const body = (req.body ?? {}) as CreateSessionRequest;
    // A session created inside a project inherits the project's defaults
    // (repo/branch/mode/model) unless the request overrides them.
    const project = body.projectId ? await store.getProject(body.projectId, scopeOf(req)) : null;
    let repoUrl: string | null = null;
    let repoName: string | null = null;
    const repoInput = body.repoUrl?.trim() || project?.defaultRepoUrl || '';
    if (repoInput) {
      const parsed = parseRepoUrl(repoInput);
      if (!parsed) {
        return reply.code(400).send({ error: 'Invalid repo. Use https://github.com/owner/repo or owner/repo.' });
      }
      repoUrl = parsed.url;
      repoName = parsed.name;
    }
    // Default to CHAT: the seamless entry point — the agent moves itself into build /
    // plan / report (or uses image-gen etc.) as the request needs. A project default or
    // an explicit mode still wins.
    const modeIn = body.mode ?? project?.defaultMode ?? undefined;
    const mode = SESSION_MODES.includes(modeIn as any) ? (modeIn as any) : 'chat';
    const modelIn = body.model ?? project?.defaultModel ?? undefined;
    const model = modelIn && (await isValidModel(modelIn)) ? modelIn : DEFAULT_MODEL;
    const session = await store.createSession({
      repoUrl,
      repoName,
      branch: body.branch?.trim() || project?.defaultBranch || null,
      mode,
      model,
      projectId: project?.id ?? null,
      task: typeof body.task === 'string' ? body.task.slice(0, 60) : null,
      orgId: req.identity?.orgId ?? null,
      createdBy: req.identity?.userId ?? null,
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
    const body = (req.body ?? {}) as PatchSessionRequest;
    const patch: PatchSessionRequest = {};
    // Renaming is always allowed; mode/model can't change mid-run.
    if (typeof body.title === 'string' && body.title.trim()) patch.title = body.title.trim().slice(0, 80);
    if (body.mode !== undefined || body.model !== undefined) {
      if (manager.isRunning(id)) return reply.code(409).send({ error: 'Cannot change mode/model mid-run' });
      if (SESSION_MODES.includes(body.mode as any)) patch.mode = body.mode;
      if (body.model && (await isValidModel(body.model))) patch.model = body.model;
    }
    await store.updateSession(id, patch);
    const updated = (await store.getSession(id))!;
    bus.sessionChanged(updated);
    return updated;
  });

  app.delete('/api/sessions/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const sess = await store.getSession(id);
    if (!sess) return reply.code(404).send({ error: 'Not found' });
    try {
      manager.interrupt(id);
    } catch {}
    // Delete from the DB FIRST — that's the source of truth. Workspace cleanup
    // is best-effort so a failed rm can't leave the row behind (it reappeared
    // on refresh before because cleanup threw before the DB delete).
    await store.deleteSession(id);
    try {
      deleteWorkspace(id);
    } catch {}
    bus.emitGlobal({ type: 'session_deleted', sessionId: id, orgId: sess.orgId });
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
    const meta = await store.getSession(id);
    if (!meta) return reply.code(404).send({ error: 'Not found' });
    const interrupted = manager.interrupt(id);
    // Always unstick the UI: if there's no live run (e.g. the server restarted
    // and orphaned it) but the session still shows "running", force it idle and
    // tell the client the run is over.
    if (!interrupted && meta.status === 'running') {
      await store.updateSession(id, { status: 'idle' });
      const updated = (await store.getSession(id))!;
      bus.emit(id, {
        type: 'run_finished',
        runId: 'interrupted',
        status: 'idle',
        totalTokens: 0,
        diffStat: updated.diffStat,
      });
      bus.sessionChanged(updated);
    }
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

  app.get('/api/sessions/:id/verify', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await store.getSession(id))) return reply.code(404).send({ error: 'Not found' });
    const ctrl = new AbortController();
    const report = await verifyProject(repoDir(id), ctrl.signal);
    const detail = report.checks.map((c) => `${c.ok ? '✓' : '✗'} ${c.name}\n${c.output}`).join('\n\n');
    let out = `${report.summary}${detail ? '\n\n' + detail : ''}`;
    // For apps, also boot + seed + exercise the endpoints.
    const startCmd = detectStartCommand(repoDir(id));
    if (startCmd && (!report.ran || report.ok)) {
      processRegistry.killAllForSession(id);
      const probe = await probeApp(id, repoDir(id), startCmd, ctrl.signal);
      out += `\n\n--- Runtime ---\n${probe.detail}`;
    }
    return { report: out };
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

import fs from 'node:fs';
import { config } from '../config';
import { listeningPorts } from '../lib/ports';

/** Listening ports inside the container, excluding the app's own. */
async function listListeningPorts(): Promise<number[]> {
  return listeningPorts([config.port, 5432, 25060]);
}
