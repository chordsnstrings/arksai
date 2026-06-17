import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { engagement, dailyActiveSeries, dailySumSeries, cohortRetention, funnel, median, timeToFirstBuild, costSpike, churnRisk, type ActivePoint } from '../src/analytics/compute';

const D = 20000; // an arbitrary epoch-day baseline

test('engagement: DAU/WAU/MAU + stickiness from active points', () => {
  const rows: ActivePoint[] = [
    { user_id: 'a', day: D },
    { user_id: 'b', day: D },
    { user_id: 'a', day: D - 3 },
    { user_id: 'c', day: D - 10 },
    { user_id: 'd', day: D - 40 },
  ];
  const e = engagement(rows, D);
  assert.equal(e.dau, 2); // a, b today
  assert.equal(e.wau, 2); // a, b in last 7d
  assert.equal(e.mau, 3); // a, b, c in last 30d (d is 40d ago)
  assert.equal(e.stickiness, Math.round((2 / 3) * 1000) / 1000);
});

test('dailyActiveSeries fills gaps with 0 and dedupes users per day', () => {
  const rows: ActivePoint[] = [
    { user_id: 'a', day: D },
    { user_id: 'a', day: D },
    { user_id: 'b', day: D },
    { user_id: 'a', day: D - 2 },
  ];
  assert.deepEqual(dailyActiveSeries(rows, D - 2, D).map((x) => x.count), [1, 0, 2]);
});

test('dailySumSeries sums per day, gaps 0', () => {
  const s = dailySumSeries([{ day: D, value: 2 }, { day: D, value: 3 }, { day: D - 1, value: 0 }], D - 1, D);
  assert.deepEqual(s.map((x) => x.value), [0, 5]);
});

test('cohortRetention: week 0 is 100%, week 1 reflects returners', () => {
  const signups = [{ user_id: 'a', day: D }, { user_id: 'b', day: D }];
  const activity: ActivePoint[] = [
    { user_id: 'a', day: D },
    { user_id: 'b', day: D },
    { user_id: 'a', day: D + 7 }, // only a returns the next week
  ];
  const grid = cohortRetention(signups, activity, D + 7, 8);
  assert.equal(grid.length, 1);
  assert.equal(grid[0].size, 2);
  assert.equal(grid[0].retained[0], 100);
  assert.equal(grid[0].retained[1], 50);
});

test('funnel: conversion % relative to the first stage', () => {
  const f = funnel([{ stage: 'leads', count: 100 }, { stage: 'signup', count: 40 }, { stage: 'built', count: 10 }]);
  assert.deepEqual(f.map((s) => s.pct), [100, 40, 10]);
});

test('median: odd + even lengths', () => {
  assert.equal(median([]), 0);
  assert.equal(median([5]), 5);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
});

test('timeToFirstBuild: per-user delta from signup to first build + median', () => {
  const HOUR = 3_600_000;
  const signups = [
    { user_id: 'a', ts: 1_000_000 },
    { user_id: 'b', ts: 2_000_000 },
    { user_id: 'c', ts: 3_000_000 }, // never builds → excluded
  ];
  const builds = [
    { user_id: 'a', ts: 1_000_000 + 2 * HOUR },
    { user_id: 'a', ts: 1_000_000 + 5 * HOUR }, // later build ignored (min wins)
    { user_id: 'b', ts: 2_000_000 + 4 * HOUR },
  ];
  const r = timeToFirstBuild(signups, builds);
  assert.equal(r.activated, 2);
  assert.deepEqual(r.perUser.find((p) => p.user_id === 'a')?.ms, 2 * HOUR);
  assert.equal(r.medianMs, 3 * HOUR); // median of [2h, 4h]
});

test('costSpike: flags a recent surge over the trailing weekly baseline; ignores tiny/no history', () => {
  const now = 100;
  // baseline weeks (days now-28..now-7) ~ small; recent (now-7..now) large
  const series: { day: number; value: number }[] = [];
  for (let d = now - 27; d <= now - 7; d++) series.push({ day: d, value: 1 }); // ~21 over 3 weeks → 7/wk
  for (let d = now - 6; d <= now; d++) series.push({ day: d, value: 10 }); // 70 recent
  const s = costSpike(series, now);
  assert.equal(s.spiked, true);
  assert.ok(s.ratio >= 2);
  // no history → never alerts (avoids noise)
  const fresh = costSpike([{ day: now, value: 999 }], now);
  assert.equal(fresh.spiked, false);
});

test('churnRisk: onboarded once-active orgs gone quiet are flagged; active ones are not', () => {
  const now = 100 * 86_400_000;
  const rows = [
    { id: '1', name: 'Quiet', onboarded: true, sessions: 5, lastActive: now - 20 * 86_400_000 },
    { id: '2', name: 'Active', onboarded: true, sessions: 5, lastActive: now - 2 * 86_400_000 },
    { id: '3', name: 'NeverBuilt', onboarded: true, sessions: 0, lastActive: null },
  ];
  const risk = churnRisk(rows, now);
  assert.deepEqual(risk.map((r) => r.name), ['Quiet']);
  assert.equal(risk[0].daysSince, 20);
});

test('PRIVACY: analytics code never reads conversation/document content', () => {
  const dir = path.join(process.cwd(), 'src/analytics');
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.ts')) continue;
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    // Flag ACTUAL content reads (a query against the timeline table or the store
    // content getters) — not prose comments that merely mention "timeline".
    assert.doesNotMatch(src, /from\s+timeline|getTimeline|getContext|\.context\b/i, `${f} must not read message/document content`);
  }
});
