import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Throwaway SQLite DB + a known operator password, set BEFORE any import.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-redteam-'));
process.env.APP_PASSWORD = 'test-operator';
delete process.env.DATABASE_URL;

let app: any;
let store: typeof import('../src/sessions/store');
let orgs: typeof import('../src/orgs/store');
let sched: typeof import('../src/schedule/scheduler');

const cookieOf = (res: any, name: string): string => {
  const raw = res.headers['set-cookie'];
  const arr = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const hit = arr.find((c: string) => c.startsWith(name + '='));
  return hit ? hit.split(';')[0] : '';
};
const items = (res: any): any[] => {
  const b = res.json();
  if (Array.isArray(b)) return b;
  return b.sessions || b.projects || b.commands || b.schedules || b.deployments || b.memory || [];
};

let cookieA = '';
let cookieB = '';
let orgAId = '';
let userAId = '';
let sessA: any;
let projA: any;

before(async () => {
  const db = await import('../src/db');
  store = await import('../src/sessions/store');
  orgs = await import('../src/orgs/store');
  sched = await import('../src/schedule/scheduler');
  await db.initDb();
  await orgs.bootstrapOrgs();
  const appMod = await import('../src/app');
  app = await appMod.buildApp();
  await app.ready();

  // Operator (super-admin) logs in.
  const op = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'test-operator' } });
  const opCookie = cookieOf(op, 'arksai_auth');
  assert.ok(opCookie, 'operator login set a cookie');

  // Operator provisions two orgs, each with an admin invite.
  const mkOrg = async (name: string, email: string) => {
    const r = await app.inject({ method: 'POST', url: '/api/admin/orgs', headers: { cookie: opCookie }, payload: { name, adminEmail: email } });
    const body = r.json();
    const token = String(body.adminInviteLink).split('/invite/')[1];
    const acc = await app.inject({ method: 'POST', url: '/api/invites/accept', payload: { token, password: 'pw-123456' } });
    return { orgId: body.org.id, cookie: cookieOf(acc, 'arksai_sess'), userId: acc.json().user.id };
  };
  const a = await mkOrg('Org A', 'admin@orga.com');
  const b = await mkOrg('Org B', 'admin@orgb.com');
  orgAId = a.orgId;
  userAId = a.userId;
  cookieA = a.cookie;
  cookieB = b.cookie;
  assert.ok(cookieA && cookieB && cookieA !== cookieB, 'two distinct user sessions');

  // Seed ORG A's private data directly (fast + deterministic).
  sessA = await store.createSession({ repoUrl: null, repoName: null, branch: null, mode: 'chat', model: 'arksai-auto', projectId: null, orgId: orgAId, createdBy: userAId } as any);
  await store.updateSession(sessA.id, { title: 'A CONFIDENTIAL chat' });
  projA = await store.createProject({ name: 'A secret project', instructions: '', defaultRepoUrl: null, defaultBranch: null, defaultMode: null, defaultModel: null, branding: null, orgId: orgAId, ownerUserId: userAId } as any);
  await store.upsertCommand(orgAId, 'secret-cmd', 'A only', 'do the A secret');
  await sched.createSchedule({ label: 'A nightly report', prompt: 'secret prompt A', mode: 'code', model: 'arksai-auto', cadence: 'daily', at: '09:00' } as any, orgAId);
  await store.createDeployment({ id: 'dep-a', sessionId: sessA.id, projectId: null, slug: 'orga-secret-app', name: 'A App', kind: 'static', status: 'live', url: '/apps/orga-secret-app/', port: null, orgId: orgAId } as any);
  await store.addMemory(orgs.orgScope(orgAId), 'A confidential memory');
});

test('positive control: org A sees its OWN data', async () => {
  const h = { cookie: cookieA };
  assert.ok(items(await app.inject({ url: '/api/sessions', headers: h })).some((s) => s.id === sessA.id));
  assert.equal((await app.inject({ url: `/api/sessions/${sessA.id}`, headers: h })).statusCode, 200);
  assert.ok(items(await app.inject({ url: '/api/projects', headers: h })).some((p) => p.id === projA.id));
  assert.ok(items(await app.inject({ url: '/api/commands', headers: h })).some((c) => c.name === 'secret-cmd'));
  assert.ok(items(await app.inject({ url: '/api/schedules', headers: h })).some((s) => s.label === 'A nightly report'));
  assert.ok(items(await app.inject({ url: '/api/deployments', headers: h })).some((d) => d.slug === 'orga-secret-app'));
});

test('RED TEAM: org B cannot reach org A data on any route', async () => {
  const h = { cookie: cookieB };

  // lists never include A's data
  assert.ok(!items(await app.inject({ url: '/api/sessions', headers: h })).some((s) => s.id === sessA.id), 'sessions list leak');
  assert.ok(!items(await app.inject({ url: '/api/projects', headers: h })).some((p) => p.id === projA.id), 'projects list leak');
  assert.ok(!items(await app.inject({ url: '/api/commands', headers: h })).some((c) => c.name === 'secret-cmd'), 'commands list leak');
  assert.ok(!items(await app.inject({ url: '/api/schedules', headers: h })).some((s) => s.label === 'A nightly report'), 'schedules list leak');
  assert.ok(!items(await app.inject({ url: '/api/deployments', headers: h })).some((d) => d.slug === 'orga-secret-app'), 'deployments list leak');
  assert.ok(!items(await app.inject({ url: '/api/memory', headers: h })).some((m: any) => String(m.text).includes('A confidential memory')), 'memory leak');

  // direct-by-id / slug access → 404 or blocked
  assert.equal((await app.inject({ url: `/api/sessions/${sessA.id}`, headers: h })).statusCode, 404, 'session by id leak');
  assert.equal((await app.inject({ url: `/api/sessions/${sessA.id}/events`, headers: h })).statusCode, 404, 'session events leak');
  assert.equal((await app.inject({ url: `/api/sessions/${sessA.id}/tree`, headers: h })).statusCode, 404, 'session tree leak');
  assert.equal((await app.inject({ url: `/api/projects/${projA.id}`, headers: h })).statusCode, 404, 'project by id leak');
  assert.equal((await app.inject({ method: 'POST', url: '/api/deployments/orga-secret-app/stop', headers: h })).statusCode, 404, 'deployment stop leak');
  assert.equal((await app.inject({ method: 'DELETE', url: '/api/deployments/orga-secret-app', headers: h })).statusCode, 404, 'deployment delete leak');

  // destructive cross-org writes must be no-ops (A's data survives)
  await app.inject({ method: 'DELETE', url: `/api/sessions/${sessA.id}`, headers: h }); // expect 404 + no delete
  assert.equal((await app.inject({ url: `/api/sessions/${sessA.id}`, headers: { cookie: cookieA } })).statusCode, 200, 'B deleted A session');
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/projects/${projA.id}`, headers: h, payload: { name: 'HACKED' } })).statusCode, 404, 'B patched A project');
  // A's schedule survives B's enable/delete attempts (find its id as A, then attack as B)
  const aSched = items(await app.inject({ url: '/api/schedules', headers: { cookie: cookieA } })).find((s) => s.label === 'A nightly report');
  await app.inject({ method: 'PATCH', url: `/api/schedules/${aSched.id}`, headers: h, payload: { enabled: false } });
  await app.inject({ method: 'DELETE', url: `/api/schedules/${aSched.id}`, headers: h });
  const stillThere = items(await app.inject({ url: '/api/schedules', headers: { cookie: cookieA } })).find((s) => s.id === aSched.id);
  assert.ok(stillThere && stillThere.enabled === true, 'B disabled/deleted A schedule');
});
