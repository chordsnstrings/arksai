import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Throwaway SQLite DB, set BEFORE any config read / dynamic import. This suite runs the
// REAL aggregation SQL against SQLite so it catches placeholder/portability bugs that the
// pure compute tests cannot (e.g. reusing `$1` under-supplies params on the SQLite driver).
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-anq-'));
delete process.env.DATABASE_URL;

let db: typeof import('../src/db');
let A: typeof import('../src/analytics/queries');

const OP: { orgId: string | null } = { orgId: null };
const now = Date.now();
const DAY = 86_400_000;

before(async () => {
  db = await import('../src/db');
  A = await import('../src/analytics/queries');
  const orgs = await import('../src/orgs/store');
  await db.initDb();
  await orgs.bootstrapOrgs();

  const org = (id: string, name: string) => db.q(`INSERT INTO orgs(id,name,slug,created_at) VALUES($1,$2,$3,$4)`, [id, name, id, now - 40 * DAY]);
  const user = (id: string, email: string) => db.q(`INSERT INTO users(id,email,created_at) VALUES($1,$2,$3)`, [id, email, now - 35 * DAY]);
  const mem = (uid: string, oid: string, role = 'member') => db.q(`INSERT INTO memberships(id,user_id,org_id,role,created_at) VALUES($1,$2,$3,$4,$5)`, [`${uid}-${oid}`, uid, oid, role, now]);
  const sess = (id: string, oid: string, uid: string, mode: string, model: string, task: string | null, status: string, cost: number, at: number) =>
    db.q(
      `INSERT INTO sessions(id,title,mode,model,status,task,cost_usd,total_tokens,org_id,created_by,created_at,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [id, `S ${id}`, mode, model, status, task, cost, 1000, oid, uid, at, at],
    );

  await org('orgA', 'Org A');
  await org('orgB', 'Org B');
  await user('uA', 'a@orga.com');
  await user('uB', 'b@orgb.com');
  await mem('uA', 'orgA', 'admin');
  await mem('uB', 'orgB', 'admin');
  await db.q(`INSERT INTO org_profiles(org_id,onboarding_complete,created_at,updated_at) VALUES($1,$2,$3,$4)`, ['orgA', 1, now, now]);
  await db.q(`INSERT INTO leads(id,email,created_at) VALUES($1,$2,$3)`, ['l1', 'lead@x.com', now]);
  await db.q(
    `INSERT INTO deployments(id,slug,name,kind,status,url,org_id,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    ['d1', 'app-a', 'App A', 'static', 'running', '/apps/app-a/', 'orgA', now, now],
  );
  // orgA: 3 sessions; orgB: 1 session.
  await sess('a1', 'orgA', 'uA', 'code', 'arksai-auto', 'finance.cashflow', 'done', 0.5, now - 2 * DAY);
  await sess('a2', 'orgA', 'uA', 'report', 'arksai-max', 'bi.adhoc', 'error', 0.2, now - 1 * DAY);
  await sess('a3', 'orgA', 'uA', 'code', 'arksai-auto', 'finance.cashflow', 'done', 0.3, now);
  await sess('b1', 'orgB', 'uB', 'chat', 'deepseek-v4-pro', null, 'done', 0.1, now);
  // analytics events (login activity).
  await db.q(
    `INSERT INTO analytics_events(id,ts,day,event,org_id,user_id,session_id,props,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    ['e1', now, Math.floor(now / DAY), 'app_open', 'orgA', 'uA', null, '{}', now],
  );
});

// Every function must run against SQLite without throwing, for BOTH the operator (cross-org)
// scope and a per-org scope — the exact matrix that surfaced the usersTable `$1`-reuse 500.
test('every analytics query runs in both scopes without throwing', async () => {
  for (const scope of [OP, { orgId: 'orgA' }]) {
    await A.overview(scope);
    await A.timeseries(scope, 30);
    await A.usage(scope, 30);
    await A.quality(scope, 30);
    await A.cost(scope, 30);
    await A.retention(scope);
    await A.funnelData(scope);
    await A.usersTable(scope); // ← reused-placeholder regression guard
    await A.alerts(scope);
    await A.userDetail(scope, 'uA');
  }
  await A.orgsTable();
});

test('overview reports a numeric median time-to-first-build per scope', async () => {
  const op = await A.overview(OP);
  assert.equal(typeof op.timeToFirstBuildMs, 'number');
  assert.ok((op.activatedUsers ?? 0) >= 2, 'uA and uB both built');
});

test('userDetail: metadata only, scoped, and per-org membership-gated', async () => {
  const op = await A.userDetail(OP, 'uA');
  assert.ok(op);
  assert.equal(op!.email, 'a@orga.com');
  assert.equal(op!.sessions, 3);
  assert.ok(Array.isArray(op!.byMode) && Array.isArray(op!.plays) && Array.isArray(op!.activity));
  assert.ok((op as any).orgs, 'operator view lists the user orgs');
  // no content fields ever
  for (const k of ['context', 'timeline', 'messages', 'prompt']) assert.ok(!(k in op!), `leaked ${k}`);

  // per-org sees only its own sessions for that member …
  const inA = await A.userDetail({ orgId: 'orgA' }, 'uA');
  assert.equal(inA!.sessions, 3);
  // … and a non-member of the org → null (404), never another org's data.
  assert.equal(await A.userDetail({ orgId: 'orgB' }, 'uA'), null);
});

test('alerts: operator flags churn + cost spikes; per-org returns its own shape', async () => {
  const op: any = await A.alerts(OP);
  assert.ok(Array.isArray(op.churnRisk) && Array.isArray(op.costSpikes));
  const perOrg: any = await A.alerts({ orgId: 'orgA' });
  assert.ok(perOrg.costSpike && Array.isArray(perOrg.inactiveMembers));
});

test('operator overview aggregates across orgs; per-org isolates', async () => {
  const op = await A.overview(OP);
  assert.equal(op.sessions30d, 4, 'operator sees all 4 sessions');
  assert.ok((op.totalOrgs ?? 0) >= 3, 'default + orgA + orgB');
  assert.equal(op.leads, 1);

  const a = await A.overview({ orgId: 'orgA' });
  assert.equal(a.sessions30d, 3, 'orgA sees only its 3 sessions, never orgB');
  assert.equal(a.members, 1);
  assert.equal(a.liveDeployments, 1);
});

test('per-org usersTable returns only that org members with usage metadata', async () => {
  const rows = await A.usersTable({ orgId: 'orgA' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].email, 'a@orga.com');
  assert.equal(rows[0].sessions, 3);
  // metadata only — no content fields ever
  assert.ok(!('context' in rows[0]) && !('timeline' in rows[0]));
});

test('usage adoption reflects the seeded mode/model/play split per scope', async () => {
  const a = await A.usage({ orgId: 'orgA' }, 30);
  const modes = Object.fromEntries(a.modes.map((m: any) => [m.key, m.count]));
  assert.equal(modes.code, 2);
  assert.equal(modes.report, 1);
  const plays = Object.fromEntries(a.plays.map((p: any) => [p.key, p.count]));
  assert.equal(plays['finance.cashflow'], 2);
});
