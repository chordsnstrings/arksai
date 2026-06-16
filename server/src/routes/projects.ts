import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance } from 'fastify';
import type { CreateProjectRequest, PatchProjectRequest, SessionMode } from '../../../shared/types';
import { SESSION_MODES } from '../../../shared/types';
import * as store from '../sessions/store';
import { isValidModel } from '../agent/models';
import { parseRepoUrl, projectKnowledgeDir } from '../sessions/workspace';
import { config } from '../config';
import { scopeOf } from '../auth';
import { getUserByEmail, roleInOrg } from '../orgs/store';

function sanitizeFilename(name: string): string {
  const base = path.basename(name || 'file').replace(/[^\w.\- ()]/g, '_');
  return (base || 'file').slice(0, 100);
}

function projectDir(id: string): string {
  return path.join(config.dataDir, 'projects', id);
}

export function registerProjectRoutes(app: FastifyInstance) {
  // Org-scope every /api/projects/:id access (cross-org → 404). Super-admin bypasses.
  app.addHook('preHandler', async (req, reply) => {
    const m = req.url.split('?')[0].match(/^\/api\/projects\/([^/]+)/);
    if (!m) return;
    const scope = scopeOf(req);
    if (!scope || scope.isSuperadmin) return;
    if (!(await store.getProject(m[1], scope))) return reply.code(404).send({ error: 'Not found' });
  });

  app.get('/api/projects', async (req) => ({ projects: await store.listProjects(scopeOf(req)) }));

  app.post('/api/projects', async (req, reply) => {
    const body = (req.body ?? {}) as CreateProjectRequest;
    const name = String(body.name ?? '').trim();
    if (!name) return reply.code(400).send({ error: 'A project name is required.' });

    let repoUrl: string | null = null;
    if (body.defaultRepoUrl?.trim()) {
      const parsed = parseRepoUrl(body.defaultRepoUrl);
      if (!parsed) return reply.code(400).send({ error: 'Invalid default repo.' });
      repoUrl = parsed.url;
    }
    const mode = SESSION_MODES.includes(body.defaultMode as SessionMode) ? body.defaultMode! : null;
    const model = body.defaultModel && (await isValidModel(body.defaultModel)) ? body.defaultModel : null;
    const project = await store.createProject({
      name: name.slice(0, 80),
      instructions: String(body.instructions ?? ''),
      defaultRepoUrl: repoUrl,
      defaultBranch: body.defaultBranch?.trim() || null,
      defaultMode: mode,
      defaultModel: model,
      branding: body.branding ?? null,
      orgId: req.identity?.orgId ?? null,
      ownerUserId: req.identity?.userId ?? null,
    });
    return reply.code(201).send(project);
  });

  // ---- project visibility + sharing ("creator + invited") ----
  // Only the project owner, an org admin, or the super-admin can change sharing.
  // (The :id guard hook above already 404s anyone who can't even see the project.)
  const canManageProject = async (req: any, id: string): Promise<boolean> => {
    const idn = req.identity;
    if (!idn) return false;
    if (idn.isSuperadmin) return true;
    const owner = await store.getProjectOwner(id);
    if (!owner) return false;
    if (owner.ownerUserId === idn.userId) return true;
    return idn.role === 'admin' && owner.orgId === idn.orgId;
  };

  app.patch('/api/projects/:id/visibility', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canManageProject(req, id))) return reply.code(403).send({ error: 'Only the project owner or an admin can change visibility.' });
    const vis = (req.body as any)?.visibility === 'private' ? 'private' : 'org';
    await store.setProjectVisibility(id, vis);
    return { ok: true, visibility: vis };
  });

  app.get('/api/projects/:id/members', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canManageProject(req, id))) return reply.code(403).send({ error: 'Not allowed.' });
    return { userIds: await store.listProjectMemberIds(id) };
  });

  app.post('/api/projects/:id/members', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await canManageProject(req, id))) return reply.code(403).send({ error: 'Not allowed.' });
    const email = String((req.body as any)?.email ?? '').trim();
    const user = await getUserByEmail(email);
    if (!user) return reply.code(404).send({ error: 'No user with that email yet — they must accept an org invite first.' });
    const owner = await store.getProjectOwner(id);
    if (owner?.orgId && !(await roleInOrg(user.id, owner.orgId))) {
      return reply.code(400).send({ error: 'That person is not a member of this organization.' });
    }
    await store.addProjectMember(id, user.id);
    return { ok: true };
  });

  app.delete('/api/projects/:id/members/:userId', async (req, reply) => {
    const { id, userId } = req.params as { id: string; userId: string };
    if (!(await canManageProject(req, id))) return reply.code(403).send({ error: 'Not allowed.' });
    await store.removeProjectMember(id, userId);
    return { ok: true };
  });

  app.get('/api/projects/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const project = await store.getProject(id);
    if (!project) return reply.code(404).send({ error: 'Not found' });
    return project;
  });

  app.patch('/api/projects/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await store.getProject(id))) return reply.code(404).send({ error: 'Not found' });
    const body = (req.body ?? {}) as PatchProjectRequest;
    const patch: Record<string, unknown> = {};
    if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim().slice(0, 80);
    if (typeof body.instructions === 'string') patch.instructions = body.instructions;
    if ('defaultRepoUrl' in body) {
      if (!body.defaultRepoUrl) patch.defaultRepoUrl = null;
      else {
        const parsed = parseRepoUrl(body.defaultRepoUrl);
        if (!parsed) return reply.code(400).send({ error: 'Invalid default repo.' });
        patch.defaultRepoUrl = parsed.url;
      }
    }
    if ('defaultBranch' in body) patch.defaultBranch = body.defaultBranch || null;
    if (SESSION_MODES.includes(body.defaultMode as SessionMode)) patch.defaultMode = body.defaultMode;
    if (body.defaultModel && (await isValidModel(body.defaultModel))) patch.defaultModel = body.defaultModel;
    if ('branding' in body) patch.branding = body.branding ?? null;
    await store.updateProject(id, patch as any);
    return (await store.getProject(id))!;
  });

  app.delete('/api/projects/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await store.getProject(id))) return reply.code(404).send({ error: 'Not found' });
    await store.deleteProject(id);
    try {
      fs.rmSync(projectDir(id), { recursive: true, force: true });
    } catch {}
    return { ok: true };
  });

  // ---- knowledge files ----

  app.get('/api/projects/:id/files', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await store.getProject(id))) return reply.code(404).send({ error: 'Not found' });
    return { files: await store.listProjectFiles(id) };
  });

  app.post('/api/projects/:id/files', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await store.getProject(id))) return reply.code(404).send({ error: 'Not found' });
    const kdir = projectKnowledgeDir(id);
    fs.mkdirSync(kdir, { recursive: true });

    const saved: { name: string; size: number }[] = [];
    for await (const part of req.files()) {
      const safe = sanitizeFilename(part.filename);
      let dest = path.join(kdir, safe);
      if (fs.existsSync(dest)) dest = path.join(kdir, `${Date.now()}-${safe}`);
      await pipeline(part.file, fs.createWriteStream(dest));
      if (part.file.truncated) {
        fs.rmSync(dest, { force: true });
        return reply.code(413).send({ error: `${safe} exceeds the 25 MB upload limit` });
      }
      const name = path.basename(dest);
      await store.addProjectFile(id, name, fs.statSync(dest).size);
      saved.push({ name, size: fs.statSync(dest).size });
    }
    if (saved.length === 0) return reply.code(400).send({ error: 'No files received' });
    return { ok: true, files: await store.listProjectFiles(id) };
  });

  app.delete('/api/projects/:id/files/:fileId', async (req, reply) => {
    const { id, fileId } = req.params as { id: string; fileId: string };
    const file = await store.getProjectFile(fileId);
    if (!file || file.projectId !== id) return reply.code(404).send({ error: 'Not found' });
    await store.deleteProjectFile(fileId);
    try {
      fs.rmSync(path.join(projectKnowledgeDir(id), file.name), { force: true });
    } catch {}
    return { ok: true };
  });
}
