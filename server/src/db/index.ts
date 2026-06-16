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

  // B2B leads captured from the public landing page (pre-login).
  await q(`CREATE TABLE IF NOT EXISTS leads(
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    company TEXT,
    role TEXT,
    team TEXT,
    note TEXT,
    created_at ${INT} NOT NULL
  )`);
  await q(`CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at)`);

  // Scheduled / recurring tasks (durable, server-side).
  await q(`CREATE TABLE IF NOT EXISTS schedules(
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    prompt TEXT NOT NULL,
    mode TEXT NOT NULL,
    model TEXT NOT NULL,
    cadence TEXT NOT NULL,
    at TEXT,
    weekday ${INT},
    interval_ms ${INT},
    enabled ${INT} NOT NULL DEFAULT 1,
    next_run_at ${INT} NOT NULL,
    last_run_at ${INT},
    created_at ${INT} NOT NULL
  )`);
  await q(`CREATE INDEX IF NOT EXISTS idx_schedules_next ON schedules(enabled, next_run_at)`);

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

  // Deployments: a built app published to a durable URL on the volume.
  await q(`CREATE TABLE IF NOT EXISTS deployments(
    id TEXT PRIMARY KEY,
    session_id TEXT,
    project_id TEXT,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    url TEXT NOT NULL,
    port ${INT},
    created_at ${INT} NOT NULL,
    updated_at ${INT} NOT NULL
  )`);

  // ---- Multi-org: organizations, users, memberships, invite links, auth sessions, project visibility ----
  await q(`CREATE TABLE IF NOT EXISTS orgs(
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    created_at ${INT} NOT NULL
  )`);
  // Per-org shared profile (brand + "about" + onboarding answers), seeded by the
  // agent-driven onboarding. One row per org; NEVER shared across orgs.
  await q(`CREATE TABLE IF NOT EXISTS org_profiles(
    org_id TEXT PRIMARY KEY,
    profile TEXT,
    onboarding_complete ${INT} NOT NULL DEFAULT 0,
    created_at ${INT} NOT NULL,
    updated_at ${INT} NOT NULL
  )`);
  await q(`CREATE TABLE IF NOT EXISTS users(
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT,
    name TEXT,
    is_superadmin ${INT} NOT NULL DEFAULT 0,
    created_at ${INT} NOT NULL
  )`);
  await q(`CREATE TABLE IF NOT EXISTS memberships(
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    org_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    created_at ${INT} NOT NULL,
    UNIQUE(user_id, org_id)
  )`);
  await q(`CREATE INDEX IF NOT EXISTS idx_memberships_org ON memberships(org_id)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(user_id)`);
  await q(`CREATE TABLE IF NOT EXISTS invites(
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    token_hash TEXT NOT NULL,
    invited_by TEXT,
    expires_at ${INT} NOT NULL,
    accepted_at ${INT},
    created_at ${INT} NOT NULL
  )`);
  await q(`CREATE INDEX IF NOT EXISTS idx_invites_token ON invites(token_hash)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_invites_org ON invites(org_id)`);
  await q(`CREATE TABLE IF NOT EXISTS auth_sessions(
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    current_org_id TEXT,
    created_at ${INT} NOT NULL,
    expires_at ${INT} NOT NULL,
    last_seen_at ${INT} NOT NULL
  )`);
  await q(`CREATE INDEX IF NOT EXISTS idx_auth_sessions_token ON auth_sessions(token_hash)`);
  await q(`CREATE TABLE IF NOT EXISTS project_members(
    project_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_at ${INT} NOT NULL,
    PRIMARY KEY(project_id, user_id)
  )`);

  // Best-effort migrations for older DBs.
  for (const col of [
    `prompt_tokens ${INT} NOT NULL DEFAULT 0`,
    `completion_tokens ${INT} NOT NULL DEFAULT 0`,
    `cost_usd ${REAL} NOT NULL DEFAULT 0`,
    `project_id TEXT`,
    `task TEXT`,
  ]) {
    try {
      await q(`ALTER TABLE sessions ADD COLUMN ${col}`);
    } catch {
      /* already exists */
    }
  }
  await q(`CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id)`).catch(() => {});

  // Multi-org scoping columns on existing tables (additive; backfilled by bootstrapOrgs()).
  for (const spec of [
    'sessions:org_id TEXT',
    'sessions:created_by TEXT',
    'projects:org_id TEXT',
    'projects:owner_user_id TEXT',
    "projects:visibility TEXT NOT NULL DEFAULT 'org'",
    'deployments:org_id TEXT',
    'schedules:org_id TEXT',
  ]) {
    const cut = spec.indexOf(':');
    const table = spec.slice(0, cut);
    const col = spec.slice(cut + 1);
    try {
      await q(`ALTER TABLE ${table} ADD COLUMN ${col}`);
    } catch {
      /* already exists */
    }
  }
  for (const table of ['sessions', 'projects', 'deployments', 'schedules']) {
    await q(`CREATE INDEX IF NOT EXISTS idx_${table}_org ON ${table}(org_id)`).catch(() => {});
  }
}
