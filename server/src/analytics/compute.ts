import { DAY_MS } from './track';

/**
 * Pure, unit-testable analytics aggregation. All inputs are plain rows (epoch-day
 * buckets); no DB, no date SQL — keeps SQLite+Postgres portable and the math testable.
 */

export interface ActivePoint {
  day: number; // epoch-day
  user_id: string | null;
}

const uniq = (xs: (string | null)[]): number => new Set(xs.filter(Boolean) as string[]).size;
const add = (m: Map<number, Set<string>>, k: number, v: string) => (m.get(k) ?? m.set(k, new Set()).get(k)!).add(v);

/** Per-day unique active users over [fromDay, toDay], gaps filled with 0. */
export function dailyActiveSeries(rows: ActivePoint[], fromDay: number, toDay: number): { day: number; count: number }[] {
  const byDay = new Map<number, Set<string>>();
  for (const r of rows) if (r.user_id && r.day >= fromDay && r.day <= toDay) add(byDay, r.day, r.user_id);
  const out: { day: number; count: number }[] = [];
  for (let d = fromDay; d <= toDay; d++) out.push({ day: d, count: byDay.get(d)?.size ?? 0 });
  return out;
}

/** DAU / WAU / MAU + stickiness (DAU/MAU) as of `nowDay`. */
export function engagement(rows: ActivePoint[], nowDay: number): { dau: number; wau: number; mau: number; stickiness: number } {
  const win = (lo: number) => uniq(rows.filter((r) => r.day > nowDay - lo && r.day <= nowDay).map((r) => r.user_id));
  const dau = uniq(rows.filter((r) => r.day === nowDay).map((r) => r.user_id));
  const mau = win(30);
  return { dau, wau: win(7), mau, stickiness: mau ? Math.round((dau / mau) * 1000) / 1000 : 0 };
}

/** Generic per-day numeric series (e.g. runs/day, cost/day), gaps filled with 0. */
export function dailySumSeries(rows: { day: number; value: number }[], fromDay: number, toDay: number): { day: number; value: number }[] {
  const byDay = new Map<number, number>();
  for (const r of rows) if (r.day >= fromDay && r.day <= toDay) byDay.set(r.day, (byDay.get(r.day) ?? 0) + r.value);
  const out: { day: number; value: number }[] = [];
  for (let d = fromDay; d <= toDay; d++) out.push({ day: d, value: Math.round((byDay.get(d) ?? 0) * 1e6) / 1e6 });
  return out;
}

/** Signup-cohort retention: for each weekly cohort, % active in week 0..N. */
export function cohortRetention(
  signups: { user_id: string; day: number }[],
  activity: ActivePoint[],
  nowDay: number,
  weeks = 8,
): { startTs: number; size: number; retained: number[] }[] {
  const weekOf = (day: number) => Math.floor(day / 7); // epoch-week
  const cohorts = new Map<number, Set<string>>();
  for (const s of signups) add(cohorts, weekOf(s.day), s.user_id);
  // user → set of weeks they were active
  const userWeeks = new Map<string, Set<number>>();
  for (const a of activity) if (a.user_id) (userWeeks.get(a.user_id) ?? userWeeks.set(a.user_id, new Set()).get(a.user_id)!).add(weekOf(a.day));
  const nowWeek = weekOf(nowDay);
  return [...cohorts.keys()]
    .sort((x, y) => y - x)
    .slice(0, weeks)
    .sort((x, y) => x - y)
    .map((cw) => {
      const users = [...cohorts.get(cw)!];
      const span = Math.min(nowWeek - cw, weeks - 1);
      const retained: number[] = [];
      for (let n = 0; n <= span; n++) {
        const active = users.filter((u) => userWeeks.get(u)?.has(cw + n)).length;
        retained.push(users.length ? Math.round((active / users.length) * 100) : 0);
      }
      return { startTs: cw * 7 * DAY_MS, size: users.length, retained };
    });
}

/** Ordered funnel stages → conversion % relative to the first stage. */
export function funnel(stages: { stage: string; count: number }[]): { stage: string; count: number; pct: number }[] {
  const top = stages[0]?.count || 0;
  return stages.map((s) => ({ ...s, pct: top ? Math.round((s.count / top) * 100) : 0 }));
}

const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

/** Median of a list (0 for empty). */
export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Activation: for each user who has built, ms from signup → their first build; + the median. */
export function timeToFirstBuild(
  signups: { user_id: string; ts: number }[],
  firstBuilds: { user_id: string; ts: number }[],
): { perUser: { user_id: string; ms: number }[]; medianMs: number; activated: number } {
  const first = new Map<string, number>();
  for (const b of firstBuilds) {
    const cur = first.get(b.user_id);
    if (cur == null || b.ts < cur) first.set(b.user_id, b.ts);
  }
  const perUser: { user_id: string; ms: number }[] = [];
  for (const s of signups) {
    const fb = first.get(s.user_id);
    if (fb == null) continue;
    perUser.push({ user_id: s.user_id, ms: Math.max(0, fb - s.ts) });
  }
  return { perUser, medianMs: median(perUser.map((p) => p.ms)), activated: perUser.length };
}

/** Cost-spike detector over a daily-cost series: recent window vs the trailing weekly
 *  average. Deliberately ignores tiny baselines (no history → no alert) to avoid noise. */
export function costSpike(
  dailyCost: { day: number; value: number }[],
  nowDay: number,
  opts: { recentDays?: number; baselineWeeks?: number; ratio?: number; minRecent?: number } = {},
): { spiked: boolean; recent: number; baseline: number; ratio: number } {
  const recentDays = opts.recentDays ?? 7;
  const baselineWeeks = opts.baselineWeeks ?? 3;
  const minRatio = opts.ratio ?? 2;
  const minRecent = opts.minRecent ?? 1;
  const sumRange = (loExcl: number, hiIncl: number) =>
    dailyCost.filter((d) => d.day > loExcl && d.day <= hiIncl).reduce((a, d) => a + d.value, 0);
  const recent = sumRange(nowDay - recentDays, nowDay);
  const baseline = sumRange(nowDay - recentDays - baselineWeeks * 7, nowDay - recentDays) / baselineWeeks; // avg weekly cost
  const ratio = baseline > 0 ? recent / baseline : 0;
  return {
    spiked: recent >= minRecent && baseline > 0 && ratio >= minRatio,
    recent: round4(recent),
    baseline: round4(baseline),
    ratio: baseline > 0 ? Math.round(ratio * 10) / 10 : 0,
  };
}

/** Churn-risk orgs: onboarded + once-active, but quiet for `inactiveDays`+. */
export function churnRisk(
  orgs: { id: string; name: string; onboarded: boolean; sessions: number; lastActive: number | null }[],
  nowMs: number,
  inactiveDays = 14,
): { id: string; name: string; lastActive: number | null; daysSince: number }[] {
  const cut = inactiveDays * DAY_MS;
  return orgs
    .filter((o) => o.onboarded && o.sessions > 0 && (o.lastActive == null || nowMs - o.lastActive > cut))
    .map((o) => ({ id: o.id, name: o.name, lastActive: o.lastActive, daysSince: o.lastActive ? Math.round((nowMs - o.lastActive) / DAY_MS) : 9999 }))
    .sort((a, b) => b.daysSince - a.daysSince);
}
