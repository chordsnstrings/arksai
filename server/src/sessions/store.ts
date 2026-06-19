import { randomUUID } from 'node:crypto';
import type {
  CustomCommand,
  Deployment,
  DeploymentKind,
  DeploymentStatus,
  MemoryEntry,
  ModelId,
  Project,
  ProjectBranding,
  ProjectFile,
  SessionMeta,
  SessionMode,
  SessionStatus,
  TimelineItem,
} from '../../../shared/types';
import { initDb, q, qOne } from '../db';
import { bootstrapOrgs } from '../orgs/store';

export async function initStore() {
  await initDb();
  await bootstrapOrgs();
}

// Exactly the columns rowToMeta needs — deliberately EXCLUDING the `context` blob
// (the full agent transcript, often large). listSessions returns every session in the
// org on each app open / sidebar refresh; SELECT * pulled + parsed + discarded that
// blob N times. Projecting the metadata columns keeps the hot path lean.
const META_COLS =
  'id, title, org_id, project_id, repo_url, repo_name, branch, mode, model, status, task, ' +
  'awaiting_plan, diff_stat, total_tokens, prompt_tokens, completion_tokens, cost_usd, created_at, updated_at';

function rowToMeta(row: any): SessionMeta {
  return {
    id: row.id,
    title: row.title,
    orgId: row.org_id ?? null,
    projectId: row.project_id ?? null,
    repoUrl: row.repo_url,
    repoName: row.repo_name,
    branch: row.branch,
    mode: row.mode as SessionMode,
    model: row.model as ModelId,
    status: row.status as SessionStatus,
    task: row.task ?? null,
    awaitingPlan: !!row.awaiting_plan,
    diffStat: row.diff_stat,
    totalTokens: Number(row.total_tokens),
    promptTokens: Number(row.prompt_tokens ?? 0),
    completionTokens: Number(row.completion_tokens ?? 0),
    costUsd: Number(row.cost_usd ?? 0),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

/**
 * Org scope for a request. `undefined` (internal callers: the runner, the scheduler
 * tick, the public /apps serving path) means "no org filter". An identity bound to an
 * org is ALWAYS filtered to that org — INCLUDING the platform operator, which sees only
 * its OWN workspace, never a commingled cross-org list. Cross-org admin actions are
 * gated on `isSuperadmin` at their own endpoints, never via passive data reads.
 */
export type Scope = { orgId: string | null; userId: string; isSuperadmin: boolean } | undefined;
const scoped = (scope: Scope) => !!scope && scope.orgId != null;

export async function createSession(opts: {
  repoUrl: string | null;
  repoName: string | null;
  branch: string | null;
  mode: SessionMode;
  model: ModelId;
  projectId?: string | null;
  task?: string | null;
  orgId?: string | null;
  createdBy?: string | null;
}): Promise<SessionMeta> {
  const now = Date.now();
  const id = randomUUID();
  await q(
    `INSERT INTO sessions(id, title, project_id, org_id, created_by, repo_url, repo_name, branch, mode, model, status, task, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'idle', $11, $12, $13)`,
    [id, 'New session', opts.projectId ?? null, opts.orgId ?? null, opts.createdBy ?? null, opts.repoUrl, opts.repoName, opts.branch, opts.mode, opts.model, opts.task ?? null, now, now],
  );
  return (await getSession(id))!;
}

export async function getSession(id: string, scope?: Scope): Promise<SessionMeta | null> {
  const row = await qOne(`SELECT ${META_COLS} FROM sessions WHERE id = $1`, [id]);
  if (!row) return null;
  if (scoped(scope) && row.org_id !== scope!.orgId) return null; // cross-org → not found
  return rowToMeta(row);
}

export async function listSessions(scope?: Scope): Promise<SessionMeta[]> {
  if (scoped(scope)) {
    return (await q(`SELECT ${META_COLS} FROM sessions WHERE org_id = $1 ORDER BY updated_at DESC`, [scope!.orgId])).map(rowToMeta);
  }
  return (await q(`SELECT ${META_COLS} FROM sessions ORDER BY updated_at DESC`)).map(rowToMeta);
}

const COLUMN: Record<string, string> = {
  title: 'title',
  branch: 'branch',
  mode: 'mode',
  model: 'model',
  status: 'status',
  diffStat: 'diff_stat',
  totalTokens: 'total_tokens',
  promptTokens: 'prompt_tokens',
  completionTokens: 'completion_tokens',
  costUsd: 'cost_usd',
  repoUrl: 'repo_url',
  repoName: 'repo_name',
  projectId: 'project_id',
  task: 'task',
};

export async function updateSession(id: string, patch: Partial<SessionMeta>) {
  const sets: string[] = [];
  const vals: unknown[] = [];
  let i = 1;
  sets.push(`updated_at = $${i++}`);
  vals.push(Date.now());
  for (const [key, col] of Object.entries(COLUMN)) {
    if (key in patch) {
      sets.push(`${col} = $${i++}`);
      vals.push((patch as any)[key]);
    }
  }
  vals.push(id);
  await q(`UPDATE sessions SET ${sets.join(', ')} WHERE id = $${i}`, vals);
}

/** The plan-mode approval flag is a 0/1 column (booleans don't bind on SQLite). */
export async function setAwaitingPlan(id: string, awaiting: boolean) {
  await q('UPDATE sessions SET awaiting_plan = $1, updated_at = $2 WHERE id = $3', [
    awaiting ? 1 : 0,
    Date.now(),
    id,
  ]);
}

export async function deleteSession(id: string) {
  await q('DELETE FROM timeline WHERE session_id = $1', [id]);
  await q('DELETE FROM sessions WHERE id = $1', [id]);
}

// ---- model context (OpenAI-format transcript, system prompt excluded) ----

export async function getContext(id: string): Promise<any[]> {
  const row = await qOne<{ context: string }>('SELECT context FROM sessions WHERE id = $1', [id]);
  if (!row) return [];
  try {
    return JSON.parse(row.context);
  } catch {
    return [];
  }
}

export async function setContext(id: string, context: any[]) {
  await q('UPDATE sessions SET context = $1, updated_at = $2 WHERE id = $3', [
    JSON.stringify(context),
    Date.now(),
    id,
  ]);
}

export async function clearConversation(id: string) {
  await q('DELETE FROM timeline WHERE session_id = $1', [id]);
  await q("UPDATE sessions SET context = '[]', updated_at = $1 WHERE id = $2", [Date.now(), id]);
}

// ---- timeline (what the chat UI renders) ----

export async function appendTimeline(sessionId: string, item: TimelineItem) {
  const row = await qOne<{ next: number }>(
    'SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM timeline WHERE session_id = $1',
    [sessionId],
  );
  const seq = Number(row?.next ?? 1);
  await q('INSERT INTO timeline(id, session_id, seq, payload, created_at) VALUES ($1, $2, $3, $4, $5)', [
    item.id,
    sessionId,
    seq,
    JSON.stringify(item),
    Date.now(),
  ]);
}

export async function getTimeline(sessionId: string): Promise<TimelineItem[]> {
  const rows = await q<{ payload: string }>(
    'SELECT payload FROM timeline WHERE session_id = $1 ORDER BY seq ASC',
    [sessionId],
  );
  return rows.map((r) => JSON.parse(r.payload));
}

// ---- custom commands (ORG-SCOPED prompt templates: keyed by (org_id, name)) ----

const rowToCommand = (r: any): CustomCommand => ({
  name: r.name,
  description: r.description,
  template: r.template,
  createdAt: Number(r.created_at),
  updatedAt: Number(r.updated_at),
});

export async function listCommands(orgId: string | null): Promise<CustomCommand[]> {
  const rows = await q('SELECT * FROM custom_commands WHERE org_id = $1 ORDER BY name ASC', [orgId]);
  return rows.map(rowToCommand);
}

export async function upsertCommand(
  orgId: string | null,
  name: string,
  description: string,
  template: string,
): Promise<CustomCommand> {
  const now = Date.now();
  await q(
    `INSERT INTO custom_commands(id, org_id, name, description, template, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT(org_id, name) DO UPDATE SET description = excluded.description,
       template = excluded.template, updated_at = excluded.updated_at`,
    [randomUUID(), orgId, name, description, template, now, now],
  );
  const r = await qOne('SELECT * FROM custom_commands WHERE org_id = $1 AND name = $2', [orgId, name]);
  return rowToCommand(r);
}

export async function deleteCommand(orgId: string | null, name: string) {
  await q('DELETE FROM custom_commands WHERE org_id = $1 AND name = $2', [orgId, name]);
}

// ---- memory (global + per-repo, injected into every session's prompt) ----

function rowToMemory(r: any): MemoryEntry {
  return { id: r.id, scope: r.scope, text: r.text, createdAt: Number(r.created_at) };
}

export async function listMemory(scopes: string[]): Promise<MemoryEntry[]> {
  if (scopes.length === 0) return [];
  const ph = scopes.map((_, i) => `$${i + 1}`).join(',');
  const rows = await q(`SELECT * FROM memory WHERE scope IN (${ph}) ORDER BY created_at ASC`, scopes);
  return rows.map(rowToMemory);
}

export async function addMemory(scope: string, text: string): Promise<MemoryEntry> {
  const id = randomUUID();
  const now = Date.now();
  await q('INSERT INTO memory(id, scope, text, created_at) VALUES ($1, $2, $3, $4)', [id, scope, text, now]);
  return { id, scope, text, createdAt: now };
}

export async function deleteMemory(id: string) {
  await q('DELETE FROM memory WHERE id = $1', [id]);
}

// ---- projects (persistent workspaces grouping sessions) ----

function parseBranding(s: any): ProjectBranding | null {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function rowToProject(r: any, sessionCount = 0, fileCount = 0): Project {
  return {
    id: r.id,
    name: r.name,
    instructions: r.instructions ?? '',
    defaultRepoUrl: r.default_repo_url ?? null,
    defaultBranch: r.default_branch ?? null,
    defaultMode: (r.default_mode as SessionMode) ?? null,
    defaultModel: (r.default_model as ModelId) ?? null,
    branding: parseBranding(r.branding),
    visibility: (r.visibility as 'org' | 'private') ?? 'org',
    sessionCount,
    fileCount,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

export async function createProject(opts: {
  name: string;
  instructions?: string;
  defaultRepoUrl?: string | null;
  defaultBranch?: string | null;
  defaultMode?: SessionMode | null;
  defaultModel?: ModelId | null;
  branding?: ProjectBranding | null;
  orgId?: string | null;
  ownerUserId?: string | null;
}): Promise<Project> {
  const id = randomUUID();
  const now = Date.now();
  await q(
    `INSERT INTO projects(id, name, instructions, default_repo_url, default_branch, default_mode, default_model, branding, org_id, owner_user_id, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      id,
      opts.name,
      opts.instructions ?? '',
      opts.defaultRepoUrl ?? null,
      opts.defaultBranch ?? null,
      opts.defaultMode ?? null,
      opts.defaultModel ?? null,
      opts.branding ? JSON.stringify(opts.branding) : null,
      opts.orgId ?? null,
      opts.ownerUserId ?? null,
      now,
      now,
    ],
  );
  return (await getProject(id))!;
}

export async function getProject(id: string, scope?: Scope): Promise<Project | null> {
  const row = await qOne('SELECT * FROM projects WHERE id = $1', [id]);
  if (!row) return null;
  if (scoped(scope)) {
    if (row.org_id !== scope!.orgId) return null; // cross-org → not found (operator included)
    const vis = row.visibility ?? 'org';
    // Per-user private-project visibility applies to members; the operator stays an
    // admin WITHIN its own workspace (it just can't cross orgs, enforced above).
    if (!scope!.isSuperadmin && vis !== 'org' && row.owner_user_id !== scope!.userId) {
      const m = await qOne('SELECT 1 AS x FROM project_members WHERE project_id = $1 AND user_id = $2', [id, scope!.userId]);
      if (!m) return null; // private project, not the owner and not invited
    }
  }
  const sc = await qOne<{ n: number }>('SELECT COUNT(*) AS n FROM sessions WHERE project_id = $1', [id]);
  const fc = await qOne<{ n: number }>('SELECT COUNT(*) AS n FROM project_files WHERE project_id = $1', [id]);
  return rowToProject(row, Number(sc?.n ?? 0), Number(fc?.n ?? 0));
}

export async function listProjects(scope?: Scope): Promise<Project[]> {
  const rows = !scoped(scope)
    ? await q('SELECT * FROM projects ORDER BY updated_at DESC')
    : scope!.isSuperadmin
      ? // operator: every project in ITS OWN org (admin within the workspace, no cross-org)
        await q('SELECT * FROM projects WHERE org_id = $1 ORDER BY updated_at DESC', [scope!.orgId])
      : await q(
          `SELECT * FROM projects WHERE org_id = $1
             AND (visibility = 'org' OR visibility IS NULL OR owner_user_id = $2
                  OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = projects.id AND pm.user_id = $3))
           ORDER BY updated_at DESC`,
          [scope!.orgId, scope!.userId, scope!.userId],
        );
  const out: Project[] = [];
  for (const r of rows) {
    const sc = await qOne<{ n: number }>('SELECT COUNT(*) AS n FROM sessions WHERE project_id = $1', [r.id]);
    const fc = await qOne<{ n: number }>('SELECT COUNT(*) AS n FROM project_files WHERE project_id = $1', [r.id]);
    out.push(rowToProject(r, Number(sc?.n ?? 0), Number(fc?.n ?? 0)));
  }
  return out;
}

const PROJECT_COLUMN: Record<string, string> = {
  name: 'name',
  instructions: 'instructions',
  defaultRepoUrl: 'default_repo_url',
  defaultBranch: 'default_branch',
  defaultMode: 'default_mode',
  defaultModel: 'default_model',
  visibility: 'visibility',
};

export async function updateProject(
  id: string,
  patch: Partial<{
    name: string;
    instructions: string;
    defaultRepoUrl: string | null;
    defaultBranch: string | null;
    defaultMode: SessionMode;
    defaultModel: ModelId;
    branding: ProjectBranding | null;
  }>,
) {
  const sets: string[] = ['updated_at = $1'];
  const vals: unknown[] = [Date.now()];
  let i = 2;
  for (const [key, col] of Object.entries(PROJECT_COLUMN)) {
    if (key in patch) {
      sets.push(`${col} = $${i++}`);
      vals.push((patch as any)[key]);
    }
  }
  if ('branding' in patch) {
    sets.push(`branding = $${i++}`);
    vals.push(patch.branding ? JSON.stringify(patch.branding) : null);
  }
  vals.push(id);
  await q(`UPDATE projects SET ${sets.join(', ')} WHERE id = $${i}`, vals);
}

export async function deleteProject(id: string) {
  // Detach sessions (keep them) and drop file rows; disk cleanup is the route's job.
  await q('UPDATE sessions SET project_id = NULL WHERE project_id = $1', [id]);
  await q('DELETE FROM project_files WHERE project_id = $1', [id]);
  await q('DELETE FROM projects WHERE id = $1', [id]);
}

function rowToProjectFile(r: any): ProjectFile {
  return { id: r.id, projectId: r.project_id, name: r.name, size: Number(r.size), createdAt: Number(r.created_at) };
}

export async function addProjectFile(projectId: string, name: string, size: number): Promise<ProjectFile> {
  const id = randomUUID();
  const now = Date.now();
  await q('INSERT INTO project_files(id, project_id, name, size, created_at) VALUES ($1,$2,$3,$4,$5)', [
    id,
    projectId,
    name,
    size,
    now,
  ]);
  await q('UPDATE projects SET updated_at = $1 WHERE id = $2', [now, projectId]);
  return { id, projectId, name, size, createdAt: now };
}

export async function listProjectFiles(projectId: string): Promise<ProjectFile[]> {
  const rows = await q('SELECT * FROM project_files WHERE project_id = $1 ORDER BY created_at ASC', [projectId]);
  return rows.map(rowToProjectFile);
}

export async function getProjectFile(id: string): Promise<ProjectFile | null> {
  const row = await qOne('SELECT * FROM project_files WHERE id = $1', [id]);
  return row ? rowToProjectFile(row) : null;
}

export async function deleteProjectFile(id: string) {
  await q('DELETE FROM project_files WHERE id = $1', [id]);
}

// ---- project visibility / sharing ("creator + invited") ----
export async function setProjectVisibility(projectId: string, visibility: 'org' | 'private'): Promise<void> {
  await q('UPDATE projects SET visibility = $1, updated_at = $2 WHERE id = $3', [visibility, Date.now(), projectId]);
}
export async function getProjectOwner(
  projectId: string,
): Promise<{ ownerUserId: string | null; orgId: string | null; visibility: string } | null> {
  const r = await qOne<any>('SELECT owner_user_id, org_id, visibility FROM projects WHERE id = $1', [projectId]);
  return r ? { ownerUserId: r.owner_user_id ?? null, orgId: r.org_id ?? null, visibility: r.visibility ?? 'org' } : null;
}
export async function addProjectMember(projectId: string, userId: string): Promise<void> {
  await q(
    'INSERT INTO project_members(project_id, user_id, created_at) VALUES ($1,$2,$3) ON CONFLICT(project_id, user_id) DO NOTHING',
    [projectId, userId, Date.now()],
  );
}
export async function removeProjectMember(projectId: string, userId: string): Promise<void> {
  await q('DELETE FROM project_members WHERE project_id = $1 AND user_id = $2', [projectId, userId]);
}
export async function listProjectMemberIds(projectId: string): Promise<string[]> {
  return (await q<{ user_id: string }>('SELECT user_id FROM project_members WHERE project_id = $1', [projectId])).map(
    (r) => r.user_id,
  );
}
export async function listProjectMembers(projectId: string): Promise<{ userId: string; email: string }[]> {
  const rows = await q<any>(
    'SELECT pm.user_id AS user_id, u.email AS email FROM project_members pm JOIN users u ON u.id = pm.user_id WHERE pm.project_id = $1 ORDER BY pm.created_at ASC',
    [projectId],
  );
  return rows.map((r) => ({ userId: r.user_id, email: r.email }));
}

// ---- deployments (published apps on a durable URL) ----

function rowToDeployment(r: any): Deployment {
  return {
    id: r.id,
    sessionId: r.session_id,
    projectId: r.project_id ?? null,
    slug: r.slug,
    name: r.name,
    kind: r.kind as DeploymentKind,
    status: r.status as DeploymentStatus,
    url: r.url,
    port: r.port != null ? Number(r.port) : null,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
    expiresAt: r.expires_at != null ? Number(r.expires_at) : null,
  };
}

export async function createDeployment(
  d: Omit<Deployment, 'createdAt' | 'updatedAt'> & { orgId?: string | null },
): Promise<Deployment> {
  const now = Date.now();
  // Stamp the owning org (from the publishing session) so org-scoped reads/ops work —
  // without this a tenant couldn't see or manage even its OWN published apps. expires_at
  // drives the 24h-preview auto-cleanup (null = no expiry).
  await q(
    `INSERT INTO deployments(id, session_id, project_id, slug, name, kind, status, url, port, org_id, expires_at, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [d.id, d.sessionId, d.projectId, d.slug, d.name, d.kind, d.status, d.url, d.port, d.orgId ?? null, d.expiresAt ?? null, now, now],
  );
  return { ...d, expiresAt: d.expiresAt ?? null, createdAt: now, updatedAt: now };
}

export async function getDeploymentBySlug(slug: string, scope?: Scope): Promise<Deployment | null> {
  const row = await qOne('SELECT * FROM deployments WHERE slug = $1', [slug]);
  if (!row) return null;
  if (scoped(scope) && row.org_id !== scope!.orgId) return null; // cross-org → not found
  return rowToDeployment(row);
}

export async function listDeployments(sessionId?: string, scope?: Scope): Promise<Deployment[]> {
  let rows: any[];
  if (sessionId && scoped(scope))
    rows = await q('SELECT * FROM deployments WHERE session_id = $1 AND org_id = $2 ORDER BY updated_at DESC', [sessionId, scope!.orgId]);
  else if (sessionId) rows = await q('SELECT * FROM deployments WHERE session_id = $1 ORDER BY updated_at DESC', [sessionId]);
  else if (scoped(scope)) rows = await q('SELECT * FROM deployments WHERE org_id = $1 ORDER BY updated_at DESC', [scope!.orgId]);
  else rows = await q('SELECT * FROM deployments ORDER BY updated_at DESC');
  return rows.map(rowToDeployment);
}

export async function updateDeployment(
  slug: string,
  patch: Partial<Pick<Deployment, 'status' | 'port' | 'name' | 'kind' | 'url'>>,
) {
  const map: Record<string, string> = { status: 'status', port: 'port', name: 'name', kind: 'kind', url: 'url' };
  const sets = ['updated_at = $1'];
  const vals: unknown[] = [Date.now()];
  let i = 2;
  for (const [k, col] of Object.entries(map)) {
    if (k in patch) {
      sets.push(`${col} = $${i++}`);
      vals.push((patch as any)[k]);
    }
  }
  vals.push(slug);
  await q(`UPDATE deployments SET ${sets.join(', ')} WHERE slug = $${i}`, vals);
}

export async function deleteDeployment(slug: string) {
  await q('DELETE FROM deployments WHERE slug = $1', [slug]);
}

/** On boot: any session left "running" by a crash/restart becomes an error. */
export async function recoverInterruptedSessions(): Promise<string[]> {
  const rows = await q<{ id: string }>("SELECT id FROM sessions WHERE status = 'running'");
  for (const row of rows) {
    await updateSession(row.id, { status: 'error' });
    await appendTimeline(row.id, {
      kind: 'system',
      id: randomUUID(),
      level: 'error',
      text: 'Run interrupted by server restart. Send a new message to continue.',
      ts: Date.now(),
    });
  }
  return rows.map((r) => r.id);
}
