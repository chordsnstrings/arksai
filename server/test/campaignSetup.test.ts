import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-camp-setup-'));
delete process.env.DATABASE_URL;

import { createCampaignRequest } from '../src/connectors/metaCampaigns';

let S: typeof import('../src/robots/socialCampaigns');
before(async () => {
  const db = await import('../src/db');
  await db.initDb();
  S = await import('../src/robots/socialCampaigns');
});

// ---- pure planners ----
test('detectSpecialAdCategories from the brief text', async () => {
  assert.deepEqual(S.detectSpecialAdCategories({ product: 'Marina apartment rentals', topics: ['2BR views'] }), ['HOUSING']);
  assert.deepEqual(S.detectSpecialAdCategories({ product: 'Hiring: sales careers', topics: [] }), ['EMPLOYMENT']);
  assert.deepEqual(S.detectSpecialAdCategories({ product: 'Personal loan refinancing', topics: [] }), ['CREDIT']);
  assert.deepEqual(S.detectSpecialAdCategories({ product: 'FreshCrate veg boxes', topics: ['delivery'] }), []);
});

test('resolveObjectivePlan: leads/messages/traffic + honest sales degrade', async () => {
  const leads = S.resolveObjectivePlan('leads', undefined);
  assert.equal(leads.optimizationGoal, 'LEAD_GENERATION');
  assert.equal(leads.needsLeadForm, true);

  const msgs = S.resolveObjectivePlan('messages', 'instagram_direct');
  assert.equal(msgs.destinationType, 'INSTAGRAM_DIRECT');
  assert.equal(msgs.cta, 'MESSAGE_PAGE');

  // sales + URL, no pixel → degraded to traffic WITH a note.
  const salesUrl = S.resolveObjectivePlan('sales', 'https://acme.ae/shop');
  assert.equal(salesUrl.objective, 'traffic');
  assert.match(salesUrl.degradeNote!, /Pixel/);
  // sales without URL → degraded to leads.
  const salesNoUrl = S.resolveObjectivePlan('sales', undefined);
  assert.equal(salesNoUrl.objective, 'leads');
  // with a pixel → real sales optimisation.
  assert.equal(S.resolveObjectivePlan('sales', 'https://acme.ae', true).objective, 'sales');
});

test('adSetCountFor: learning-phase-aware split', async () => {
  assert.equal(S.adSetCountFor(10), 1);
  assert.equal(S.adSetCountFor(14), 2);
  assert.equal(S.adSetCountFor(50), 2);
});

test('validateCampaignInput catches the launch-blocking mistakes', async () => {
  const ok = S.validateCampaignInput({ brief: { product: 'X', topics: [] }, objective: 'leads', budgetModel: 'daily', budgetUsd: 20 });
  assert.deepEqual(ok, []);
  const bad = S.validateCampaignInput({ brief: { product: '', topics: [] }, objective: 'traffic', budgetModel: 'lifetime', budgetUsd: 10 });
  assert.ok(bad.some((e) => /promoting/.test(e)));
  assert.ok(bad.some((e) => /duration/.test(e)));
  assert.ok(bad.some((e) => /website URL/.test(e))); // traffic needs a URL
  // Lifetime spread too thin → below the healthy daily floor.
  const thin = S.validateCampaignInput({ brief: { product: 'X', topics: [] }, objective: 'leads', budgetModel: 'lifetime', budgetUsd: 10, durationDays: 30 });
  assert.ok(thin.some((e) => /minimum/.test(e)));
});

test('CBO campaign builder: daily vs lifetime + stop_time', () => {
  const daily = createCampaignRequest('1', { name: 'C', objective: 'leads', dailyBudgetUsd: 25 });
  assert.equal(daily.body.daily_budget, 2500);
  assert.equal(daily.body.status, 'PAUSED');
  const life = createCampaignRequest('1', { name: 'C', objective: 'traffic', lifetimeBudgetUsd: 300, stopTimeSec: 1_900_000_000 });
  assert.equal(life.body.lifetime_budget, 30000);
  assert.equal(life.body.stop_time, 1_900_000_000);
  assert.equal(life.body.daily_budget, undefined);
});

// ---- setup loop early-return paths (no Meta egress) ----
test('setupManagedCampaign: validation + cap + missing-connector guards fire before any spend', async () => {
  const orgId = `org-${randomUUID()}`;
  const base = {
    orgId, name: 'Test', objective: 'leads' as const, budgetModel: 'daily' as const,
    autonomyLevel: 85, adDailyCapUsd: 20,
  };
  // Invalid brief → named fixes.
  const bad = await S.setupManagedCampaign({ ...base, brief: { product: '', topics: [] }, budgetUsd: 0 }, '/tmp');
  assert.equal(bad.ok, false);
  assert.match(bad.detail, /Fix before launch/);
  // Over the hard cap → blocked with the cap named.
  const over = await S.setupManagedCampaign({ ...base, brief: { product: 'X', topics: [] }, budgetUsd: 50 }, '/tmp');
  assert.equal(over.ok, false);
  assert.match(over.detail, /exceeds the robot's \$20\/day cap/);
  // No connected ad account → honest connect message (nothing created).
  const noConn = await S.setupManagedCampaign({ ...base, brief: { product: 'X', topics: [] }, budgetUsd: 15 }, '/tmp');
  assert.equal(noConn.ok, false);
  assert.match(noConn.detail, /No Meta ad account/);
});

test('launch/pause guards on unknown campaigns', async () => {
  assert.equal((await S.launchManagedCampaign('nope', 'me')).ok, false);
  assert.equal((await S.pauseManagedCampaign('nope', 'r')).ok, false);
});
