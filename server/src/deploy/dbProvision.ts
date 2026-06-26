// Database provisioning for deployed apps. A real database (Postgres/MySQL/Mongo) is a SERVER, so
// to make "any database" work we provision a per-app, ISOLATED database on a configured instance
// and hand the app its own connection string. SQLite needs nothing (it ships as a file with the app
// — handled in publish.ts). Postgres is the first real driver (a managed instance already exists);
// the registry is built so MySQL/Mongo/Redis slot in later.
//
// Gated on config: with no admin URL configured for a kind, provisioning is a no-op that reports
// "not enabled" — so this is INERT until the operator points it at a server (then it goes live).

import crypto from 'node:crypto';
import { config } from '../config';

export type DbKind = 'sqlite' | 'postgres' | 'mysql' | 'mongo' | 'redis' | 'none';

export interface ProvisionResult {
  ok: boolean;
  /** The env var the app reads (DATABASE_URL / MONGODB_URI / …) and the value to set. */
  envVar?: string;
  connectionString?: string;
  /** When !ok, a clear reason the agent/operator can act on. */
  error?: string;
}

/** A safe, stable per-app identifier: `app_<slug>` reduced to [a-z0-9_], so re-publish reuses the
 *  SAME database (data persists) and it can never inject SQL via the slug. Pure. */
export function safeDbName(slug: string): string {
  const s = String(slug).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  return `app_${s || 'x'}`;
}

/** A deterministic per-app password (so re-publish derives the same one — no state to store).
 *  Derived from the slug + the deployment secret; never reused across apps. Pure. */
export function appDbPassword(slug: string): string {
  const secret = config.encryptionKey || config.appPassword || 'arksai';
  return crypto.createHmac('sha256', secret).update(`db:${slug}`).digest('hex').slice(0, 32);
}

/** Swap the database name (and optionally user/password) into a base connection URL. Pure. */
export function buildPgUrl(adminUrl: string, dbName: string, user?: string, password?: string): string {
  const u = new URL(adminUrl);
  u.pathname = `/${dbName}`;
  if (user) u.username = user;
  if (password !== undefined) u.password = password;
  return u.toString();
}

/** Detect what database a built app actually uses (Prisma provider first, then deps). Pure-ish. */
export function detectDbKind(pkgRaw: string | null, prismaProvider?: string | null): DbKind {
  if (prismaProvider) {
    if (/sqlite/i.test(prismaProvider)) return 'sqlite';
    if (/postgres|cockroach/i.test(prismaProvider)) return 'postgres';
    if (/mysql|mariadb/i.test(prismaProvider)) return 'mysql';
    if (/mongo/i.test(prismaProvider)) return 'mongo';
  }
  let deps = '';
  try {
    const pkg = JSON.parse(pkgRaw || '{}');
    deps = JSON.stringify({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }).toLowerCase();
  } catch {
    /* ignore */
  }
  if (/"(better-sqlite3|sqlite3|@libsql)"/.test(deps)) return 'sqlite';
  if (/"(pg|pg-promise|postgres|@neondatabase)"/.test(deps)) return 'postgres';
  if (/"(mysql2?|mariadb)"/.test(deps)) return 'mysql';
  if (/"(mongoose|mongodb)"/.test(deps)) return 'mongo';
  if (/"(redis|ioredis)"/.test(deps)) return 'redis';
  return 'none';
}

/**
 * Provision an isolated database for an app on the configured server and return its connection
 * string. Idempotent per slug (re-publish reuses the same DB → data persists). Postgres is wired;
 * the other kinds report "not enabled" until a server is configured for them.
 */
export async function provisionAppDatabase(slug: string, kind: DbKind): Promise<ProvisionResult> {
  if (kind === 'sqlite' || kind === 'none') return { ok: true }; // nothing to provision
  if (kind === 'postgres') return provisionPostgres(slug);
  return {
    ok: false,
    error:
      `A ${kind} database isn't provisioned on this deployment yet. Use a self-contained SQLite database ` +
      `(or Postgres, which is supported) so the app runs live.`,
  };
}

