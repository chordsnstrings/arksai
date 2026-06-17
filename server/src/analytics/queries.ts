import { q } from '../db';
import { DAY_MS, epochDay } from './track';
import {
  type ActivePoint,
  cohortRetention,
  dailyActiveSeries,
  dailySumSeries,
  engagement,
  funnel,
} from './compute';

/**
 * Analytics aggregation. METADATA ONLY — these queries select counts, timestamps,
 * status, mode, model, task (the play key), tokens and cost; they NEVER touch the
 * `timeline` table or any message/document content. `scope.orgId === null` = the whole
 * platform (operator); a non-null orgId restricts every query to that org.
 */
export type Scope = { orgId: string | null };

const num = (v: any): number => Number(v ?? 0);
const cutoffMs = (days: number) => Date.now() - days * DAY_MS;
const today = () => epochDay(Date.now());

/** Active-user signal = analytics events (login/runs) UNION session activity (created
 *  or updated that day) — so retention/DAU work from existing data, richer as events grow. */
async function activePoints(scope: Scope, sinceDays: number): Promise<ActivePoint[]> {
  const c = cutoffMs(sinceDays);
  const ev: any[] = scope.orgId
    ? await q(`SELECT user_id, day FROM analytics_events WHERE ts >= $1 AND org_id = $2 AND user_id IS NOT NULL`, [c, scope.orgId])
    : await q(`SELECT user_id, day FROM analytics_events WHERE ts >= $1 AND user_id IS NOT NULL`, [c]);
  const ss: any[] = scope.orgId
    ? await q(`SELECT created_by, created_at, updated_at FROM sessions WHERE updated_at >= $1 AND org_id = $2 AND created_by IS NOT NULL`, [c, scope.orgId])
    : await q(`SELECT created_by, created_at, updated_at FROM sessions WHERE updated_at >= $1 AND created_by IS NOT NULL`, [c]);
  const pts: ActivePoint[] = ev.map((r) => ({ user_id: r.user_id, day: num(r.day) }));
  for (const r of ss) {
    pts.push({ user_id: r.created_by, day: epochDay(num(r.updated_at)) });
    pts.push({ user_id: r.created_by, day: epochDay(num(r.created_at)) });
  }
  return pts;
}

/** Headline KPIs. */
export async function overview(scope: Scope) {
  const pts30 = await activePoints(scope, 30);
  const eng = engagement(pts30, today());
  // counts via portable COUNT/SUM with epoch cutoffs
  const org = scope.orgId;
  const w = (i: number) => (org ? ` AND org_id = $${i}` : '');
  const oarg = (base: any[]) => (org ? [...base, org] : base);
  const sessions7 = num((await qScalar(`SELECT COUNT(*) c FROM sessions WHERE created_at >= $1${w(2)}`, oarg([cutoffMs(7)]))));
  const sessions30 = num((await qScalar(`SELECT COUNT(*) c FROM sessions WHERE created_at >= $1${w(2)}`, oarg([cutoffMs(30)]))));
  const cost7 = num((await qScalar(`SELECT COALESCE(SUM(cost_usd),0) c FROM sessions WHERE updated_at >= $1${w(2)}`, oarg([cutoffMs(7)]))));
  const cost30 = num((await qScalar(`SELECT COALESCE(SUM(cost_usd),0) c FROM sessions WHERE updated_at >= $1${w(2)}`, oarg([cutoffMs(30)]))));
  const done = num((await qScalar(`SELECT COUNT(*) c FROM sessions WHERE status = 'done' AND updated_at >= $1${w(2)}`, oarg([cutoffMs(30)]))));
  const errored = num((await qScalar(`SELECT COUNT(*) c FROM sessions WHERE status = 'error' AND updated_at >= $1${w(2)}`, oarg([cutoffMs(30)]))));
  const liveDeploys = num((await qScalar(`SELECT COUNT(*) c FROM deployments WHERE status = 'running'${org ? ' AND org_id = $1' : ''}`, org ? [org] : [])));
  const result: Record<string, number> = {
    activeUsers7d: eng.wau,
    activeUsers30d: eng.mau,
    dau: eng.dau,
    stickiness: eng.stickiness,
    sessions7d: sessions7,
    sessions30d: sessions30,
    cost7d: Math.round(cost7 * 1e4) / 1e4,
    cost30d: Math.round(cost30 * 1e4) / 1e4,
    successRate: done + errored ? Math.round((done / (done + errored)) * 100) : 100,
    liveDeployments: liveDeploys,
  };
  if (!org) {
    result.totalOrgs = num(await qScalar(`SELECT COUNT(*) c FROM orgs`, []));
    result.totalUsers = num(await qScalar(`SELECT COUNT(*) c FROM users`, []));
    result.onboardedOrgs = num(await qScalar(`SELECT COUNT(*) c FROM org_profiles WHERE onboarding_complete = 1`, []));
    result.leads = num(await qScalar(`SELECT COUNT(*) c FROM leads`, []));
  } else {
    result.members = num(await qScalar(`SELECT COUNT(*) c FROM memberships WHERE org_id = $1`, [org]));
  }
  return result;
}

