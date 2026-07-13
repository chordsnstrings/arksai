import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeInsights, normalizeRow, sumRows, toSnapshotMetrics } from '../src/agent/social/insights';
import { buildReportHtml, reportObservations } from '../src/robots/socialReport';
import { computeNextRun } from '../src/schedule/scheduler';

// ---- insights normalisation ----
test('normalizeRow maps action_* → leads/conversions + derives rates', () => {
  const r = normalizeRow({
    campaign_name: 'Leads – UAE', impressions: 10_000, reach: 5_000, clicks: 200, spend: 100,
    'action_lead': 40, 'action_offsite_conversion.fb_pixel_purchase': 5, 'action_link_click': 200,
  });
  assert.equal(r.leads, 40);
  assert.equal(r.conversions, 5);
  assert.equal(r.results, 45);
  assert.equal(r.ctr, 2); // 200/10000 = 2%
  assert.equal(r.cpm, 10); // 100/10000*1000
  assert.equal(r.frequency, 2); // 10000/5000
  assert.equal(r.costPerResult, round(100 / 45));
});

test('normalizeInsights rolls up a total across campaigns', () => {
  const { total } = normalizeInsights([
    { campaign_name: 'A', impressions: 1000, reach: 800, clicks: 20, spend: 10, 'action_lead': 4 },
    { campaign_name: 'B', impressions: 3000, reach: 2000, clicks: 30, spend: 20, 'action_lead': 2, 'action_purchase': 1 },
  ]);
  assert.equal(total.spend, 30);
  assert.equal(total.impressions, 4000);
  assert.equal(total.leads, 6);
  assert.equal(total.conversions, 1);
  assert.equal(total.results, 7);
  assert.deepEqual(Object.keys(toSnapshotMetrics(total)).sort(), ['clicks','conversions','costPerResult','cpc','cpm','ctr','impressions','leads','reach','results','spend'].sort());
});

test('sumRows handles an empty account', () => {
  const t = sumRows([]);
  assert.equal(t.spend, 0);
  assert.equal(t.results, 0);
  assert.equal(t.costPerResult, null);
});

// ---- observations ----
test('reportObservations flags best value + weak CTR + frequency', () => {
  const campaigns = [
    normalizeRow({ campaign_name: 'Good', impressions: 5000, clicks: 200, spend: 50, 'action_lead': 25 }),
    normalizeRow({ campaign_name: 'Weak', impressions: 4000, clicks: 8, spend: 40, 'action_lead': 1 }),
  ];
  const total = sumRows(campaigns);
  const obs = reportObservations(total, campaigns, [{ metric: 'results', deltaPct: 12 }]);
  assert.ok(obs.some((o) => /Best value/.test(o)));
  assert.ok(obs.some((o) => /CTR under/.test(o)));
  assert.ok(obs.some((o) => /Results up 12%/.test(o)));
});

// ---- report HTML ----
test('buildReportHtml embeds the real numbers + a per-campaign table', () => {
  const campaigns = [normalizeRow({ campaign_name: 'Leads – UAE', impressions: 10000, reach: 5000, clicks: 200, spend: 100, 'action_lead': 40 })];
  const html = buildReportHtml({
    robotName: 'Social Manager', accountName: 'Acme Ads', periodLabel: 'Last 7 days',
    since: '2026-07-01', until: '2026-07-08', total: sumRows(campaigns), campaigns,
    deltas: [{ metric: 'spend', value: 100, deltaPct: 5 }],
  });
  assert.match(html, /Acme Ads/);
  assert.match(html, /Leads – UAE/);
  assert.match(html, /\$100/); // spend KPI
  assert.match(html, /Cost \/ result/);
  assert.match(html, /<table>/);
});

