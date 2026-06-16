import { randomUUID } from 'node:crypto';
import type { CreateScheduleRequest, Schedule, SessionMode } from '../../../shared/types';
import { SESSION_MODES, DEFAULT_MODEL, AUTO_MODEL } from '../../../shared/types';
import { q } from '../db';
import * as store from '../sessions/store';
import type { Scope } from '../sessions/store';

/** Any org-bound request (member OR the operator) is constrained to its current org;
 *  only internal callers (the scheduler tick, undefined scope) span every org. */
const isTenant = (s?: Scope): s is { orgId: string | null; userId: string; isSuperadmin: boolean } => !!s && s.orgId != null;
import { setupWorkspace } from '../sessions/workspace';
import { bus } from '../events/bus';
import * as manager from '../sessions/manager';

/**
 * Durable, server-side scheduler: tasks repeat on a cadence without the browser
 * open. Each fire spawns a fresh session (so each run is its own artifact +
 * history) and starts a run with the stored brief — reusing the normal run path.
 */

const TICK_MS = 60_000;
const MIN_INTERVAL_MS = 5 * 60_000; // floor for the 'interval' cadence

/** Next fire time (ms epoch) at/after `from`. Pure — unit-tested. */
export function computeNextRun(
  from: Date,
  cadence: Schedule['cadence'],
  at: string | null,
  weekday: number | null,
  intervalMs: number | null,
): number {
  if (cadence === 'interval') {
    return from.getTime() + Math.max(MIN_INTERVAL_MS, intervalMs ?? MIN_INTERVAL_MS);
  }
  const [hh, mm] = (at ?? '09:00').split(':').map((n) => parseInt(n, 10));
  const next = new Date(from);
  next.setSeconds(0, 0);
  next.setHours(Number.isFinite(hh) ? hh : 9, Number.isFinite(mm) ? mm : 0, 0, 0);
  if (cadence === 'daily') {
    if (next.getTime() <= from.getTime()) next.setDate(next.getDate() + 1);
    return next.getTime();
  }
  // weekly: advance to the target weekday (0–6), then to next week if already past.
  const target = ((weekday ?? 1) % 7 + 7) % 7;
  let delta = (target - next.getDay() + 7) % 7;
  if (delta === 0 && next.getTime() <= from.getTime()) delta = 7;
  next.setDate(next.getDate() + delta);
  return next.getTime();
}

function rowToSchedule(r: any): Schedule {
  return {
    id: r.id,
    label: r.label,
    prompt: r.prompt,
    mode: r.mode,
    model: r.model,
    cadence: r.cadence,
    at: r.at ?? null,
    weekday: r.weekday ?? null,
    intervalMs: r.interval_ms ?? null,
    enabled: !!r.enabled,
    nextRunAt: Number(r.next_run_at),
    lastRunAt: r.last_run_at != null ? Number(r.last_run_at) : null,
    createdAt: Number(r.created_at),
  };
}

export async function listSchedules(scope?: Scope): Promise<Schedule[]> {
  const rows = isTenant(scope)
    ? await q(`SELECT * FROM schedules WHERE org_id = $1 ORDER BY created_at DESC`, [scope.orgId])
    : await q(`SELECT * FROM schedules ORDER BY created_at DESC`);
  return rows.map(rowToSchedule);
}

