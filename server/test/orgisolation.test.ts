import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Throwaway SQLite DB, set BEFORE any config read / dynamic import.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-orgiso-'));
delete process.env.DATABASE_URL;

let db: typeof import('../src/db');
let store: typeof import('../src/sessions/store');
let sched: typeof import('../src/schedule/scheduler');

before(async () => {
  db = await import('../src/db');
  store = await import('../src/sessions/store');
  sched = await import('../src/schedule/scheduler');
  const orgs = await import('../src/orgs/store');
  await db.initDb();
  await orgs.bootstrapOrgs();
});

const scopeFor = (orgId: string) => ({ orgId, userId: `u-${orgId}`, isSuperadmin: false });

test('schedules are isolated per org (list/disable/delete cannot cross orgs)', async () => {
  const a = await sched.createSchedule({ label: 'A daily', prompt: 'do A', mode: 'code', model: 'arksai-auto', cadence: 'daily', at: '09:00' } as any, 'orgA');
  const b = await sched.createSchedule({ label: 'B daily', prompt: 'do B', mode: 'code', model: 'arksai-auto', cadence: 'daily', at: '09:00' } as any, 'orgB');

  const listA = await sched.listSchedules(scopeFor('orgA'));
  assert.ok(listA.some((s) => s.id === a.id), 'org A sees its own schedule');
  assert.ok(!listA.some((s) => s.id === b.id), 'org A must NOT see org B schedule');

  // cross-org disable is a no-op
  await sched.setEnabled(b.id, false, scopeFor('orgA'));
  assert.equal((await sched.listSchedules(scopeFor('orgB'))).find((s) => s.id === b.id)?.enabled, true, 'org A must not disable org B schedule');

  // cross-org delete is a no-op
  await sched.deleteSchedule(b.id, scopeFor('orgA'));
  assert.ok((await sched.listSchedules(scopeFor('orgB'))).some((s) => s.id === b.id), 'org A must not delete org B schedule');

  // own-org delete works
  await sched.deleteSchedule(a.id, scopeFor('orgA'));
  assert.ok(!(await sched.listSchedules(scopeFor('orgA'))).some((s) => s.id === a.id));

  // the operator (super-admin / undefined scope) sees everything
  assert.ok((await sched.listSchedules(undefined)).some((s) => s.id === b.id));
});

test('deployments are isolated per org; public (unscoped) lookup still resolves', async () => {
  const now = Date.now();
  const ins = (id: string, slug: string, org: string) =>
    db.q(
      `INSERT INTO deployments(id,session_id,project_id,slug,name,kind,status,url,port,org_id,created_at,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [id, null, null, slug, slug, 'static', 'live', `/apps/${slug}/`, null, org, now, now],
    );
  await ins('d-a', 'app-a', 'orgA');
  await ins('d-b', 'app-b', 'orgB');

  const listA = await store.listDeployments(undefined, scopeFor('orgA'));
  assert.ok(listA.some((d) => d.slug === 'app-a'));
  assert.ok(!listA.some((d) => d.slug === 'app-b'), 'org A must NOT see org B deployments');

  // management lookup is org-scoped → cross-org resolves to null (→ 404 at the route)
  assert.equal(await store.getDeploymentBySlug('app-b', scopeFor('orgA')), null);
  assert.ok(await store.getDeploymentBySlug('app-a', scopeFor('orgA')));

  // the PUBLIC /apps/<slug>/ serving path passes no scope → still resolves (intended)
  assert.ok(await store.getDeploymentBySlug('app-b'));

  // createDeployment stamps the org → the owner can see + manage its OWN app
  await store.createDeployment({
    id: 'd-c', sessionId: null, projectId: null, slug: 'app-c', name: 'App C',
    kind: 'static', status: 'live', url: '/apps/app-c/', port: null, orgId: 'orgA',
  } as any);
  assert.ok((await store.listDeployments(undefined, scopeFor('orgA'))).some((d) => d.slug === 'app-c'), 'org A sees its own published app');
  assert.ok(await store.getDeploymentBySlug('app-c', scopeFor('orgA')), 'org A can manage its own app');
  assert.equal(await store.getDeploymentBySlug('app-c', scopeFor('orgB')), null, 'org B cannot reach org A app');
});
