import { randomUUID } from 'node:crypto';
import type { Robot, RobotDraft, RobotDraftChannel, RobotJob, RobotTask } from '../../../shared/types';
import { q, qOne } from '../db';
import { computeNextRun } from '../schedule/scheduler';
import { listCommanders, listTasks, runningTaskCount, startTask } from './tasks';
import { sendOnChannel } from './outbound';

/**
 * PROACTIVE ROUTINES — robots that act without being messaged:
 *  - 'digest': a daily/weekly summary of what the robot did + what's gone stale in
 *    Needs-You, delivered to the owner's channel. Quiet days send NOTHING (no noise).
 *  - 'brief': a recurring BUILD (the commander bridge run on a schedule) — "every Monday
 *    09:00 build the weekly sales summary and deliver it here".
 * Fired from the robot poller tick; next_run_at advances BEFORE firing (the scheduler's
 * double-fire guard), so a slow run can never double-trigger.
 */

const STALE_NEEDS_YOU_MS = Number(process.env.ROBOT_STALE_NEEDS_MS || String(48 * 60 * 60_000)) || 48 * 60 * 60_000;

function parseJson<T>(s: any, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

function rowToJob(r: any): RobotJob {
  return {
    id: r.id,
    robotId: r.robot_id,
    orgId: r.org_id,
    kind: r.kind,
    cadence: r.cadence,
    atTime: r.at_time ?? null,
    weekday: r.weekday != null ? Number(r.weekday) : null,
    tz: r.tz ?? null,
    prompt: r.prompt ?? null,
    deliverTo: parseJson(r.deliver_to, []),
    enabled: !!Number(r.enabled),
    nextRunAt: Number(r.next_run_at),
    lastRunAt: r.last_run_at != null ? Number(r.last_run_at) : null,
    createdAt: Number(r.created_at),
  };
}

export interface JobInput {
  kind: 'digest' | 'brief' | 'ads_report';
  cadence: 'daily' | 'weekly' | 'monthly';
  atTime: string; // "HH:MM"
  weekday?: number | null;
  tz?: string | null;
  prompt?: string | null;
  deliverTo?: { channel: RobotDraftChannel; address: string }[];
  enabled?: boolean;
}

export async function listJobs(robotId: string, orgId?: string): Promise<RobotJob[]> {
  const rows = await q('SELECT * FROM robot_jobs WHERE robot_id = $1 ORDER BY created_at', [robotId]);
  return rows.map(rowToJob).filter((j) => orgId == null || j.orgId === orgId);
}

export async function createJob(robotId: string, orgId: string, input: JobInput): Promise<RobotJob> {
  const id = randomUUID();
  const next = computeNextRun(new Date(), input.cadence, input.atTime, input.weekday ?? null, null, input.tz ?? null);
  await q(
    `INSERT INTO robot_jobs(id, robot_id, org_id, kind, cadence, at_time, weekday, tz, prompt, deliver_to, enabled, next_run_at, last_run_at, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NULL,$13)`,
    [
      id,
      robotId,
      orgId,
      input.kind,
      input.cadence,
      input.atTime,
      input.weekday ?? null,
      input.tz ?? null,
      input.prompt ?? null,
      JSON.stringify(input.deliverTo ?? []),
      (input.enabled ?? true) ? 1 : 0,
      next,
      Date.now(),
    ],
  );
  return rowToJob((await qOne('SELECT * FROM robot_jobs WHERE id = $1', [id]))!);
}

export async function deleteJob(id: string, orgId: string): Promise<void> {
  await q('DELETE FROM robot_jobs WHERE id = $1 AND org_id = $2', [id, orgId]);
}

export async function setJobEnabled(id: string, orgId: string, enabled: boolean): Promise<void> {
  await q('UPDATE robot_jobs SET enabled = $1 WHERE id = $2 AND org_id = $3', [enabled ? 1 : 0, id, orgId]);
}

// ---- the digest composer (pure) ----

export interface DigestInput {
  robotName: string;
  now: number;
  /** Drafts from the last 24h (any status). */
  recentDrafts: Pick<RobotDraft, 'status' | 'channel' | 'createdAt'>[];
  /** Everything currently awaiting the owner, oldest first. */
  needsYou: Pick<RobotDraft, 'inboundFrom' | 'inboundName' | 'inboundSubject' | 'createdAt' | 'status'>[];
  /** Tasks from the last 24h. */
  recentTasks: Pick<RobotTask, 'status' | 'request'>[];
}

/** Compose the digest text — or null when nothing happened AND nothing is waiting (quiet-skip). */
export function composeDigest(input: DigestInput): string | null {
  const { recentDrafts, needsYou, recentTasks } = input;
  const handled = recentDrafts.filter((d) => d.status === 'sent').length;
  const flagged = recentDrafts.filter((d) => d.status === 'escalated').length;
  const stale = needsYou.filter((d) => input.now - d.createdAt > STALE_NEEDS_YOU_MS);
  if (!recentDrafts.length && !needsYou.length && !recentTasks.length) return null;

  const lines: string[] = [`📋 ${input.robotName} — your daily digest`];
  if (recentDrafts.length) {
    const byChannel = new Map<string, number>();
    for (const d of recentDrafts) byChannel.set(d.channel || 'email', (byChannel.get(d.channel || 'email') || 0) + 1);
    const chan = [...byChannel.entries()].map(([k, n]) => `${n} ${k}`).join(', ');
    lines.push(`Last 24h: ${recentDrafts.length} message(s) handled (${chan}) — ${handled} replied, ${flagged} flagged for you.`);
  } else {
    lines.push('Last 24h: no new messages.');
  }
  if (recentTasks.length) {
    const done = recentTasks.filter((t) => t.status === 'delivered').length;
    const failed = recentTasks.filter((t) => t.status === 'error').length;
    lines.push(`Builds: ${done} delivered${failed ? `, ${failed} failed` : ''}.`);
  }
  if (needsYou.length) {
    lines.push('', `⚠ Waiting on you (${needsYou.length}):`);
    for (const d of needsYou.slice(0, 5)) {
      const age = Math.round((input.now - d.createdAt) / 3_600_000);
      lines.push(`- ${d.inboundName || d.inboundFrom}${d.inboundSubject ? ` · ${d.inboundSubject}` : ''} (${age}h)`);
    }
    if (needsYou.length > 5) lines.push(`…and ${needsYou.length - 5} more.`);
    if (stale.length) lines.push(`${stale.length} of these have waited over ${Math.round(STALE_NEEDS_YOU_MS / 3_600_000)}h.`);
  } else {
    lines.push('Nothing is waiting on you. ✓');
  }
  return lines.join('\n');
}

// ---- firing (called from the robot poller tick) ----

async function digestData(robot: Robot, now: number): Promise<DigestInput> {
  const dayAgo = now - 24 * 60 * 60_000;
  const drafts = await q(
    'SELECT status, channel, created_at, inbound_from, inbound_name, inbound_subject FROM robot_drafts WHERE robot_id = $1 AND created_at >= $2 ORDER BY created_at DESC LIMIT 500',
    [robot.id, dayAgo],
  );
  const waiting = await q(
    "SELECT status, channel, created_at, inbound_from, inbound_name, inbound_subject FROM robot_drafts WHERE robot_id = $1 AND status IN ('pending','escalated') ORDER BY created_at ASC LIMIT 100",
    [robot.id],
  );
  const tasks = (await listTasks(robot.id)).filter((t) => t.createdAt >= dayAgo);
  const map = (r: any) => ({
    status: r.status,
    channel: r.channel || 'email',
    createdAt: Number(r.created_at),
    inboundFrom: r.inbound_from,
    inboundName: r.inbound_name ?? null,
    inboundSubject: r.inbound_subject ?? null,
  });
  return {
    robotName: robot.name,
    now,
    recentDrafts: drafts.map(map),
    needsYou: waiting.map(map),
    recentTasks: tasks.map((t) => ({ status: t.status, request: t.request })),
  };
}

async function targetsFor(job: RobotJob, robot: Robot): Promise<{ channel: RobotDraftChannel; address: string }[]> {
  if (job.deliverTo.length) return job.deliverTo;
  const commanders = await listCommanders(robot.id).catch(() => []);
  return commanders.filter((c) => c.notify).map((c) => ({ channel: c.channel, address: c.address }));
}

/** Fire every due job across all orgs. Advance-before-fire; never throws. */
export async function runDueJobs(getRobotById: (id: string) => Promise<Robot | null>, now = Date.now()): Promise<void> {
  let due: any[] = [];
  try {
    due = await q('SELECT * FROM robot_jobs WHERE enabled = 1 AND next_run_at <= $1 LIMIT 20', [now]);
  } catch {
    return;
  }
  for (const row of due) {
    const job = rowToJob(row);
    try {
      // Advance FIRST so a slow/failed fire can't double-trigger.
      const next = computeNextRun(new Date(now), job.cadence, job.atTime, job.weekday, null, job.tz);
      await q('UPDATE robot_jobs SET next_run_at = $1, last_run_at = $2 WHERE id = $3', [next, now, job.id]);

      const robot = await getRobotById(job.robotId);
      if (!robot || robot.status !== 'active') continue; // paused robots stay quiet

      if (job.kind === 'digest') {
        const text = composeDigest(await digestData(robot, now));
        if (!text) continue; // quiet day → no message
        for (const t of await targetsFor(job, robot)) {
          await sendOnChannel(robot, t.channel, t.address, text).catch((e) =>
            console.error(`[robot-job ${job.id}] digest via ${t.channel} failed:`, e?.message ?? e),
          );
        }
        continue;
      }

      // 'ads_report': the Report bot — deterministic Meta performance report, emailed.
      if (job.kind === 'ads_report') {
        try {
          const cfg = job.prompt ? JSON.parse(job.prompt) : {};
          const recipients = (await targetsFor(job, robot)).map((t) => t.address);
          const { runAdsReport } = await import('./socialReport');
          await runAdsReport(robot, cfg, recipients);
        } catch (e: any) {
          console.error(`[robot-job ${job.id}] ads_report failed:`, e?.message ?? e);
        }
        continue;
      }

      // 'brief': a scheduled build through the commander bridge machinery.
      if (!job.prompt?.trim()) continue;
      if ((await runningTaskCount(robot.id)) > 0) {
        console.warn(`[robot-job ${job.id}] skipped — a build is already running`);
        continue; // busy: skip this occurrence, the cadence fires again next time
      }
      const deliverTo = await targetsFor(job, robot);
      await startTask(robot, deliverTo[0]?.channel ?? 'email', `routine:${job.id}`, {
        action: 'build',
        mode: /report|deck|presentation|pdf/i.test(job.prompt) ? 'report' : 'code',
        brief: job.prompt,
        deliverTo,
      });
    } catch (e: any) {
      console.error(`[robot-job ${job.id}] fire failed:`, e?.message ?? e);
    }
  }
}
