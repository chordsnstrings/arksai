import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.ENCRYPTION_KEY = 'test-db-secret';
delete process.env.MANAGED_PG_ADMIN_URL; // ensure "not enabled" path for the gating test

let m: typeof import('../src/deploy/dbProvision');
before(async () => {
  m = await import('../src/deploy/dbProvision');
});

test('safeDbName: sanitizes a slug to a safe, stable identifier', () => {
  assert.equal(m.safeDbName('eco-clean-uae'), 'app_eco_clean_uae');
  assert.equal(m.safeDbName('My App!! 2026'), 'app_my_app_2026');
  assert.equal(m.safeDbName('--weird--'), 'app_weird');
  // no SQL-injectable characters survive
  assert.match(m.safeDbName('a"; DROP TABLE x;--'), /^app_[a-z0-9_]+$/);
});

test('appDbPassword: deterministic per slug (re-publish derives the same), distinct across apps', () => {
  assert.equal(m.appDbPassword('foo'), m.appDbPassword('foo'));
  assert.notEqual(m.appDbPassword('foo'), m.appDbPassword('bar'));
  assert.match(m.appDbPassword('foo'), /^[a-f0-9]{32}$/);
});

test('buildPgUrl: swaps the database name, user and password into a base URL', () => {
  const url = m.buildPgUrl('postgresql://admin:secret@db.example.com:5432/defaultdb', 'app_x', 'app_x', 'pw123');
  const u = new URL(url);
  assert.equal(u.pathname, '/app_x');
  assert.equal(u.username, 'app_x');
  assert.equal(u.password, 'pw123');
  assert.equal(u.hostname, 'db.example.com');
});

test('detectDbKind: from Prisma provider and from deps', () => {
  assert.equal(m.detectDbKind(null, 'sqlite'), 'sqlite');
  assert.equal(m.detectDbKind(null, 'postgresql'), 'postgres');
  assert.equal(m.detectDbKind(null, 'mongodb'), 'mongo');
  assert.equal(m.detectDbKind(JSON.stringify({ dependencies: { 'better-sqlite3': '^9' } }), null), 'sqlite');
  assert.equal(m.detectDbKind(JSON.stringify({ dependencies: { pg: '^8' } }), null), 'postgres');
  assert.equal(m.detectDbKind(JSON.stringify({ dependencies: { mongoose: '^8' } }), null), 'mongo');
  assert.equal(m.detectDbKind(JSON.stringify({ dependencies: { express: '^4' } }), null), 'none');
});

test('provisionAppDatabase: SQLite needs no provisioning; an unconfigured server DB reports not-enabled', async () => {
  assert.deepEqual(await m.provisionAppDatabase('s', 'sqlite'), { ok: true });
  assert.deepEqual(await m.provisionAppDatabase('s', 'none'), { ok: true });
  const pg = await m.provisionAppDatabase('s', 'postgres'); // no MANAGED_PG_ADMIN_URL set
  assert.equal(pg.ok, false);
  assert.match(pg.error || '', /not enabled|SQLite/i);
  const mongo = await m.provisionAppDatabase('s', 'mongo');
  assert.equal(mongo.ok, false);
});

test('deprovisionAppDatabase: a no-op (never throws) when Postgres is not configured', async () => {
  await m.deprovisionAppDatabase('any-slug'); // MANAGED_PG_ADMIN_URL unset → harmless no-op
});

test('readDotEnv: parses a deployed app .env into env vars', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-env-'));
  fs.writeFileSync(path.join(d, '.env'), 'DATABASE_URL="file:./prod.db"\n# comment\nFOO=bar\n');
  const reg = require('../src/deploy/registry');
  const env = reg.readDotEnv(d);
  assert.equal(env.DATABASE_URL, 'file:./prod.db');
  assert.equal(env.FOO, 'bar');
});
