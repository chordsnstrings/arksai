import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-robots-'));
process.env.ENCRYPTION_KEY = 'test-key-robots';
delete process.env.DATABASE_URL;

let db: typeof import('../src/db');
let store: typeof import('../src/robots/store');
let reply: typeof import('../src/robots/reply');

before(async () => {
  db = await import('../src/db');
  store = await import('../src/robots/store');
  reply = await import('../src/robots/reply');
  await db.initDb();
  const orgs = await import('../src/orgs/store');
  await orgs.bootstrapOrgs();
});

test('create / list / update / delete a robot (org-scoped)', async () => {
  const r = await store.createRobot('o1', { name: 'Support', role: 'customer_service', model: 'compare' });
  assert.equal(r.role, 'customer_service');
  assert.equal(r.status, 'draft');
  assert.equal(r.autonomy, 'ask'); // safe default
  assert.equal(r.model, 'compare');

  // Cross-org read is denied (not found).
  assert.equal(await store.getRobot(r.id, 'other-org'), null);
  assert.ok(await store.getRobot(r.id, 'o1'));

  const upd = await store.updateRobot(r.id, 'o1', { status: 'active', config: { knowledge: 'We ship in 3 days.' } });
  assert.equal(upd?.status, 'active');
  assert.equal(upd?.config.knowledge, 'We ship in 3 days.');

  const active = await store.listActiveRobots();
  assert.ok(active.find((x) => x.id === r.id));

  await store.deleteRobot(r.id, 'o1');
  assert.equal(await store.getRobot(r.id, 'o1'), null);
});

test('draft is idempotent per inbound message id and locks the recipient', async () => {
  const r = await store.createRobot('o1', { name: 'CS', role: 'customer_service' });
  const d = await store.createDraft({
    robotId: r.id, orgId: 'o1', inboundMessageId: '<abc@mail>',
    inboundFrom: 'cust@x.com', inboundName: 'Cust', inboundSubject: 'Help', inboundSnippet: 'hi',
    toAddr: 'cust@x.com', subject: 'Re: Help', draftText: 'Sure!', modelUsed: 'arksai-max (M3)',
  });
  assert.equal(d.toAddr, 'cust@x.com');
  assert.equal(d.status, 'pending');
  assert.equal(await store.draftExistsFor(r.id, '<abc@mail>'), true);
  assert.equal(await store.draftExistsFor(r.id, '<nope@mail>'), false);

  assert.equal(await store.countPendingDrafts('o1'), 1);
  await store.markDraftStatus(d.id, 'o1', 'sent', Date.now());
  assert.equal(await store.countPendingDrafts('o1'), 0);
});

test('an escalated draft is stored as escalated, not pending', async () => {
  const r = await store.createRobot('o1', { name: 'CS2', role: 'customer_service' });
  const d = await store.createDraft({
    robotId: r.id, orgId: 'o1', inboundMessageId: '<esc@mail>',
    inboundFrom: 'angry@x.com', inboundName: null, inboundSubject: 'Refund', inboundSnippet: 'I want my money back',
    toAddr: 'angry@x.com', subject: 'Re: Refund', draftText: '', modelUsed: 'arksai-max (M3)',
    escalated: true, escalationReason: 'refund request',
  });
  assert.equal(d.status, 'escalated');
  assert.equal(d.escalated, true);
});

test('buildSystem injects persona/knowledge/escalation + locks the recipient + demands JSON', () => {
  const robot: any = {
    id: 'x', orgId: 'o1', name: 'CS', role: 'customer_service', status: 'active', autonomy: 'ask',
    model: 'arksai-max', lastPolledAt: null, createdAt: 0, updatedAt: 0,
    config: { persona: 'Warm and brief', knowledge: 'We ship in 3 days', escalateOn: 'refunds', signature: '— Acme' },
  };
  const sys = reply.buildSystem(robot);
  assert.match(sys, /Warm and brief/);
  assert.match(sys, /We ship in 3 days/);
  assert.match(sys, /refunds/);
  assert.match(sys, /only to the original sender/i);
  assert.match(sys, /STRICT JSON/);
  assert.match(sys, /— Acme/);
});

test('buildSystem folds a department persona into a specialist (custom + dept)', () => {
  const robot: any = {
    id: 'x', orgId: 'o1', name: 'Finance Agent', role: 'custom', status: 'active', autonomy: 'ask',
    model: 'arksai-max', lastPolledAt: null, createdAt: 0, updatedAt: 0, mailboxReady: true,
    config: { dept: 'finance', mandate: 'Keep the model current', persona: 'Keep the model current' },
  };
  const sys = reply.buildSystem(robot);
  assert.match(sys, /DOMAIN EXPERTISE \(finance\)/);
  assert.match(sys, /FP&A/); // the finance persona text
  // A plain customer_service robot has no department fold.
  const cs: any = { ...robot, role: 'customer_service', config: { knowledge: 'x' } };
  assert.doesNotMatch(reply.buildSystem(cs), /DOMAIN EXPERTISE/);
});

test('a newly created robot is mailbox-less until one is connected', async () => {
  const r = await store.createRobot('o1', { name: 'NeedsBox', role: 'customer_service' });
  const fetched = await store.getRobot(r.id, 'o1');
  assert.equal(fetched?.mailboxReady, false);
});

test('parseReplyJson handles clean JSON, fenced JSON, and bare prose', () => {
  const a = reply.parseReplyJson('{"escalate": false, "reason": "", "reply": "Hello there"}');
  assert.equal(a?.escalate, false);
  assert.equal(a?.text, 'Hello there');

  const b = reply.parseReplyJson('```json\n{"escalate": true, "reason": "refund", "reply": ""}\n```');
  assert.equal(b?.escalate, true);
  assert.equal(b?.reason, 'refund');

  const c = reply.parseReplyJson('Here is the reply: thanks for reaching out!');
  assert.equal(c?.escalate, false);
  assert.match(c?.text || '', /thanks for reaching out/);
});
