import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
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

/** Tiny global key/value helpers (app_settings). Portable upsert via excluded.value
 *  (NOT a reused $N — SQLite rewrites every $N→? positionally, so reuse underspecifies). */
export async function getSetting(key: string): Promise<string | null> {
  const r = await qOne<{ value: string }>('SELECT value FROM app_settings WHERE key = $1', [key]);
  return r?.value ?? null;
}
export async function setSetting(key: string, value: string): Promise<void> {
  await q('INSERT INTO app_settings(key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [
    key,
    value,
  ]);
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

  // User feedback on the agent's output (thumbs up/down + an optional complaint) — so the
  // team SEES what's failing. Org-scoped; complaint is the user's own words (never cross-org).
  await q(`CREATE TABLE IF NOT EXISTS feedback(
    id TEXT PRIMARY KEY,
    org_id TEXT,
    session_id TEXT,
    message_id TEXT,
    kind TEXT,
    rating TEXT,
    complaint TEXT,
    meta TEXT,
    status TEXT,
    created_at ${INT} NOT NULL,
    day ${INT} NOT NULL
  )`);
  await q(`CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback(created_at)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_feedback_org ON feedback(org_id)`);

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

  // ---- Android APK builds (one row per build job on an ephemeral DO droplet) ----
  await q(`CREATE TABLE IF NOT EXISTS builds(
    id TEXT PRIMARY KEY,
    session_id TEXT,
    org_id TEXT,
    platform TEXT NOT NULL,
    app_name TEXT NOT NULL,
    status TEXT NOT NULL,
    phase TEXT,
    droplet_id TEXT,
    token TEXT NOT NULL,
    artifact_path TEXT,
    size_bytes ${INT},
    cost ${REAL},
    error TEXT,
    created_at ${INT} NOT NULL,
    updated_at ${INT} NOT NULL
  )`);
  await q(`CREATE INDEX IF NOT EXISTS idx_builds_session ON builds(session_id)`);

  // ---- Multi-org: organizations, users, memberships, invite links, auth sessions, project visibility ----
  await q(`CREATE TABLE IF NOT EXISTS orgs(
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    currency TEXT,
    created_at ${INT} NOT NULL
  )`);
  // Backfill the currency column on databases created before it existed.
  await q(`ALTER TABLE orgs ADD COLUMN currency TEXT`).catch(() => {});
  // Per-org shared profile (brand + "about" + onboarding answers), seeded by the
  // agent-driven onboarding. One row per org; NEVER shared across orgs.
  await q(`CREATE TABLE IF NOT EXISTS org_profiles(
    org_id TEXT PRIMARY KEY,
    profile TEXT,
    onboarding_complete ${INT} NOT NULL DEFAULT 0,
    created_at ${INT} NOT NULL,
    updated_at ${INT} NOT NULL
  )`);
  // Per-org email connection (one mailbox per org). Passwords are stored
  // AES-256-GCM encrypted at rest (lib/crypto). SMTP = outbound, IMAP = inbound.
  // verified_at = last successful connection test; auto_reply gates Stage-2 drafting.
  await q(`CREATE TABLE IF NOT EXISTS org_email_accounts(
    org_id TEXT PRIMARY KEY,
    from_name TEXT,
    from_email TEXT NOT NULL,
    smtp_host TEXT NOT NULL,
    smtp_port ${INT} NOT NULL DEFAULT 587,
    smtp_secure ${INT} NOT NULL DEFAULT 0,
    smtp_user TEXT,
    smtp_pass TEXT,
    imap_host TEXT,
    imap_port ${INT} NOT NULL DEFAULT 993,
    imap_secure ${INT} NOT NULL DEFAULT 1,
    imap_user TEXT,
    imap_pass TEXT,
    enabled ${INT} NOT NULL DEFAULT 1,
    auto_reply ${INT} NOT NULL DEFAULT 0,
    verified_at ${INT},
    created_at ${INT} NOT NULL,
    updated_at ${INT} NOT NULL
  )`);
  // Per-org Google Play Developer connection (one per org). MULTI-TENANT: each company
  // connects its OWN Play account, so apps publish under that company's developer identity
  // and billing — NEVER a shared ArksAI account. The service-account JSON (a GCP service
  // account the org granted the Play Android Publisher role) is stored AES-256-GCM encrypted
  // at rest (lib/crypto), write-only over the API. DORMANT until connected; the AAB build +
  // Play upload pipeline reads sa_json through the server only. default_track =
  // internal|closed|production. verified_at = last successful credential check.
  await q(`CREATE TABLE IF NOT EXISTS org_play_accounts(
    org_id TEXT PRIMARY KEY,
    developer_name TEXT,
    developer_id TEXT,
    package_prefix TEXT,
    default_track TEXT NOT NULL DEFAULT 'internal',
    sa_email TEXT,
    sa_project TEXT,
    sa_json TEXT,
    enabled ${INT} NOT NULL DEFAULT 1,
    verified_at ${INT},
    created_at ${INT} NOT NULL,
    updated_at ${INT} NOT NULL
  )`);
  // Robots: a standing email agent per org. role = what it does (customer_service /
  // personal_assistant / custom); autonomy = shadow|ask|auto (ask = draft for approval,
  // the safe default); model = which engine drafts (arksai-max=M3 / deepseek-v4 / compare).
  // config is JSON (persona, knowledge, escalation rules, signature).
  await q(`CREATE TABLE IF NOT EXISTS robots(
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    autonomy TEXT NOT NULL DEFAULT 'ask',
    model TEXT NOT NULL DEFAULT 'arksai-max',
    config TEXT,
    last_polled_at ${INT},
    created_at ${INT} NOT NULL,
    updated_at ${INT} NOT NULL
  )`);
  await q(`CREATE INDEX IF NOT EXISTS idx_robots_org ON robots(org_id, status)`);
  // Robot drafts: a reply the robot produced for an inbound message. to_addr is LOCKED to
  // the inbound sender (never a model-derived address). alt_text/alt_model hold the second
  // model's draft for the bake-off. status = pending|sent|dismissed|escalated.
  await q(`CREATE TABLE IF NOT EXISTS robot_drafts(
    id TEXT PRIMARY KEY,
    robot_id TEXT NOT NULL,
    org_id TEXT NOT NULL,
    inbound_message_id TEXT,
    inbound_from TEXT NOT NULL,
    inbound_name TEXT,
    inbound_subject TEXT,
    inbound_snippet TEXT,
    to_addr TEXT NOT NULL,
    subject TEXT NOT NULL,
    draft_text TEXT NOT NULL,
    model_used TEXT,
    alt_text TEXT,
    alt_model TEXT,
    escalated ${INT} NOT NULL DEFAULT 0,
    escalation_reason TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at ${INT} NOT NULL,
    sent_at ${INT}
  )`);
  await q(`CREATE INDEX IF NOT EXISTS idx_robot_drafts ON robot_drafts(robot_id, status, created_at)`);
  // Per-ROBOT mailbox (multi-tenant: each robot connects its OWN mailbox, so each robot is a
  // unique email identity). Same shape as org_email_accounts but keyed by robot_id; org_id is
  // kept for scoping. Passwords AES-256-GCM encrypted at rest.
  await q(`CREATE TABLE IF NOT EXISTS robot_email_accounts(
    robot_id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    from_name TEXT,
    from_email TEXT NOT NULL,
    smtp_host TEXT NOT NULL,
    smtp_port ${INT} NOT NULL DEFAULT 587,
    smtp_secure ${INT} NOT NULL DEFAULT 0,
    smtp_user TEXT,
    smtp_pass TEXT,
    imap_host TEXT,
    imap_port ${INT} NOT NULL DEFAULT 993,
    imap_secure ${INT} NOT NULL DEFAULT 1,
    imap_user TEXT,
    imap_pass TEXT,
    enabled ${INT} NOT NULL DEFAULT 1,
    auto_reply ${INT} NOT NULL DEFAULT 0,
    verified_at ${INT},
    created_at ${INT} NOT NULL,
    updated_at ${INT} NOT NULL
  )`);
  await q(`CREATE INDEX IF NOT EXISTS idx_robot_drafts_msg ON robot_drafts(robot_id, inbound_message_id)`);
  // Robot RULES (the learning loop): preferences the owner taught the robot from resolving an
  // escalation — "when an email is like X, do Y". Injected as GROUNDING data into the reply
  // prompt so the robot handles that kind of mail itself instead of escalating it again.
  await q(`CREATE TABLE IF NOT EXISTS robot_rules(
    id TEXT PRIMARY KEY,
    robot_id TEXT NOT NULL,
    org_id TEXT NOT NULL,
    pattern TEXT NOT NULL,
    instruction TEXT NOT NULL,
    enabled ${INT} NOT NULL DEFAULT 1,
    created_at ${INT} NOT NULL
  )`);
  await q(`CREATE INDEX IF NOT EXISTS idx_robot_rules ON robot_rules(robot_id, enabled)`);
  // Per-org allowlist of addresses a robot may FORWARD to (the one case the recipient-lock is
  // broken). Admin-managed; the responder's Forward picks only from here.
  await q(`CREATE TABLE IF NOT EXISTS robot_forward_allowlist(
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    label TEXT,
    email TEXT NOT NULL,
    created_at ${INT} NOT NULL
  )`);
  await q(`CREATE INDEX IF NOT EXISTS idx_robot_fwd ON robot_forward_allowlist(org_id)`);
  // Robot CHANNELS beyond email (telegram/whatsapp/sms): one row per robot × kind. Secrets
  // (bot token / access token / API password) AES-256-GCM encrypted in `secrets`; `meta` holds
  // the non-secret settings (phone number id, sender id, hook key…); `state` is adapter
  // runtime state (e.g. the Telegram getUpdates offset).
  await q(`CREATE TABLE IF NOT EXISTS robot_channels(
    id TEXT PRIMARY KEY,
    robot_id TEXT NOT NULL,
    org_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    label TEXT,
    secrets TEXT,
    meta TEXT,
    state TEXT,
    enabled ${INT} NOT NULL DEFAULT 1,
    verified_at ${INT},
    created_at ${INT} NOT NULL,
    updated_at ${INT} NOT NULL,
    UNIQUE(robot_id, kind)
  )`);
  await q(`CREATE INDEX IF NOT EXISTS idx_robot_channels ON robot_channels(org_id, kind, enabled)`);
  // Reusable org-level personas a robot can speak as (picked via robot config.personaId).
  await q(`CREATE TABLE IF NOT EXISTS robot_personas(
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    voice TEXT NOT NULL,
    language TEXT,
    signature TEXT,
    created_at ${INT} NOT NULL,
    updated_at ${INT} NOT NULL
  )`);
  await q(`CREATE INDEX IF NOT EXISTS idx_robot_personas ON robot_personas(org_id)`);
  // Per-robot knowledge documents (extracted text) — retrieval picks only the RELEVANT
  // slices into a reply's context, preserving the §5c data-minimization.
  await q(`CREATE TABLE IF NOT EXISTS robot_kb_docs(
    id TEXT PRIMARY KEY,
    robot_id TEXT NOT NULL,
    org_id TEXT NOT NULL,
    name TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at ${INT} NOT NULL
  )`);
  await q(`CREATE INDEX IF NOT EXISTS idx_robot_kb ON robot_kb_docs(robot_id)`);
  // Trusted COMMANDERS — the owner's own addresses per channel. Only a message from a listed
  // commander can trigger a build or name a delivery destination (the trifecta-safe gate for
  // the "text the robot → it builds and delivers" bridge).
  await q(`CREATE TABLE IF NOT EXISTS robot_commanders(
    id TEXT PRIMARY KEY,
    robot_id TEXT NOT NULL,
    org_id TEXT NOT NULL,
    channel TEXT NOT NULL,
    address TEXT NOT NULL,
    label TEXT,
    created_at ${INT} NOT NULL
  )`);
  await q(`CREATE INDEX IF NOT EXISTS idx_robot_cmd ON robot_commanders(robot_id, channel)`);
  // Builds a robot runs on a commander's instruction — each owns a real session; the poller
  // watches running tasks and delivers the artifacts back on the channel when the run ends.
  await q(`CREATE TABLE IF NOT EXISTS robot_tasks(
    id TEXT PRIMARY KEY,
    robot_id TEXT NOT NULL,
    org_id TEXT NOT NULL,
    channel TEXT NOT NULL,
    commander TEXT NOT NULL,
    request TEXT NOT NULL,
    session_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running',
    deliver_to TEXT,
    artifacts TEXT,
    error TEXT,
    created_at ${INT} NOT NULL,
    finished_at ${INT}
  )`);
  await q(`CREATE INDEX IF NOT EXISTS idx_robot_tasks ON robot_tasks(robot_id, status)`);
  // Owner pings: one row per (draft → commander channel/address) notification, so the owner
  // can approve/dictate the reply from their own chat. resolved_at set when acted on.
  await q(`CREATE TABLE IF NOT EXISTS robot_notifications(
    id TEXT PRIMARY KEY,
    robot_id TEXT NOT NULL,
    org_id TEXT NOT NULL,
    draft_id TEXT NOT NULL,
    channel TEXT NOT NULL,
    address TEXT NOT NULL,
    created_at ${INT} NOT NULL,
    resolved_at ${INT}
  )`);
  await q(`CREATE INDEX IF NOT EXISTS idx_robot_notif ON robot_notifications(robot_id, channel, address, resolved_at)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_robot_notif_draft ON robot_notifications(draft_id)`);
  // Proactive routines: a daily/weekly digest of the robot's activity, or a recurring BRIEF
  // (a build executed on schedule and delivered on a channel). next_run_at advanced BEFORE
  // firing (the scheduler's double-fire guard).
  await q(`CREATE TABLE IF NOT EXISTS robot_jobs(
    id TEXT PRIMARY KEY,
    robot_id TEXT NOT NULL,
    org_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    cadence TEXT NOT NULL,
    at_time TEXT,
    weekday ${INT},
    tz TEXT,
    prompt TEXT,
    deliver_to TEXT,
    enabled ${INT} NOT NULL DEFAULT 1,
    next_run_at ${INT} NOT NULL,
    last_run_at ${INT},
    created_at ${INT} NOT NULL
  )`);
  await q(`CREATE INDEX IF NOT EXISTS idx_robot_jobs ON robot_jobs(enabled, next_run_at)`);
  // Gated ACTIONS a robot may take mid-reply (org-defined HTTPS calls: order lookup, stock
  // check…). URL/body templates carry {{param}} slots; headers (secrets) AES-encrypted.
  // mode 'ask' escalates instead of executing; 'auto' executes + logs.
  await q(`CREATE TABLE IF NOT EXISTS robot_actions(
    id TEXT PRIMARY KEY,
    robot_id TEXT NOT NULL,
    org_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    method TEXT NOT NULL DEFAULT 'GET',
    url_template TEXT NOT NULL,
    headers TEXT,
    params TEXT,
    body_template TEXT,
    mode TEXT NOT NULL DEFAULT 'ask',
    clean_uses ${INT} NOT NULL DEFAULT 0,
    enabled ${INT} NOT NULL DEFAULT 1,
    created_at ${INT} NOT NULL,
    UNIQUE(robot_id, name)
  )`);
  await q(`CREATE INDEX IF NOT EXISTS idx_robot_actions ON robot_actions(robot_id, enabled)`);
  // Full audit of every action execution (§5b invariant: every send/call logged).
  await q(`CREATE TABLE IF NOT EXISTS robot_action_log(
    id TEXT PRIMARY KEY,
    robot_id TEXT NOT NULL,
    org_id TEXT NOT NULL,
    action_name TEXT NOT NULL,
    params TEXT,
    from_addr TEXT,
    status ${INT},
    ok ${INT} NOT NULL DEFAULT 0,
    ms ${INT},
    created_at ${INT} NOT NULL
  )`);
  await q(`CREATE INDEX IF NOT EXISTS idx_robot_action_log ON robot_action_log(robot_id, created_at)`);
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

  // ---- Analytics event stream (platform usage/retention; METADATA ONLY, never content) ----
  // `day` is a precomputed epoch-day bucket (floor(ts/86400000)) so day-grained
  // GROUP BY needs ZERO date functions (keeps SQLite+PG portable).
  await q(`CREATE TABLE IF NOT EXISTS analytics_events(
    id TEXT PRIMARY KEY,
    ts ${INT} NOT NULL,
    day ${INT} NOT NULL,
    event TEXT NOT NULL,
    org_id TEXT,
    user_id TEXT,
    session_id TEXT,
    props TEXT,
    created_at ${INT} NOT NULL
  )`);
  await q(`CREATE INDEX IF NOT EXISTS idx_analytics_day ON analytics_events(day)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_analytics_org_day ON analytics_events(org_id, day)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_analytics_event ON analytics_events(event, ts)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_analytics_user ON analytics_events(user_id, ts)`);

  // Scheduled analytics digests — periodic metric snapshots (METADATA ONLY) the operator
  // can review in-app; also pushed to a webhook if ANALYTICS_DIGEST_WEBHOOK is configured.
  await q(`CREATE TABLE IF NOT EXISTS analytics_digests(
    id TEXT PRIMARY KEY,
    org_id TEXT,
    period_end ${INT} NOT NULL,
    generated_at ${INT} NOT NULL,
    summary TEXT NOT NULL,
    created_at ${INT} NOT NULL
  )`);
  await q(`CREATE INDEX IF NOT EXISTS idx_analytics_digests_gen ON analytics_digests(generated_at)`);

  // Ad-platform connectors — per-ORG OAuth links to Meta/Google/TikTok ad accounts.
  // Tokens are stored ENCRYPTED (AES-256-GCM); never plaintext. One row per connected
  // ad account. Org-scoped: an org only ever sees its own connectors.
  await q(`CREATE TABLE IF NOT EXISTS connectors(
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    account_id TEXT NOT NULL,
    account_name TEXT,
    access_token_enc TEXT NOT NULL,
    refresh_token_enc TEXT,
    expires_at ${INT},
    scopes TEXT,
    status TEXT NOT NULL,
    created_by TEXT,
    created_at ${INT} NOT NULL,
    updated_at ${INT} NOT NULL
  )`);
  await q(`CREATE INDEX IF NOT EXISTS idx_connectors_org ON connectors(org_id)`);
  await q(`CREATE UNIQUE INDEX IF NOT EXISTS idx_connectors_uniq ON connectors(org_id, provider, account_id)`);

  // GitHub OAuth links — per USER (each member connects their own GitHub account; their
  // sessions push generated code to repos they pick). Token stored ENCRYPTED (AES-256-GCM),
  // never plaintext. One row per user (reconnect replaces). org_id is for visibility/analytics.
  await q(`CREATE TABLE IF NOT EXISTS github_connections(
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    org_id TEXT,
    github_login TEXT,
    github_user_id TEXT,
    avatar_url TEXT,
    access_token_enc TEXT NOT NULL,
    scopes TEXT,
    status TEXT NOT NULL,
    created_at ${INT} NOT NULL,
    updated_at ${INT} NOT NULL
  )`);
  await q(`CREATE UNIQUE INDEX IF NOT EXISTS idx_github_conn_user ON github_connections(user_id)`);

  // Per-user Google Workspace connection (Gmail / Calendar / Drive·Sheets for the agent + robots).
  // Access + refresh tokens stored ENCRYPTED (AES-256-GCM via lib/crypto). One row per user.
  await q(`CREATE TABLE IF NOT EXISTS google_connections(
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    org_id TEXT,
    email TEXT,
    access_token_enc TEXT NOT NULL,
    refresh_token_enc TEXT,
    scopes TEXT,
    expires_at ${INT},
    status TEXT NOT NULL,
    created_at ${INT} NOT NULL,
    updated_at ${INT} NOT NULL
  )`);
  await q(`CREATE UNIQUE INDEX IF NOT EXISTS idx_google_conn_user ON google_connections(user_id)`);

  // Org prepaid wallet (cached balance) + append-only ledger (the statement/invoice source of
  // truth). ALL amounts are integer MICRO-USD (USD×1e6) so balances never drift. USD is canonical;
  // a floating display currency (BDT) is shown as an indicative conversion only.
  await q(`CREATE TABLE IF NOT EXISTS org_wallets(
    org_id TEXT PRIMARY KEY,
    balance_micros ${INT} NOT NULL DEFAULT 0,
    updated_at ${INT} NOT NULL
  )`);
  await q(`CREATE TABLE IF NOT EXISTS wallet_ledger(
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    ts ${INT} NOT NULL,
    type TEXT NOT NULL,
    amount_micros ${INT} NOT NULL,
    balance_after_micros ${INT} NOT NULL,
    source TEXT NOT NULL,
    ref TEXT,
    note TEXT,
    created_by TEXT
  )`);
  await q(`CREATE INDEX IF NOT EXISTS idx_wallet_ledger_org ON wallet_ledger(org_id, ts)`);
  // Idempotency: (org, source, ref) is unique when ref is set — a retried top-up / re-fired
  // run_finished can't double-charge. (NULL refs don't collide in either SQLite or Postgres.)
  await q(`CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_ledger_idem ON wallet_ledger(org_id, source, ref)`);

  // Self-healing: captured errors/timeouts/cost-spikes (METADATA + scrubbed context) the
  // operator can review and an auto-fix agent can act on. Deduped by fingerprint (count++).
  await q(`CREATE TABLE IF NOT EXISTS incidents(
    id TEXT PRIMARY KEY,
    fingerprint TEXT NOT NULL,
    kind TEXT NOT NULL,
    severity TEXT NOT NULL,
    title TEXT NOT NULL,
    detail TEXT,
    context TEXT,
    org_id TEXT,
    session_id TEXT,
    count ${INT} NOT NULL,
    status TEXT NOT NULL,
    issue_url TEXT,
    first_seen ${INT} NOT NULL,
    last_seen ${INT} NOT NULL
  )`);
  await q(`CREATE UNIQUE INDEX IF NOT EXISTS idx_incidents_fp ON incidents(fingerprint)`);
  await q(`CREATE INDEX IF NOT EXISTS idx_incidents_status ON incidents(status, last_seen)`);

  // Small global key/value store (e.g. the operator's chosen display name — the operator
  // logs in via APP_PASSWORD and has no users row, so it can't live on a user).
  await q(`CREATE TABLE IF NOT EXISTS app_settings(
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`);

  // Best-effort migrations for older DBs.
  for (const col of [
    `prompt_tokens ${INT} NOT NULL DEFAULT 0`,
    `completion_tokens ${INT} NOT NULL DEFAULT 0`,
    `cost_usd ${REAL} NOT NULL DEFAULT 0`,
    `project_id TEXT`,
    `task TEXT`,
    `awaiting_plan ${INT} NOT NULL DEFAULT 0`,
    `github_connection_id TEXT`,
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
    'schedules:tz TEXT',
    `deployments:expires_at ${INT}`,
    'deployments:static_dir TEXT',
    // Robots: a `type` (email/scheduled/ads/monitor…) so the console + runtime route by kind;
    // existing robots are email. Drafts keep the full inbound body for the responder + snooze.
    "robots:type TEXT NOT NULL DEFAULT 'email'",
    'robot_drafts:inbound_body TEXT',
    `robot_drafts:snooze_until ${INT}`,
    // Which channel a draft's conversation lives on (email/telegram/whatsapp/sms).
    "robot_drafts:channel TEXT NOT NULL DEFAULT 'email'",
    // iCal REPLY payload prepared by the meeting-invite lane (sent as an attachment).
    'robot_drafts:ics_reply TEXT',
    // A commander row doubles as an owner-notification target (escalation pings).
    `robot_commanders:notify ${INT} NOT NULL DEFAULT 1`,
    // When a delivered task was sent back for revision (collect-since + timeout anchor).
    `robot_tasks:revised_at ${INT}`,
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

  // custom_commands → ORG-SCOPED. The single-tenant schema keyed commands by `name`
  // (deployment-wide, so every org saw/edited/overwrote each other's). Rebuild it
  // per-org with a surrogate id + UNIQUE(org_id,name), stamping any existing rows to
  // the Default org. One-time + idempotent (subsequent boots see org_id and skip).
  let cmdScoped = true;
  try {
    await q('SELECT org_id FROM custom_commands LIMIT 1');
  } catch {
    cmdScoped = false;
  }
  if (!cmdScoped) {
    await q(`CREATE TABLE custom_commands_v2(
      id TEXT PRIMARY KEY,
      org_id TEXT,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      template TEXT NOT NULL,
      created_at ${INT} NOT NULL,
      updated_at ${INT} NOT NULL
    )`);
    const old = await q('SELECT * FROM custom_commands').catch(() => []);
    for (const r of old as any[]) {
      await q(
        `INSERT INTO custom_commands_v2(id,org_id,name,description,template,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [randomUUID(), 'default', r.name, r.description ?? '', r.template, Number(r.created_at) || Date.now(), Number(r.updated_at) || Date.now()],
      ).catch(() => {});
    }
    await q('DROP TABLE custom_commands');
    await q('ALTER TABLE custom_commands_v2 RENAME TO custom_commands');
  }
  await q('CREATE UNIQUE INDEX IF NOT EXISTS idx_cmd_org_name ON custom_commands(org_id, name)').catch(() => {});
}
