import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pickAccountCost } from '../src/agent/social/history';
import { normalizeInsights } from '../src/agent/social/insights';
import type { NormalizedRow } from '../src/agent/social/insights';

/** Account-history cost basis — the "ingest last month, predict lead cost" engine. */

const row = (over: Partial<NormalizedRow>): NormalizedRow => ({
  name: 'All campaigns', impressions: 100_000, reach: 60_000, clicks: 1_200, spend: 300,
  ctr: 1.2, cpc: 0.25, cpm: 3, frequency: 1.7, leads: 0, conversions: 0, results: 0,
  costPerResult: null, ...over,
});

test('pickAccountCost: real lead history → observed CPL; sales fall back to purchases', () => {
  const leads = pickAccountCost(row({ leads: 20, spend: 300 }))!;
  assert.equal(leads.metric, 'lead');
  assert.equal(leads.costUsd, 15); // 300 / 20
  assert.equal(leads.n, 20);
  // No leads but real purchases → the sale basis.
  const sales = pickAccountCost(row({ conversions: 10, spend: 250 }))!;
  assert.equal(sales.metric, 'sale');
  assert.equal(sales.costUsd, 25);
  // Leads win over purchases when both exist (the campaign bot's main objective class).
  assert.equal(pickAccountCost(row({ leads: 5, conversions: 40, spend: 100 }))!.metric, 'lead');
});

test('pickAccountCost: honesty floors — thin data never fakes a prediction', () => {
  assert.equal(pickAccountCost(row({ leads: 2, spend: 300 })), null); // <3 results = noise
  assert.equal(pickAccountCost(row({ leads: 50, spend: 10 })), null); // <$20 spend = noise
  assert.equal(pickAccountCost(row({})), null); // spend but zero results
});

test('pickAccountCost composes with the real insights normaliser (raw Meta rows in)', () => {
  // Raw account-level rows as fetchReport flattens them (action_* columns).
  const { total } = normalizeInsights([
    { spend: '180', impressions: '90000', clicks: '900', action_lead: '12' } as any,
    { spend: '120', impressions: '60000', clicks: '500', 'action_onsite_conversion.lead_grouped': '8' } as any,
  ]);
  const cost = pickAccountCost(total)!;
  assert.equal(cost.metric, 'lead');
  assert.equal(cost.n, 20);
  assert.equal(cost.costUsd, 15); // $300 / 20 leads
});

test('classify-preview consults account history AFTER managed-campaign history (source lock)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/routes/robots.ts'), 'utf8');
  const managedIdx = src.indexOf('lastCprUsd');
  const accountIdx = src.indexOf('accountCostLast30d');
  assert.ok(managedIdx > 0 && accountIdx > managedIdx, 'managed-campaign history checked first');
  assert.match(src, /acct\.metric === profile\.prior\.metric/); // never cross-compare metric classes
  assert.match(src, /historySource/);
  // The fetch is cached + fail-soft (the route runs per keystroke-debounce).
  const hist = fs.readFileSync(path.join(__dirname, '../src/agent/social/history.ts'), 'utf8');
  assert.match(hist, /TTL_HIT_MS/);
  assert.match(hist, /catch \{/);
});
