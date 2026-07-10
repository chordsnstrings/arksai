import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-camp-opt-'));
delete process.env.DATABASE_URL;

let S: typeof import('../src/robots/socialCampaigns');
before(async () => {
  const db = await import('../src/db');
  await db.initDb();
  S = await import('../src/robots/socialCampaigns');
});

const ad = (adId: string, over: Partial<import('../src/robots/socialCampaigns').AdMetrics> = {}) => ({
  adId, spend: 20, impressions: 5000, ctr: 1.2, frequency: 2, results: 10, costPerResult: 2, ...over,
});

test('significance gate: low-spend/low-impression ads are never judged', async () => {
  const d = S.decideOptimizations([
    ad('a', { spend: 1, impressions: 100, ctr: 0.1, results: 0, costPerResult: null }), // learning — untouched
    ad('b', { spend: 2, impressions: 400, ctr: 0.05, results: 0, costPerResult: null }),
  ]);
  assert.equal(d.pause.length, 0);
  assert.equal(d.rotate, false);
  assert.match(d.notes[0], /below the significance floor/);
});

test('losers pause on cost/result vs the best (2.5×), and pausing implies rotation', async () => {
  const d = S.decideOptimizations([
    ad('winner', { costPerResult: 2, results: 10 }),
    ad('ok', { costPerResult: 4, results: 5 }),
    ad('loser', { costPerResult: 9, results: 2 }),
  ]);
  assert.deepEqual(d.pause.map((p) => p.adId), ['loser']);
  assert.match(d.pause[0].reason, /cost\/result \$9 vs best \$2/);
  assert.equal(d.rotate, true);
});

test('no-results campaigns: only a CTR collapse vs a working sibling pauses', async () => {
  const collapse = S.decideOptimizations([
    ad('good', { results: 0, costPerResult: null, ctr: 1.4 }),
    ad('dead', { results: 0, costPerResult: null, ctr: 0.2 }),
  ]);
  assert.deepEqual(collapse.pause.map((p) => p.adId), ['dead']);
  // Both mediocre → no panic pausing.
  const meh = S.decideOptimizations([
    ad('m1', { results: 0, costPerResult: null, ctr: 0.6 }),
    ad('m2', { results: 0, costPerResult: null, ctr: 0.5 }),
  ]);
  assert.equal(meh.pause.length, 0);
});

test('fatigue triggers rotation without pausing; a campaign is never emptied', async () => {
  const fatigue = S.decideOptimizations([ad('tired', { frequency: 4.2, ctr: 0.6 })]);
  assert.equal(fatigue.pause.length, 0);
  assert.equal(fatigue.rotate, true);
  assert.match(fatigue.notes.join(' '), /fatigued/);
  // A single catastrophic ad still can't be paused into an empty campaign.
  const solo = S.decideOptimizations([
    ad('only-bad', { costPerResult: 50 }),
    ad('other-bad', { costPerResult: 60 }),
  ]);
  assert.ok(solo.pause.length < 2); // best is kept by the 2.5× rule + never-empty backstop
});

test('healthy campaign → no changes', async () => {
  const d = S.decideOptimizations([ad('a'), ad('b', { costPerResult: 2.5 })]);
  assert.equal(d.pause.length, 0);
  assert.equal(d.rotate, false);
});

test('optimizeCampaign: lost connection pauses the campaign honestly (no creds in this org)', async () => {
  const { randomUUID } = await import('node:crypto');
  const rec = await S.createCampaignRecord({
    orgId: `org-${randomUUID()}`, name: 'Orphan', objective: 'leads', status: 'active',
  });
  const summary = await S.optimizeCampaign((await S.getCampaignRecord(rec.id))!, Date.now());
  assert.match(summary, /connection lost/);
});
