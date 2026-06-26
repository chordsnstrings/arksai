import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setupDatabase } from '../src/deploy/publish';

function tmp(files: Record<string, string>): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-db-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(d, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return d;
}

test('setupDatabase: an app with NO prisma schema needs no provisioning', async () => {
  const d = tmp({ 'package.json': '{}' });
  assert.deepEqual(await setupDatabase(d), { ok: true });
});

test('setupDatabase: a Postgres app is REJECTED with guidance to use SQLite (it can never deploy here)', async () => {
  const d = tmp({ 'prisma/schema.prisma': 'datasource db {\n provider = "postgresql"\n url = env("DATABASE_URL")\n}' });
  const r = await setupDatabase(d);
  assert.equal(r.ok, false);
  assert.match(r.error || '', /sqlite/i);
  assert.match(r.error || '', /postgres/i);
});

test('setupDatabase: a MongoDB app is likewise rejected', async () => {
  const d = tmp({ 'schema.prisma': 'datasource db { provider = "mongodb" }' });
  assert.equal((await setupDatabase(d)).ok, false);
});
