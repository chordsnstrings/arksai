import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeNextRun } from '../src/schedule/scheduler';

test('interval: next run is from + interval (floored at 5 min)', () => {
  const from = new Date('2026-06-14T10:00:00');
  assert.equal(computeNextRun(from, 'interval', null, null, 3_600_000), from.getTime() + 3_600_000);
  // below the floor → clamped to 5 min
  assert.equal(computeNextRun(from, 'interval', null, null, 1000), from.getTime() + 5 * 60_000);
});

test('daily: today if the time is still ahead, else tomorrow', () => {
  const morning = new Date('2026-06-14T08:00:00');
  const at9 = computeNextRun(morning, 'daily', '09:00', null, null);
  assert.equal(new Date(at9).getHours(), 9);
  assert.equal(new Date(at9).getDate(), 14); // same day

  const evening = new Date('2026-06-14T22:00:00');
  const next = computeNextRun(evening, 'daily', '09:00', null, null);
  assert.equal(new Date(next).getDate(), 15); // rolled to tomorrow
});

test('weekly: advances to the target weekday', () => {
  // 2026-06-14 is a Sunday (getDay()===0)
  const sun = new Date('2026-06-14T12:00:00');
  const mon = computeNextRun(sun, 'weekly', '09:00', 1, null); // Monday
  assert.equal(new Date(mon).getDay(), 1);
  assert.equal(new Date(mon).getDate(), 15);
});

test('weekly: same weekday but time passed → next week', () => {
  const sun = new Date('2026-06-14T12:00:00'); // Sunday noon
  const next = computeNextRun(sun, 'weekly', '09:00', 0, null); // Sunday 09:00 already passed
  assert.equal(new Date(next).getDay(), 0);
  assert.equal(new Date(next).getDate(), 21); // a week later
});

test('next run is always strictly in the future', () => {
  const now = new Date();
  for (const c of ['daily', 'weekly', 'interval'] as const) {
    const n = computeNextRun(now, c, '09:00', 3, 3_600_000);
    assert.ok(n > now.getTime(), `${c} should be in the future`);
  }
});
