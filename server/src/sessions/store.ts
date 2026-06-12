import { randomUUID } from 'node:crypto';
import type {
  CustomCommand,
  MemoryEntry,
  ModelId,
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
}): Promise<SessionMeta> {
  const now = Date.now();
  const id = randomUUID();
  await q(
    `INSERT INTO sessions(id, title, repo_url, repo_name, branch, mode, model, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'idle', $8, $9)`,
    [id, 'New session', opts.repoUrl, opts.repoName, opts.branch, opts.mode, opts.model, now, now],
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
