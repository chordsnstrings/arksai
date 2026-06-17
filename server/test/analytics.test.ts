import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { engagement, dailyActiveSeries, dailySumSeries, cohortRetention, funnel, type ActivePoint } from '../src/analytics/compute';

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
