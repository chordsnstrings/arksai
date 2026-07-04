import type { RobotStats } from '../../../shared/types';
import { q } from '../db';

/**
 * Per-robot performance stats — derived on read from robot_drafts / robot_tasks /
 * robot_action_log (metadata only; message content never leaves the server). Day bucketing
 * uses precomputed epoch days (floor(ts/86400000)) — zero date-SQL, SQLite/PG portable.
 */

export interface StatDraftRow {
  status: string;
  channel: string;
  created_at: number;
  sent_at: number | null;
  model_used: string | null;
}

const DAY_MS = 86_400_000;

/** Pure aggregation (unit-tested with synthetic rows). */
export function computeRobotStats(
  drafts: StatDraftRow[],
  tasks: { status: string }[],
  actions: { ok: number }[],
  now = Date.now(),
): RobotStats {
  // Command-lane receipts are audit rows, not conversations — exclude from reply stats.
  const real = drafts.filter((d) => d.model_used !== 'command-lane' && d.model_used !== 'owner-approval');
  const sent = real.filter((d) => d.status === 'sent');
  const escalated = real.filter((d) => d.status === 'escalated');
  const pending = real.filter((d) => d.status === 'pending');
  const dismissed = real.filter((d) => d.status === 'dismissed');

  const byChannel: Record<string, number> = {};
  for (const d of real) byChannel[d.channel || 'email'] = (byChannel[d.channel || 'email'] || 0) + 1;

  const latencies = sent
    .filter((d) => d.sent_at != null && d.sent_at >= d.created_at)
    .map((d) => Number(d.sent_at) - Number(d.created_at))
    .sort((a, b) => a - b);
  const medianResponseMs = latencies.length ? latencies[Math.floor(latencies.length / 2)] : null;

  const handledOrFlagged = sent.length + escalated.length;
  const deflectionRate = handledOrFlagged ? sent.length / handledOrFlagged : null;

  const today = Math.floor(now / DAY_MS);
  const byDay: [number, number, number][] = [];
  for (let day = today - 13; day <= today; day++) {
    const inDay = real.filter((d) => Math.floor(d.created_at / DAY_MS) === day);
    byDay.push([day, inDay.length, inDay.filter((d) => d.status === 'sent').length]);
  }

  return {
    total: real.length,
    sent: sent.length,
    escalated: escalated.length,
    pending: pending.length,
    dismissed: dismissed.length,
    deflectionRate,
    medianResponseMs,
    byChannel,
    byDay,
    tasks: {
      delivered: tasks.filter((t) => t.status === 'delivered').length,
      error: tasks.filter((t) => t.status === 'error').length,
      running: tasks.filter((t) => t.status === 'running' || t.status === 'delivering').length,
    },
    actions: {
      calls: actions.length,
      failures: actions.filter((a) => !Number(a.ok)).length,
    },
  };
}

/** Load + aggregate the last 30 days for one robot. */
export async function robotStats(robotId: string, now = Date.now()): Promise<RobotStats> {
  const since = now - 30 * DAY_MS;
  const [drafts, tasks, actions] = await Promise.all([
    q(
      'SELECT status, channel, created_at, sent_at, model_used FROM robot_drafts WHERE robot_id = $1 AND created_at >= $2 ORDER BY created_at DESC LIMIT 2000',
      [robotId, since],
    ),
    q('SELECT status FROM robot_tasks WHERE robot_id = $1 AND created_at >= $2 LIMIT 500', [robotId, since]),
    q('SELECT ok FROM robot_action_log WHERE robot_id = $1 AND created_at >= $2 LIMIT 2000', [robotId, since]),
  ]);
  return computeRobotStats(
    drafts.map((r: any) => ({
      status: r.status,
      channel: r.channel || 'email',
      created_at: Number(r.created_at),
      sent_at: r.sent_at != null ? Number(r.sent_at) : null,
      model_used: r.model_used ?? null,
    })),
    tasks as any[],
    actions as any[],
    now,
  );
}