// ---- monthly cadence ----
test('computeNextRun: monthly advances to the same day next month', () => {
  const from = new Date(2026, 0, 15, 10, 0, 0); // Jan 15, 10:00 local
  const next = new Date(computeNextRun(from, 'monthly', '09:00', null, null, null));
  // 09:00 on the 15th already passed today → next month, the 15th.
  assert.equal(next.getMonth(), 1); // Feb
  assert.equal(next.getDate(), 15);
  assert.equal(next.getHours(), 9);
  // A day-of-month via `weekday` (overloaded) is honoured + clamped to 28.
  const dom = new Date(computeNextRun(new Date(2026, 0, 1, 8, 0, 0), 'monthly', '09:00', 31, null, null));
  assert.equal(dom.getDate(), 28);
});

function round(n: number): number { return Math.round(n * 100) / 100; }

// ---- Reports over any channel (Telegram/email) + on-demand report command ----

test('reportWindow: daily/weekly/monthly windows with human labels', async () => {
  const { reportWindow } = await import('../src/robots/socialReport');
  const now = Date.UTC(2026, 5, 30); // fixed clock
  assert.deepEqual(reportWindow('daily', now).label, 'Yesterday');
  assert.deepEqual(reportWindow('weekly', now).label, 'Last 7 days');
  assert.deepEqual(reportWindow('monthly', now).label, 'Last 30 days');
  assert.equal(reportWindow(undefined, now).label, 'Last 7 days'); // default
  // window widens with the period; all end yesterday.
  const w = reportWindow('monthly', now), d = reportWindow('daily', now);
  assert.equal(w.until, d.until);
  assert.ok(w.since < d.since, 'monthly reaches further back');
});

test('toReportTargets: bare emails map to email channel; ReportTargets ride through; blanks dropped', async () => {
  const { toReportTargets } = await import('../src/robots/socialReport');
  assert.deepEqual(toReportTargets(['a@x.com', '', '  ']), [{ channel: 'email', address: 'a@x.com' }]);
  assert.deepEqual(
    toReportTargets(['a@x.com', { channel: 'telegram', address: '12345' }]),
    [{ channel: 'email', address: 'a@x.com' }, { channel: 'telegram', address: '12345' }],
  );
});

test('buildReportSummaryText: a plain-text KPI glance for chat channels', async () => {
  const { buildReportSummaryText } = await import('../src/robots/socialReport');
  const total = { name: 'All', impressions: 90000, reach: 60000, clicks: 900, spend: 300, ctr: 1, cpc: 0.33, cpm: 3.3, frequency: 1.5, leads: 20, conversions: 0, results: 20, costPerResult: 15 };
  const txt = buildReportSummaryText({
    accountName: 'Acme', periodLabel: 'Last 7 days', since: '2026-06-23', until: '2026-06-29',
    total, deltas: [{ metric: 'spend', deltaPct: 12 }], campaigns: [total],
  });
  assert.match(txt, /Acme — Last 7 days/);
  assert.match(txt, /Spend: \$300 \(▲12%\)/);
  assert.match(txt, /\$15\/result/);
  assert.match(txt, /Full PDF attached/);
});

test('report command: REPORT_RE catches requests but NOT "build a report dashboard"', async () => {
  const { REPORT_RE, reportPeriodFromText } = await import('../src/robots/tasks');
  for (const yes of ['send me the report', 'show me this month\'s numbers', 'how are the ads doing?', 'get me the ad performance report', 'this week\'s ad results']) {
    assert.ok(REPORT_RE.test(yes), `should match: "${yes}"`);
  }
  for (const no of ['build a report dashboard', 'make me a website', 'create an ad for my shop', 'design a report template']) {
    assert.ok(!REPORT_RE.test(no), `should NOT match: "${no}"`);
  }
  assert.equal(reportPeriodFromText('send this month\'s report'), 'monthly');
  assert.equal(reportPeriodFromText('yesterday\'s numbers'), 'daily');
  assert.equal(reportPeriodFromText('how are the ads doing'), 'weekly');
});
