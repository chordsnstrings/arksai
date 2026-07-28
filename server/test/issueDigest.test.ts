import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Throwaway SQLite DB, set BEFORE any import.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-issues-'));
process.env.APP_PASSWORD = 'test-operator';
delete process.env.DATABASE_URL;
delete process.env.MINIMAX_API_KEY; // no model → deterministic digest only

let db: typeof import('../src/db');
let store: typeof import('../src/sessions/store');
let track: typeof import('../src/analytics/track');
let digest: typeof import('../src/selfheal/issueDigest');

before(async () => {
  db = await import('../src/db');
  await db.initDb();
  store = await import('../src/sessions/store');
  track = await import('../src/analytics/track');
  digest = await import('../src/selfheal/issueDigest');
});

test('generateIssueDigest: detects failed runs + user complaints across tenants, ranked & redacted', async () => {
  const now = Date.now();

  // Two tenants hit the SAME failure class (code-mode app failing the verify gate).
  for (const org of ['org-A', 'org-B']) {
    const s = await store.createSession({ mode: 'code', model: 'arksai-max', orgId: org } as any);
    await store.appendTimeline(s.id, { kind: 'system', id: `e-${org}`, text: 'verify gate failed: typecheck error in App.tsx', ts: now } as any);
    // The analytics event is what the digest reads for a failed run (metadata only).
    track.track('run_finished', { orgId: org, sessionId: s.id, props: { status: 'error', mode: 'code', deliverable: 'app' } });
  }

  // A third tenant's user complains after an output — with an email that must be REDACTED.
  const c = await store.createSession({ mode: 'chat', model: 'arksai-max', orgId: 'org-C' } as any);
  await store.appendTimeline(c.id, { kind: 'assistant', id: 'a1', text: "here's your thing", ts: now } as any);
  await store.appendTimeline(c.id, { kind: 'user', id: 'u1', text: "this doesn't work, email me at kamran@arks.ai", ts: now } as any);

  // track() is fire-and-forget → let the inserts settle before generating.
  await new Promise((r) => setTimeout(r, 60));

  const summary = await digest.generateIssueDigest(now + 1000);
  assert.ok(summary.runErrors >= 2, `expected ≥2 failed runs, got ${summary.runErrors}`);
  assert.ok(summary.complaints >= 1, `expected ≥1 complaint, got ${summary.complaints}`);
  assert.ok(summary.clusters >= 2, 'at least the verify-gate cluster + the complaint cluster');

  const [latest] = await digest.listIssueDigests();
  assert.ok(latest, 'digest stored + listable');
  const top = latest.clusters[0];
  assert.equal(top.kind, 'run_error'); // 2 tenants failing > 1 complaint → ranked first
  assert.equal(top.remediation, 'code');
  assert.equal(top.errorClass, 'verification');
  assert.equal(top.orgs, 2, 'cross-tenant count');
  // Redaction held: no raw email anywhere in the stored digest.
  assert.doesNotMatch(JSON.stringify(latest), /kamran@arks\.ai/);
});

test('formatIssueDigest: readable brief; all-clear when nothing surfaced', () => {
  const empty = digest.formatIssueDigest(
    { windowHours: 24, runErrors: 0, complaints: 0, clusters: 0, affectedOrgs: 0, scannedSessions: 3, truncated: false, topRemediation: null },
    [],
  );
  assert.match(empty, /All clear/i);
});