/** DAU series + runs/day + cost/day over `days`. */
export async function timeseries(scope: Scope, days: number) {
  const from = today() - days + 1;
  const to = today();
  const pts = await activePoints(scope, days);
  const org = scope.orgId;
  const runs: any[] = org
    ? await q(`SELECT created_at, cost_usd FROM sessions WHERE created_at >= $1 AND org_id = $2`, [cutoffMs(days), org])
    : await q(`SELECT created_at, cost_usd FROM sessions WHERE created_at >= $1`, [cutoffMs(days)]);
  const runRows = runs.map((r) => ({ day: epochDay(num(r.created_at)), value: 1 }));
  const costRows = runs.map((r) => ({ day: epochDay(num(r.created_at)), value: num(r.cost_usd) }));
  return {
    activeUsers: dailyActiveSeries(pts, from, to),
    sessions: dailySumSeries(runRows, from, to),
    cost: dailySumSeries(costRows, from, to),
  };
}

/** Feature adoption + mode/model split. */
export async function usage(scope: Scope, days: number) {
  const org = scope.orgId;
  const w = org ? ' AND org_id = $2' : '';
  const a = (b: any[]) => (org ? [...b, org] : b);
  const group = (col: string) => q(`SELECT ${col} k, COUNT(*) c FROM sessions WHERE created_at >= $1${w} GROUP BY ${col} ORDER BY c DESC`, a([cutoffMs(days)]));
  const clean = (rows: any[]) => rows.filter((r) => r.k != null).map((r) => ({ key: String(r.k), count: num(r.c) }));
  return {
    modes: clean(await group('mode')),
    models: clean(await group('model')),
    plays: clean(await group('task')).slice(0, 20), // task = the department.play key
  };
}

/** Success vs error over time + totals. */
export async function quality(scope: Scope, days: number) {
  const org = scope.orgId;
  const rows: any[] = org
    ? await q(`SELECT status, COUNT(*) c FROM sessions WHERE updated_at >= $1 AND org_id = $2 GROUP BY status`, [cutoffMs(days), org])
    : await q(`SELECT status, COUNT(*) c FROM sessions WHERE updated_at >= $1 GROUP BY status`, [cutoffMs(days)]);
  return rows.map((r) => ({ status: String(r.status ?? 'unknown'), count: num(r.c) }));
}

/** Cost over time + by model (+ top orgs for the operator). */
export async function cost(scope: Scope, days: number) {
  const org = scope.orgId;
  const byModel: any[] = org
    ? await q(`SELECT model k, COALESCE(SUM(cost_usd),0) c FROM sessions WHERE updated_at >= $1 AND org_id = $2 GROUP BY model ORDER BY c DESC`, [cutoffMs(days), org])
    : await q(`SELECT model k, COALESCE(SUM(cost_usd),0) c FROM sessions WHERE updated_at >= $1 GROUP BY model ORDER BY c DESC`, [cutoffMs(days)]);
  const out: any = { byModel: byModel.map((r) => ({ key: String(r.k ?? '—'), value: Math.round(num(r.c) * 1e4) / 1e4 })) };
  if (!org) {
    const top: any[] = await q(
      `SELECT o.name k, COALESCE(SUM(s.cost_usd),0) c FROM sessions s JOIN orgs o ON o.id = s.org_id WHERE s.updated_at >= $1 GROUP BY o.name ORDER BY c DESC LIMIT 10`,
      [cutoffMs(days)],
    );
    out.topOrgs = top.map((r) => ({ key: String(r.k), value: Math.round(num(r.c) * 1e4) / 1e4 }));
  }
  return out;
}

/** Operator: per-org table (named drill-down, metadata only). */
export async function orgsTable() {
  const rows: any[] = await q(
    `SELECT o.id, o.name, o.created_at,
            (SELECT COUNT(*) FROM memberships m WHERE m.org_id = o.id) members,
            (SELECT COUNT(*) FROM sessions s WHERE s.org_id = o.id) sessions,
            (SELECT COALESCE(SUM(s.cost_usd),0) FROM sessions s WHERE s.org_id = o.id) cost,
            (SELECT MAX(s.updated_at) FROM sessions s WHERE s.org_id = o.id) last_active,
            (SELECT onboarding_complete FROM org_profiles p WHERE p.org_id = o.id) onboarded
       FROM orgs o ORDER BY last_active DESC NULLS LAST`,
  ).catch(async () =>
    // SQLite lacks NULLS LAST in some builds → fall back to a plain order.
    q(`SELECT o.id, o.name, o.created_at,
            (SELECT COUNT(*) FROM memberships m WHERE m.org_id = o.id) members,
            (SELECT COUNT(*) FROM sessions s WHERE s.org_id = o.id) sessions,
            (SELECT COALESCE(SUM(s.cost_usd),0) FROM sessions s WHERE s.org_id = o.id) cost,
            (SELECT MAX(s.updated_at) FROM sessions s WHERE s.org_id = o.id) last_active,
            (SELECT onboarding_complete FROM org_profiles p WHERE p.org_id = o.id) onboarded
       FROM orgs o`),
  );
  return rows
    .map((r) => ({
      id: r.id,
      name: r.name,
      createdAt: num(r.created_at),
      members: num(r.members),
      sessions: num(r.sessions),
      cost: Math.round(num(r.cost) * 1e4) / 1e4,
      lastActive: r.last_active ? num(r.last_active) : null,
      onboarded: !!num(r.onboarded),
    }))
    .sort((a, b) => (b.lastActive ?? 0) - (a.lastActive ?? 0));
}

