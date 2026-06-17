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

const dayInTz = (ms: number, tz: string) =>
  new Intl.DateTimeFormat('en-US', { timeZone: tz, day: '2-digit' }).formatToParts(new Date(ms)).find((p) => p.type === 'day')!.value;

test('daily honors the schedule timezone, not the server', () => {
  // 07:00 in Dubai (UTC+4) → today's 09:00 Dubai run == 05:00 UTC (NOT 09:00 server-local).
  const from = new Date('2026-06-14T03:00:00Z');
  const next = computeNextRun(from, 'daily', '09:00', null, null, 'Asia/Dubai');
  assert.equal(new Date(next).getUTCHours(), 5);
  assert.equal(dayInTz(next, 'Asia/Dubai'), '14'); // same Dubai day
});

test('daily rolls to tomorrow in the schedule timezone once the time has passed', () => {
  const from = new Date('2026-06-14T07:00:00Z'); // 11:00 Dubai — past 09:00
  const next = computeNextRun(from, 'daily', '09:00', null, null, 'Asia/Dubai');
  assert.equal(new Date(next).getUTCHours(), 5); // 09:00 Dubai
  assert.equal(dayInTz(next, 'Asia/Dubai'), '15'); // tomorrow in Dubai
});

test('daily is DST-correct (offset applied per date) for America/New_York', () => {
  // Winter EST (UTC-5): 09:00 NY == 14:00 UTC
  const winter = computeNextRun(new Date('2026-01-15T00:00:00Z'), 'daily', '09:00', null, null, 'America/New_York');
  assert.equal(new Date(winter).getUTCHours(), 14);
  // Summer EDT (UTC-4): 09:00 NY == 13:00 UTC
  const summer = computeNextRun(new Date('2026-07-15T00:00:00Z'), 'daily', '09:00', null, null, 'America/New_York');
  assert.equal(new Date(summer).getUTCHours(), 13);
});

test('an invalid timezone falls back to the legacy path without throwing', () => {
  const from = new Date('2026-06-14T03:00:00Z');
  const n = computeNextRun(from, 'daily', '09:00', null, null, 'Not/AZone');
  assert.ok(n > from.getTime());
});