export async function createSchedule(req: CreateScheduleRequest, orgId: string | null = null): Promise<Schedule> {
  const mode: SessionMode = SESSION_MODES.includes(req.mode as any) ? (req.mode as SessionMode) : 'code';
  const model = req.model || AUTO_MODEL || DEFAULT_MODEL;
  const cadence = ['daily', 'weekly', 'interval'].includes(req.cadence) ? req.cadence : 'daily';
  const at = cadence === 'interval' ? null : (req.at || '09:00');
  const weekday = cadence === 'weekly' ? (((req.weekday ?? 1) % 7) + 7) % 7 : null;
  const intervalMs = cadence === 'interval' ? Math.max(MIN_INTERVAL_MS, req.intervalMs ?? MIN_INTERVAL_MS) : null;
  const next = computeNextRun(new Date(), cadence, at, weekday, intervalMs);
  const s: Schedule = {
    id: randomUUID(),
    label: String(req.label || 'Scheduled task').slice(0, 120),
    prompt: String(req.prompt || '').slice(0, 8000),
    mode,
    model,
    cadence,
    at,
    weekday,
    intervalMs,
    enabled: true,
    nextRunAt: next,
    lastRunAt: null,
    createdAt: Date.now(),
  };
  await q(
    `INSERT INTO schedules(id,label,prompt,mode,model,cadence,at,weekday,interval_ms,enabled,next_run_at,last_run_at,created_at,org_id)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [s.id, s.label, s.prompt, s.mode, s.model, s.cadence, s.at, s.weekday, s.intervalMs, 1, s.nextRunAt, null, s.createdAt, orgId],
  );
  return s;
}

// setEnabled/deleteSchedule are ORG-SCOPED for a tenant: the WHERE clause includes
// org_id so a tenant can never enable/disable/delete another org's schedule.
export async function setEnabled(id: string, enabled: boolean, scope?: Scope): Promise<void> {
  if (isTenant(scope)) await q(`UPDATE schedules SET enabled=$1 WHERE id=$2 AND org_id=$3`, [enabled ? 1 : 0, id, scope.orgId]);
  else await q(`UPDATE schedules SET enabled=$1 WHERE id=$2`, [enabled ? 1 : 0, id]);
}

export async function deleteSchedule(id: string, scope?: Scope): Promise<void> {
  if (isTenant(scope)) await q(`DELETE FROM schedules WHERE id=$1 AND org_id=$2`, [id, scope.orgId]);
  else await q(`DELETE FROM schedules WHERE id=$1`, [id]);
}

/** Spawn a fresh session and run the schedule's brief — the normal run path. The
 *  session is stamped with the schedule's org so a scheduled run stays inside the
 *  owning workspace (and never appears in another org). */
async function fire(s: Schedule, orgId: string | null) {
  const session = await store.createSession({
    repoUrl: null,
    repoName: null,
    branch: null,
    mode: s.mode,
    model: s.model,
    projectId: null,
    orgId,
  });
  const dateLabel = new Date().toISOString().slice(0, 10);
  await store.updateSession(session.id, { title: `${s.label} · ${dateLabel}`.slice(0, 80) });
  const titled = (await store.getSession(session.id))!;
  bus.emitGlobal({ type: 'session_status', session: titled });
  await setupWorkspace(titled).catch((err) => console.error('[schedule] workspace:', err));
  await store.appendTimeline(session.id, { kind: 'user', id: randomUUID(), text: s.prompt, ts: Date.now() });
  await manager.startRun(session.id, s.prompt);
}

let timer: ReturnType<typeof setInterval> | null = null;

export async function tick(now = Date.now()) {
  let due: any[] = [];
  try {
    due = await q(`SELECT * FROM schedules WHERE enabled=1 AND next_run_at <= $1`, [now]);
  } catch (e) {
    console.error('[schedule] tick query failed:', e);
    return;
  }
  for (const row of due) {
    const s = rowToSchedule(row);
    // Advance next_run_at FIRST so a slow/failed fire can't double-trigger.
    const next = computeNextRun(new Date(now), s.cadence, s.at, s.weekday, s.intervalMs);
    await q(`UPDATE schedules SET next_run_at=$1, last_run_at=$2 WHERE id=$3`, [next, now, s.id]).catch(() => {});
    try {
      await fire(s, row.org_id ?? null);
      console.log(`[schedule] fired "${s.label}" → next ${new Date(next).toISOString()}`);
    } catch (e) {
      console.error(`[schedule] fire failed for "${s.label}":`, e);
    }
  }
}

/** Start the durable scheduler loop (call once at boot). */
export function startScheduler() {
  if (timer) return;
  timer = setInterval(() => void tick(), TICK_MS);
  // run once shortly after boot to catch anything already due
  setTimeout(() => void tick(), 5_000);
  console.log('[schedule] scheduler started');
}