/** Per-user table within a scope (operator = all; per-org = that org's members). */
export async function usersTable(scope: Scope) {
  const org = scope.orgId;
  const rows: any[] = org
    ? await q(
        // NOTE: each placeholder must be distinct + have its own value — the SQLite
        // driver rewrites every `$N` to a positional `?`, so reusing `$1` would
        // under-supply params. Placeholders are numbered in textual order.
        `SELECT u.id, u.email, u.created_at,
                (SELECT COUNT(*) FROM sessions s WHERE s.created_by = u.id AND s.org_id = $1) sessions,
                (SELECT COALESCE(SUM(s.cost_usd),0) FROM sessions s WHERE s.created_by = u.id AND s.org_id = $2) cost,
                (SELECT MAX(s.updated_at) FROM sessions s WHERE s.created_by = u.id AND s.org_id = $3) last_active
           FROM users u JOIN memberships m ON m.user_id = u.id AND m.org_id = $4`,
        [org, org, org, org],
      )
    : await q(
        `SELECT u.id, u.email, u.created_at,
                (SELECT COUNT(*) FROM sessions s WHERE s.created_by = u.id) sessions,
                (SELECT COALESCE(SUM(s.cost_usd),0) FROM sessions s WHERE s.created_by = u.id) cost,
                (SELECT MAX(s.updated_at) FROM sessions s WHERE s.created_by = u.id) last_active
           FROM users u`,
      );
  return rows
    .map((r) => ({ id: r.id, email: r.email, createdAt: num(r.created_at), sessions: num(r.sessions), cost: Math.round(num(r.cost) * 1e4) / 1e4, lastActive: r.last_active ? num(r.last_active) : null }))
    .sort((a, b) => (b.lastActive ?? 0) - (a.lastActive ?? 0));
}

/** Signup-cohort retention grid. */
export async function retention(scope: Scope) {
  const org = scope.orgId;
  const signupRows: any[] = org
    ? await q(`SELECT u.id, u.created_at FROM users u JOIN memberships m ON m.user_id = u.id AND m.org_id = $1`, [org])
    : await q(`SELECT id, created_at FROM users`, []);
  const signups = signupRows.map((r) => ({ user_id: r.id, day: epochDay(num(r.created_at)) }));
  const activity = await activePoints(scope, 365);
  return cohortRetention(signups, activity, today(), 8);
}

/** Activation/acquisition funnel (operator: platform; per-org: that org). */
export async function funnelData(scope: Scope) {
  const org = scope.orgId;
  if (org) {
    const members = num(await qScalar(`SELECT COUNT(*) c FROM memberships WHERE org_id = $1`, [org]));
    const onboarded = num(await qScalar(`SELECT onboarding_complete c FROM org_profiles WHERE org_id = $1`, [org]));
    const built = num(await qScalar(`SELECT COUNT(DISTINCT created_by) c FROM sessions WHERE org_id = $1`, [org]));
    const published = num(await qScalar(`SELECT COUNT(*) c FROM deployments WHERE org_id = $1`, [org]));
    return funnel([
      { stage: 'Members', count: members },
      { stage: 'Onboarded', count: onboarded ? members : 0 },
      { stage: 'Built something', count: built },
      { stage: 'Published', count: published > 0 ? built : 0 },
    ]);
  }
  const leads = num(await qScalar(`SELECT COUNT(*) c FROM leads`, []));
  const signups = num(await qScalar(`SELECT COUNT(*) c FROM users`, []));
  const onboarded = num(await qScalar(`SELECT COUNT(*) c FROM org_profiles WHERE onboarding_complete = 1`, []));
  const built = num(await qScalar(`SELECT COUNT(DISTINCT created_by) c FROM sessions`, []));
  const published = num(await qScalar(`SELECT COUNT(DISTINCT org_id) c FROM deployments`, []));
  return funnel([
    { stage: 'Leads', count: leads },
    { stage: 'Signed up', count: signups },
    { stage: 'Onboarded org', count: onboarded },
    { stage: 'Built something', count: built },
    { stage: 'Published', count: published },
  ]);
}

async function qScalar(sql: string, params: any[]): Promise<number> {
  const r: any = (await q(sql, params))[0];
  if (!r) return 0;
  const v = r.c ?? Object.values(r)[0];
  return Number(v ?? 0);
}