/** Create an isolated Postgres role + database on the managed instance and return its URL. */
async function provisionPostgres(slug: string): Promise<ProvisionResult> {
  const adminUrl = config.pgAdminUrl;
  if (!adminUrl) {
    return {
      ok: false,
      error:
        'This app uses Postgres, but Postgres provisioning is not enabled on this deployment ' +
        '(no managed instance configured). Use a self-contained SQLite database so it runs live, ' +
        'or ask the operator to enable Postgres (set MANAGED_PG_ADMIN_URL).',
    };
  }
  const db = safeDbName(slug);
  const role = db; // role name == database name, isolated per app
  const password = appDbPassword(slug);
  let pg: any;
  try {
    pg = await import('pg');
  } catch {
    return { ok: false, error: 'Postgres client unavailable on the server.' };
  }
  const ssl = /sslmode=require|\.ondigitalocean\.com|\.neon\.tech|\.supabase\./i.test(adminUrl)
    ? { rejectUnauthorized: false }
    : undefined;
  const admin = new pg.Client({ connectionString: adminUrl, ssl });
  try {
    await admin.connect();
    // Role: create if missing, always (re)set the derived password so the app URL stays valid.
    const roleExists = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role]);
    if (roleExists.rowCount === 0) {
      await admin.query(`CREATE ROLE ${ident(role)} LOGIN PASSWORD ${literal(password)}`);
    } else {
      await admin.query(`ALTER ROLE ${ident(role)} WITH LOGIN PASSWORD ${literal(password)}`);
    }
    // Database owned by that role (CREATE DATABASE can't run in a txn/DO block; guard by existence).
    const dbExists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [db]);
    if (dbExists.rowCount === 0) {
      await admin.query(`CREATE DATABASE ${ident(db)} OWNER ${ident(role)}`);
    }
    const connectionString = buildPgUrl(adminUrl, db, role, password) + (ssl ? '?sslmode=require' : '');
    return { ok: true, envVar: 'DATABASE_URL', connectionString };
  } catch (e: any) {
    return { ok: false, error: `Postgres provisioning failed: ${String(e?.message ?? e).slice(0, 200)}` };
  } finally {
    await admin.end().catch(() => {});
  }
}

/**
 * Tear down a deployed app's provisioned database when its preview is removed (24h expiry or
 * explicit delete) — so nothing leaks on the managed instance, the same way the Android build
 * droplet is always destroyed. SQLite needs nothing (its file lives in the deployment dir and is
 * deleted with it). Postgres drops the per-app database + role. Idempotent + best-effort: if there's
 * no such database (a SQLite app) or PG isn't configured, it's a harmless no-op. So `removeDeployment`
 * can call this unconditionally for any slug.
 */
export async function deprovisionAppDatabase(slug: string): Promise<void> {
  const adminUrl = config.pgAdminUrl;
  if (!adminUrl) return; // PG not enabled → nothing provisioned to reap
  const db = safeDbName(slug);
  const role = db;
  let pg: any;
  try {
    pg = await import('pg');
  } catch {
    return;
  }
  const ssl = /sslmode=require|\.ondigitalocean\.com|\.neon\.tech|\.supabase\./i.test(adminUrl)
    ? { rejectUnauthorized: false }
    : undefined;
  const admin = new pg.Client({ connectionString: adminUrl, ssl });
  try {
    await admin.connect();
    // WITH (FORCE) terminates any lingering connections (PG13+) so the drop can't hang on the app.
    await admin.query(`DROP DATABASE IF EXISTS ${ident(db)} WITH (FORCE)`).catch(async () => {
      // Older servers: terminate backends, then drop without FORCE.
      await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1', [db]).catch(() => {});
      await admin.query(`DROP DATABASE IF EXISTS ${ident(db)}`).catch(() => {});
    });
    await admin.query(`DROP ROLE IF EXISTS ${ident(role)}`).catch(() => {});
  } catch (e: any) {
    console.warn(`[deploy] db deprovision failed for ${slug}: ${String(e?.message ?? e).slice(0, 160)}`);
  } finally {
    await admin.end().catch(() => {});
  }
}

// Identifiers/literals are built from a SANITIZED name (safeDbName) + a derived hex password, so
// these never see untrusted input — but quote defensively anyway.
function ident(name: string): string {
  return `"${String(name).replace(/"/g, '""')}"`;
}
function literal(val: string): string {
  return `'${String(val).replace(/'/g, "''")}'`;
}
