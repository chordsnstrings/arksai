import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Throwaway SQLite DB set BEFORE any config read / dynamic import (the analyticsQueries
// pattern) — this suite exercises the REAL store SQL, not just the pure math.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-msnap-'));
delete process.env.DATABASE_URL;

let M: typeof import('../src/agent/metricSnapshots');
let tools: typeof import('../src/agent/tools/metrics');

const ctx = (orgId: string | null): any => ({
  session: { id: 'sess-1', orgId },
  repoDir: '/tmp',
  mode: 'report',
  signal: new AbortController().signal,
  addCost: () => {},
});

before(async () => {
  const db = await import('../src/db');
  await db.initDb();
  M = await import('../src/agent/metricSnapshots');
  tools = await import('../src/agent/tools/metrics');
});

test('metric snapshots: record → like-for-like deltas → restatement surfaced, org-scoped', async () => {
  // First period — no prior.
  const r1 = await tools.recordMetricsTool.run(
    { series: 'Monthly Revenue', period: '2024-01', metrics: { Revenue: 100000, Orders: 250 } },
    ctx('org-a'),
  );
  assert.match(r1, /First recorded period/);
  assert.equal((await M.listSnapshots('org-a', 'monthly revenue')).length, 1, 'series name normalized');

  // Second period — deltas vs 2024-01; a NEW metric is flagged, not zero-compared.
  const r2 = await tools.recordMetricsTool.run(
    { series: 'monthly-revenue', period: '2024-02', metrics: { Revenue: 112000, Orders: 240, AOV: 466.67 } },
    ctx('org-a'),
  );
  assert.match(r2, /Vs 2024-01/);
  assert.match(r2, /Revenue: 112,000 — \+12,000 \(\+12%\)/);
  assert.match(r2, /Orders: 240 — -10 \(-4%\)/);
  assert.match(r2, /AOV: 466\.67 — NEW metric/);

  // Restatement — re-record 2024-01 with a changed value: prior kept + diff returned.
  const r3 = await tools.recordMetricsTool.run(
    { series: 'monthly-revenue', period: '2024-01', metrics: { Revenue: 98500, Orders: 250 } },
    ctx('org-a'),
  );
  assert.match(r3, /RESTATEMENT/);
  assert.match(r3, /Revenue: 100,000 → 98,500/);
  assert.doesNotMatch(r3, /Orders: 250 →/, 'unchanged metric not in the restatement diff');

  // History reads the restated value, shows the deltas AND the restatement marker.
  const h = await tools.metricHistoryTool.run({ series: 'monthly-revenue' }, ctx('org-a'));
  assert.match(h, /2 period\(s\)/);
  assert.match(h, /Revenue: 98,500/);
  assert.match(h, /⚠ restated .*Revenue 100,000 → 98,500/);
  assert.match(h, /missing is NOT zero/);

  // Identical re-record is NOT a restatement.
  const r4 = await tools.recordMetricsTool.run(
    { series: 'monthly-revenue', period: '2024-01', metrics: { Revenue: 98500, Orders: 250 } },
    ctx('org-a'),
  );
  assert.doesNotMatch(r4, /RESTATEMENT/);

  // Org isolation: org-b sees nothing.
  const other = await tools.metricHistoryTool.run({ series: 'monthly-revenue' }, ctx('org-b'));
  assert.match(other, /No snapshots for series/);
  const list = await tools.metricHistoryTool.run({}, ctx('org-b'));
  assert.match(list, /No metric series recorded yet/);

  // Series listing + single-metric filter + unknown-metric honesty.
  const listA = await tools.metricHistoryTool.run({}, ctx('org-a'));
  assert.match(listA, /monthly-revenue: 2 period\(s\), latest 2024-02/);
  const one = await tools.metricHistoryTool.run({ series: 'monthly-revenue', metric: 'revenue' }, ctx('org-a'));
  assert.match(one, /Revenue: 112,000/);
  assert.doesNotMatch(one, /Orders:/);
  const miss = await tools.metricHistoryTool.run({ series: 'monthly-revenue', metric: 'Churn' }, ctx('org-a'));
  assert.match(miss, /metrics on record: Revenue, Orders, AOV/);
});

test('pure math: computeSeriesDeltas is like-for-like; sanitize drops junk', () => {
  const snap = (period: string, metrics: Record<string, number>): any => ({
    id: period, orgId: '', series: 's', period, metrics, note: null, sessionId: null,
    restatedFrom: null, restatedAt: null, createdAt: 0, updatedAt: 0,
  });
  const deltas = M.computeSeriesDeltas([
    snap('2024-01', { Revenue: 100, Churn: 5 }),
    snap('2024-02', { Revenue: 110 }), // Churn missing — NOT compared as zero
    snap('2024-03', { Revenue: 99, Churn: 4 }), // Churn reappears → isNew (no prior-period value)
  ]);
  const feb = deltas.find((d) => d.period === '2024-02' && d.metric === 'Revenue')!;
  assert.equal(feb.delta, 10);
  assert.equal(feb.deltaPct, 10);
  const marChurn = deltas.find((d) => d.period === '2024-03' && d.metric === 'Churn')!;
  assert.equal(marChurn.delta, null, 'no like-for-like prior — delta is null, not vs zero');
  assert.ok(marChurn.isNew);
  assert.equal(deltas.filter((d) => d.period === '2024-02').length, 1, 'missing Churn emits no row');

  const s = M.sanitizeMetrics({ Revenue: '1,200.50', Orders: 10, Bad: 'n/a', '': 5, Inf: Infinity });
  assert.deepEqual(s.metrics, { Revenue: 1200.5, Orders: 10 });
  assert.deepEqual(s.dropped.sort(), ['Bad', 'Inf']);
});
