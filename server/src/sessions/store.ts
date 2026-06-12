import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  ModelId,
  SessionMeta,
  SessionMode,
  SessionStatus,
  TimelineItem,
} from '../../../shared/types';
import { config } from '../config';

let db: Database.Database;

export function initStore() {
  fs.mkdirSync(config.dataDir, { recursive: true });
  db = new Database(path.join(config.dataDir, 'arksai.db'));
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions(
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      repo_url TEXT,
      repo_name TEXT,
      branch TEXT,
      mode TEXT NOT NULL,
      model TEXT NOT NULL,
      status TEXT NOT NULL,
      diff_stat TEXT,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      prompt_tokens INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      context TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS timeline(
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_timeline_session ON timeline(session_id, seq);
  `);

  // Migrate older DBs that predate the cost columns.
  for (const col of [
    'prompt_tokens INTEGER NOT NULL DEFAULT 0',
    'completion_tokens INTEGER NOT NULL DEFAULT 0',
    'cost_usd REAL NOT NULL DEFAULT 0',
  ]) {
    try {
      db.exec(`ALTER TABLE sessions ADD COLUMN ${col}`);
    } catch {
      /* column already exists */
    }
  }
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
    totalTokens: row.total_tokens,
    promptTokens: row.prompt_tokens ?? 0,
    completionTokens: row.completion_tokens ?? 0,
    costUsd: row.cost_usd ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createSession(opts: {
  repoUrl: string | null;
  repoName: string | null;
  branch: string | null;
  mode: SessionMode;
  model: ModelId;
}): SessionMeta {
  const now = Date.now();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO sessions(id, title, repo_url, repo_name, branch, mode, model, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'idle', ?, ?)`,
  ).run(id, 'New session', opts.repoUrl, opts.repoName, opts.branch, opts.mode, opts.model, now, now);
  return getSession(id)!;
}

export function getSession(id: string): SessionMeta | null {
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
  return row ? rowToMeta(row) : null;
}

export function listSessions(): SessionMeta[] {
  return db
    .prepare('SELECT * FROM sessions ORDER BY updated_at DESC')
    .all()
    .map(rowToMeta);
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

export function updateSession(id: string, patch: Partial<SessionMeta>) {
  const sets: string[] = ['updated_at = ?'];
  const vals: unknown[] = [Date.now()];
  for (const [key, col] of Object.entries(COLUMN)) {
    if (key in patch) {
      sets.push(`${col} = ?`);
      vals.push((patch as any)[key]);
    }
  }
  vals.push(id);
  db.prepare(`UPDATE sessions SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

export function deleteSession(id: string) {
  db.prepare('DELETE FROM timeline WHERE session_id = ?').run(id);
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
}

// ---- model context (OpenAI-format transcript, system prompt excluded) ----

export function getContext(id: string): any[] {
  const row = db.prepare('SELECT context FROM sessions WHERE id = ?').get(id) as any;
  if (!row) return [];
  try {
    return JSON.parse(row.context);
  } catch {
    return [];
  }
}

export function setContext(id: string, context: any[]) {
  db.prepare('UPDATE sessions SET context = ?, updated_at = ? WHERE id = ?').run(
    JSON.stringify(context),
    Date.now(),
    id,
  );
}

export function clearConversation(id: string) {
  db.prepare('DELETE FROM timeline WHERE session_id = ?').run(id);
  db.prepare("UPDATE sessions SET context = '[]', updated_at = ? WHERE id = ?").run(Date.now(), id);
}

// ---- timeline (what the chat UI renders) ----

export function appendTimeline(sessionId: string, item: TimelineItem) {
  const seqRow = db
    .prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM timeline WHERE session_id = ?')
    .get(sessionId) as any;
  db.prepare(
    'INSERT INTO timeline(id, session_id, seq, payload, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(item.id, sessionId, seqRow.next, JSON.stringify(item), Date.now());
}

export function getTimeline(sessionId: string): TimelineItem[] {
  return db
    .prepare('SELECT payload FROM timeline WHERE session_id = ? ORDER BY seq ASC')
    .all(sessionId)
    .map((r: any) => JSON.parse(r.payload));
}

/** On boot: any session left "running" by a crash/restart becomes an error. */
export function recoverInterruptedSessions(): string[] {
  const rows = db.prepare("SELECT id FROM sessions WHERE status = 'running'").all() as any[];
  for (const row of rows) {
    updateSession(row.id, { status: 'error' });
    appendTimeline(row.id, {
      kind: 'system',
      id: randomUUID(),
      level: 'error',
      text: 'Run interrupted by server restart. Send a new message to continue.',
      ts: Date.now(),
    });
  }
  return rows.map((r) => r.id);
}
