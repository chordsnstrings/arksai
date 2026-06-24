import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Throwaway SQLite DB, set BEFORE any config read / dynamic import.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-fb-'));
delete process.env.DATABASE_URL;

let db: typeof import('../src/db');
let F: typeof import('../src/feedback/store');

before(async () => {
  db = await import('../src/db');
  F = await import('../src/feedback/store');
  await db.initDb();
});

test('recordFeedback + listFeedback round-trips; complaint kept only for down', async () => {
  await F.recordFeedback('orgA', 's1', { kind: 'app', rating: 'down', complaint: 'the mobile menu does not open' });
  await F.recordFeedback('orgA', 's2', { kind: 'deliverable', rating: 'up', complaint: 'ignored on up' });
  const list = await F.listFeedback({ orgId: 'orgA' });
  assert.equal(list.length, 2);
  const down = list.find((f) => f.rating === 'down')!;
  assert.match(down.complaint!, /mobile menu/);
  const up = list.find((f) => f.rating === 'up')!;
  assert.equal(up.complaint, null); // complaint is dropped for a thumbs-up
});

test('meta is allowlisted — arbitrary/content keys never persist', async () => {
  const fb = await F.recordFeedback('orgA', 's3', {
    kind: 'app',
    rating: 'down',
    complaint: 'x',
    meta: { deliverableKind: 'app', name: 'GIC', secretContent: 'the whole private document text', timeline: 'leak' } as any,
  });
  assert.deepEqual(fb.meta, { deliverableKind: 'app', name: 'GIC' });
  assert.equal((fb.meta as any).secretContent, undefined);
  assert.equal((fb.meta as any).timeline, undefined);
});

test('org scoping: an org sees only its own; the operator (orgId:null) sees all', async () => {
  await F.recordFeedback('orgB', 's9', { kind: 'reply', rating: 'down', complaint: 'org B only' });
  const a = await F.listFeedback({ orgId: 'orgA' });
  const b = await F.listFeedback({ orgId: 'orgB' });
  const op = await F.listFeedback({ orgId: null });
  assert.ok(a.every((f) => f.orgId === 'orgA'));
  assert.ok(b.every((f) => f.orgId === 'orgB'));
  assert.ok(!a.some((f) => f.orgId === 'orgB')); // no cross-org leak
  assert.ok(op.length >= a.length + b.length); // operator sees the whole platform
});

test('setFeedbackStatus is org-guarded — org B cannot touch org A row', async () => {
  const [row] = await F.listFeedback({ orgId: 'orgA' });
  await F.setFeedbackStatus(row.id, 'dismissed', { orgId: 'orgB' }); // wrong org → no-op
  let still = (await F.listFeedback({ orgId: 'orgA' })).find((f) => f.id === row.id)!;
  assert.notEqual(still.status, 'dismissed');
  await F.setFeedbackStatus(row.id, 'reviewed', { orgId: 'orgA' }); // right org → applies
  still = (await F.listFeedback({ orgId: 'orgA' })).find((f) => f.id === row.id)!;
  assert.equal(still.status, 'reviewed');
});

test('summary counts up/down + open complaints', async () => {
  const s = await F.feedbackSummary({ orgId: null });
  assert.ok(s.up >= 1 && s.down >= 1);
  assert.ok(s.openComplaints >= 1);
});
