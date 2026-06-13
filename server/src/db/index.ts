import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';

/**
 * Minimal dual-driver DB layer. Uses PostgreSQL when DATABASE_URL is set
 * (durable managed DB), otherwise better-sqlite3 on the local volume.
 * Queries are written with $1,$2 placeholders; for SQLite they're rewritten
 * to `?`. SQL is kept to the common subset both engines share.
 */
export let dialect: 'pg' | 'sqlite' = 'sqlite';

let sqlite: Database.Database | null = null;
let pgPool: import('pg').Pool | null = null;

export async function initDb() {
  if (config.databaseUrl) {
    dialect = 'pg';
    const { Pool } = await import('pg');
    // SSL on for remote managed DBs (DO uses its own CA), off for local/socket
    // or when the URL explicitly disables it.
    const url = config.databaseUrl;
    const local = /@(localhost|127\.0\.0\.1|\/)/.test(url) || /host=\//.test(url) || /[?&]host=/.test(url);
    const ssl = /sslmode=disable/.test(url) || local ? false : { rejectUnauthorized: false };
    pgPool = new Pool({ connectionString: url, ssl, max: 8 });
    await pgPool.query('SELECT 1');
    console.log(`[db] using PostgreSQL (ssl: ${ssl ? 'on' : 'off'})`);
  } else {
    dialect = 'sqlite';
    fs.mkdirSync(config.dataDir, { recursive: true });
    sqlite = new Database(path.join(config.dataDir, 'arksai.db'));
    sqlite.pragma('journal_mode = WAL');
    console.log('[db] using SQLite at', config.dataDir);
  }
  await migrate();
}

export async function q<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  if (dialect === 'pg') {
    const res = await pgPool!.query(sql, params);
    return res.rows as T[];
  }
  const s = sql.replace(/\$\d+/g, '?');
  const stmt = sqlite!.prepare(s);
  if (/^\s*(select|with)/i.test(s)) return stmt.all(...params) as T[];
  stmt.run(...params);
  return [];
}

export async function qOne<T = any>(sql: string, params: any[] = []): Promise<T | null> {
  return (await q<T>(sql, params))[0] ?? null;
}

async function migrate() {
  const INT = dialect === 'pg' ? 'BIGINT' : 'INTEGER';
  const REAL = dialect === 'pg' ? 'DOUBLE PRECISION' : 'REAL';

  await q(`CREATE TABLE IF NOT EXISTS sessions(
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    repo_url TEXT,
    repo_name TEXT,
    branch TEXT,
    mode TEXT NOT NULL,
    model TEXT NOT NULL,
    status TEXT NOT NULL,
    diff_stat TEXT,
    total_tokens ${INT} NOT NULL DEFAULT 0,
    prompt_tokens ${INT} NOT NULL DEFAULT 0,
    completion_tokens ${INT} NOT NULL DEFAULT 0,
    cost_usd ${REAL} NOT NULL DEFAULT 0,
    context TEXT NOT NULL DEFAULT '[]',
    created_at ${INT} NOT NULL,
    updated_at ${INT} NOT NULL
  )`);
  await q(`CREATE TABLE IF NOT EXISTS timeline(
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    seq ${INT} NOT NULL,
    payload TEXT NOT NULL,
    created_at ${INT} NOT NULL
  )`);
  await q(`CREATE INDEX IF NOT EXISTS idx_timeline_session ON timeline(session_id, seq)`);
  await q(`CREATE TABLE IF NOT EXISTS custom_commands(
    name TEXT PRIMARY KEY,
    description TEXT NOT NULL DEFAULT '',
    template TEXT NOT NULL,
    created_at ${INT} NOT NULL,
    updated_at ${INT} NOT NULL
  )`);
  await q(`CREATE TABLE IF NOT EXISTS memory(
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at ${INT} NOT NULL
  )`);
  await q(`CREATE INDEX IF NOT EXISTS idx_memory_scope ON memory(scope, created_at)`);

  // Projects: persistent workspaces (instructions + knowledge + defaults) that
  // group sessions. branding is JSON.
  await q(`CREATE TABLE IF NOT EXISTS projects(
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    instructions TEXT NOT NULL DEFAULT '',
    default_repo_url TEXT,
    default_branch TEXT,
    default_mode TEXT,
    default_model TEXT,
    branding TEXT,
    created_at ${INT} NOT NULL,
    updated_at ${INT} NOT NULL
  )`);
  await q(`CREATE TABLE IF NOT EXISTS project_files(
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    size ${INT} NOT NULL DEFAULT 0,
    created_at ${INT} NOT NULL
  )`);
  await q(`CREATE INDEX IF NOT EXISTS idx_project_files ON project_files(project_id, created_at)`);

  // Best-effort migrations for older DBs.
  for (const col of [
    `prompt_tokens ${INT} NOT NULL DEFAULT 0`,
    `completion_tokens ${INT} NOT NULL DEFAULT 0`,
    `cost_usd ${REAL} NOT NULL DEFAULT 0`,
    `project_id TEXT`,
  ]) {
    try {
      await q(`ALTER TABLE sessions ADD COLUMN ${col}`);
    } catch {
      /* already exists */
    }
  }
  await q(`CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id)`).catch(() => {});
}
