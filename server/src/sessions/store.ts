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

export async function initStore() {
  await initDb();
}

function rowToMeta(row: any): SessionMeta {
  return {
    id: row.id,
    title: row.title,
    projectId: row.project_id ?? null,
    repoUrl: row.repo_url,
    repoName: row.repo_name,
    branch: row.branch,
    mode: row.mode as SessionMode,
    model: row.model as ModelId,
    status: row.status as SessionStatus,
    diffStat: row.diff_stat,
    totalTokens: Number(row.total_tokens),
    promptTokens: Number(row.prompt_tokens ?? 0),
    completionTokens: Number(row.completion_tokens ?? 0),
    costUsd: Number(row.cost_usd ?? 0),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export async function createSession(opts: {
  repoUrl: string | null;
  repoName: string | null;
  branch: string | null;
  mode: SessionMode;
  model: ModelId;
  projectId?: string | null;
}): Promise<SessionMeta> {
  const now = Date.now();
  const id = randomUUID();
  await q(
    `INSERT INTO sessions(id, title, project_id, repo_url, repo_name, branch, mode, model, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'idle', $9, $10)`,
    [id, 'New session', opts.projectId ?? null, opts.repoUrl, opts.repoName, opts.branch, opts.mode, opts.model, now, now],
  );
  return (await getSession(id))!;
}

export async function getSession(id: string): Promise<SessionMeta | null> {
  const row = await qOne('SELECT * FROM sessions WHERE id = $1', [id]);
  return row ? rowToMeta(row) : null;
}

export async function listSessions(): Promise<SessionMeta[]> {
  return (await q('SELECT * FROM sessions ORDER BY updated_at DESC')).map(rowToMeta);
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

// ---- custom commands (deployment-wide prompt templates) ----

export async function listCommands(): Promise<CustomCommand[]> {
  const rows = await q('SELECT * FROM custom_commands ORDER BY name ASC');
  return rows.map((r: any) => ({
    name: r.name,
    description: r.description,
    template: r.template,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  }));
}

export async function upsertCommand(
  name: string,
  description: string,
  template: string,
): Promise<CustomCommand> {
  const now = Date.now();
  await q(
    `INSERT INTO custom_commands(name, description, template, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT(name) DO UPDATE SET description = excluded.description,
       template = excluded.template, updated_at = excluded.updated_at`,
    [name, description, template, now, now],
  );
  return (await listCommands()).find((c) => c.name === name)!;
}

export async function deleteCommand(name: string) {
  await q('DELETE FROM custom_commands WHERE name = $1', [name]);
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
}): Promise<Project> {
  const id = randomUUID();
  const now = Date.now();
  await q(
    `INSERT INTO projects(id, name, instructions, default_repo_url, default_branch, default_mode, default_model, branding, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      id,
      opts.name,
      opts.instructions ?? '',
      opts.defaultRepoUrl ?? null,
      opts.defaultBranch ?? null,
      opts.defaultMode ?? null,
      opts.defaultModel ?? null,
      opts.branding ? JSON.stringify(opts.branding) : null,
      now,
      now,
    ],
  );
  return (await getProject(id))!;
}

export async function getProject(id: string): Promise<Project | null> {
  const row = await qOne('SELECT * FROM projects WHERE id = $1', [id]);
  if (!row) return null;
  const sc = await qOne<{ n: number }>('SELECT COUNT(*) AS n FROM sessions WHERE project_id = $1', [id]);
  const fc = await qOne<{ n: number }>('SELECT COUNT(*) AS n FROM project_files WHERE project_id = $1', [id]);
  return rowToProject(row, Number(sc?.n ?? 0), Number(fc?.n ?? 0));
}

export async function listProjects(): Promise<Project[]> {
  const rows = await q('SELECT * FROM projects ORDER BY updated_at DESC');
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
  };
}

export async function createDeployment(d: Omit<Deployment, 'createdAt' | 'updatedAt'>): Promise<Deployment> {
  const now = Date.now();
  await q(
    `INSERT INTO deployments(id, session_id, project_id, slug, name, kind, status, url, port, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [d.id, d.sessionId, d.projectId, d.slug, d.name, d.kind, d.status, d.url, d.port, now, now],
  );
  return { ...d, createdAt: now, updatedAt: now };
}

export async function getDeploymentBySlug(slug: string): Promise<Deployment | null> {
  const row = await qOne('SELECT * FROM deployments WHERE slug = $1', [slug]);
  return row ? rowToDeployment(row) : null;
}

export async function listDeployments(sessionId?: string): Promise<Deployment[]> {
  const rows = sessionId
    ? await q('SELECT * FROM deployments WHERE session_id = $1 ORDER BY updated_at DESC', [sessionId])
    : await q('SELECT * FROM deployments ORDER BY updated_at DESC');
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
