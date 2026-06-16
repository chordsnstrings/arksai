import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-ttl-'));
delete process.env.DATABASE_URL;

let db: typeof import('../src/db');
let store: typeof import('../src/sessions/store');
let publish: typeof import('../src/deploy/publish');

before(async () => {
  db = await import('../src/db');
  store = await import('../src/sessions/store');
  publish = await import('../src/deploy/publish');
  await db.initDb();
});

const dep = (id: string, slug: string, expiresAt: number | null) =>
  ({ id, sessionId: null, projectId: null, slug, name: slug, kind: 'static', status: 'running', url: `/apps/${slug}/`, port: null, expiresAt } as any);

test('createDeployment persists + reads back expiresAt (24h preview TTL)', async () => {
  const exp = Date.now() + publish.PREVIEW_TTL_MS;
  const d = await store.createDeployment(dep('d-ttl', 'ttl-app', exp));
  assert.equal(d.expiresAt, exp);
  assert.equal((await store.getDeploymentBySlug('ttl-app'))?.expiresAt, exp);
});

test('sweepExpiredDeployments hard-deletes expired previews; keeps live + no-expiry ones', async () => {
  const now = Date.now();
  await store.createDeployment(dep('d-expired', 'expired-app', now - 1000));
  await store.createDeployment(dep('d-live', 'live-app', now + 3_600_000));
  await store.createDeployment(dep('d-perm', 'perm-app', null)); // legacy / no expiry

  const n = await publish.sweepExpiredDeployments(now);
  assert.ok(n >= 1);
  assert.equal(await store.getDeploymentBySlug('expired-app'), null, 'expired preview is deleted');
  assert.ok(await store.getDeploymentBySlug('live-app'), 'still-live preview is kept');
  assert.ok(await store.getDeploymentBySlug('perm-app'), 'a no-expiry deployment is never swept');
});
