/**
 * METRIC SNAPSHOT MEMORY — recurring reports that remember (BI arc, 2026-07-06).
 * A scheduled "weekly revenue report" is only useful when run N can say what changed
 * since run N-1. This module is that memory: org-scoped named SERIES ("monthly-revenue"),
 * one row per PERIOD ("2024-02"), metrics as a flat name→number map.
 *
 * Honesty rules baked in:
 * - Re-recording an existing period NEVER silently overwrites — the prior values are
 *   kept in restated_from and every history read SURFACES the restatement diff.
 * - Deltas are LIKE-FOR-LIKE: a metric is only compared across periods where it exists
 *   on both sides; a metric that appears/disappears is flagged, not zero-filled.
 */

import { randomUUID } from 'node:crypto';
import { q, qOne } from '../db';

export interface MetricSnapshot {
  id: string;
  orgId: string;
  series: string;
  period: string;
  metrics: Record<string, number>;
  note: string | null;
  sessionId: string | null;
  /** Prior values when this period was re-recorded (restatement), else null. */
  restatedFrom: Record<string, number> | null;
  restatedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

const normSeries = (s: string): string =>
  String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

const normPeriod = (s: string): string => String(s ?? '').trim().slice(0, 40);

const orgKey = (orgId: string | null | undefined): string => orgId ?? '';

function rowToSnap(r: any): MetricSnapshot {
  const parse = (s: any) => {
    try {
      const v = JSON.parse(String(s));
      return v && typeof v === 'object' ? v : null;
    } catch {
      return null;
    }
  };
  return {
    id: r.id,
    orgId: r.org_id ?? '',
    series: r.series,
    period: r.period,
    metrics: parse(r.metrics) ?? {},
    note: r.note ?? null,
    sessionId: r.session_id ?? null,
    restatedFrom: r.restated_from ? parse(r.restated_from) : null,
    restatedAt: r.restated_at != null ? Number(r.restated_at) : null,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

/** Keep only finite numeric metrics; report what was dropped. */
export function sanitizeMetrics(input: any): { metrics: Record<string, number>; dropped: string[] } {
  const metrics: Record<string, number> = {};
  const dropped: string[] = [];
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    for (const [k, v] of Object.entries(input)) {
      const name = String(k).trim().slice(0, 80);
      if (!name) continue;
      const n = typeof v === 'number' ? v : Number(String(v).replace(/[, ]/g, ''));
      if (Number.isFinite(n)) metrics[name] = Math.round(n * 10000) / 10000;
      else dropped.push(name);
    }
  }
  return { metrics, dropped };
}

export interface SaveResult {
  snapshot: MetricSnapshot;
  /** Set when an existing period was re-recorded with DIFFERENT values. */
  restatement: Array<{ metric: string; was: number | null; now: number | null }> | null;
}

export async function saveSnapshot(input: {
  orgId: string | null;
  series: string;
  period: string;
  metrics: Record<string, number>;
  note?: string | null;
  sessionId?: string | null;
}): Promise<SaveResult> {
  const series = normSeries(input.series);
  const period = normPeriod(input.period);
  if (!series) throw new Error('series is required');
  if (!period) throw new Error('period is required');
  if (!Object.keys(input.metrics).length) throw new Error('metrics is empty — pass at least one name→number pair');
  const org = orgKey(input.orgId);
  const now = Date.now();
  const existing = await qOne<any>(
    'SELECT * FROM metric_snapshots WHERE org_id = $1 AND series = $2 AND period = $3',
    [org, series, period],
  );
  if (!existing) {
    const id = randomUUID();
    await q(
      `INSERT INTO metric_snapshots(id, org_id, series, period, metrics, note, session_id, restated_from, restated_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, NULL, $8, $9)`,
      [id, org, series, period, JSON.stringify(input.metrics), input.note ?? null, input.sessionId ?? null, now, now],
    );
    const row = await qOne<any>('SELECT * FROM metric_snapshots WHERE id = $1', [id]);
    return { snapshot: rowToSnap(row), restatement: null };
  }
  const prior = rowToSnap(existing);
  const diff: SaveResult['restatement'] = [];
  for (const name of new Set([...Object.keys(prior.metrics), ...Object.keys(input.metrics)])) {
    const was = name in prior.metrics ? prior.metrics[name] : null;
    const now2 = name in input.metrics ? input.metrics[name] : null;
    if (was !== now2) diff.push({ metric: name, was, now: now2 });
  }
  if (!diff.length) {
    // Identical re-record — refresh nothing, report no restatement.
    return { snapshot: prior, restatement: null };
  }
  await q(
    `UPDATE metric_snapshots SET metrics = $1, note = $2, session_id = $3, restated_from = $4, restated_at = $5, updated_at = $6
     WHERE id = $7`,
    [
      JSON.stringify(input.metrics),
      input.note ?? prior.note,
      input.sessionId ?? prior.sessionId,
      JSON.stringify(prior.metrics),
      now,
      now,
      prior.id,
    ],
  );
  const row = await qOne<any>('SELECT * FROM metric_snapshots WHERE id = $1', [prior.id]);
  return { snapshot: rowToSnap(row), restatement: diff };
}

export async function listSnapshots(orgId: string | null, series: string, limit = 36): Promise<MetricSnapshot[]> {
  const rows = await q<any>(
    'SELECT * FROM metric_snapshots WHERE org_id = $1 AND series = $2 ORDER BY period ASC',
    [orgKey(orgId), normSeries(series)],
  );
  const snaps = rows.map(rowToSnap);
  return snaps.length > limit ? snaps.slice(snaps.length - limit) : snaps;
}

export async function listSeries(orgId: string | null): Promise<Array<{ series: string; periods: number; last: string }>> {
  const rows = await q<any>(
    'SELECT series, period FROM metric_snapshots WHERE org_id = $1 ORDER BY series ASC, period ASC',
    [orgKey(orgId)],
  );
  const bySeries = new Map<string, string[]>();
  for (const r of rows) (bySeries.get(r.series) ?? bySeries.set(r.series, []).get(r.series)!).push(r.period);
  return [...bySeries.entries()].map(([series, periods]) => ({ series, periods: periods.length, last: periods[periods.length - 1] }));
}

// ------------------------------------------------------------------ pure math

export interface MetricDelta {
  metric: string;
  period: string;
  value: number;
  priorPeriod: string | null;
  priorValue: number | null;
  /** null when the metric has no prior period to compare against (NOT zero). */
  delta: number | null;
  deltaPct: number | null;
  isNew: boolean;
}

/** Like-for-like deltas between consecutive periods per metric. Pure. */
export function computeSeriesDeltas(snaps: MetricSnapshot[]): MetricDelta[] {
  const out: MetricDelta[] = [];
  for (let i = 0; i < snaps.length; i++) {
    const cur = snaps[i];
    const prior = i > 0 ? snaps[i - 1] : null;
    for (const [metric, value] of Object.entries(cur.metrics)) {
      const priorValue = prior && metric in prior.metrics ? prior.metrics[metric] : null;
      const delta = priorValue !== null ? Math.round((value - priorValue) * 10000) / 10000 : null;
      out.push({
        metric,
        period: cur.period,
        value,
        priorPeriod: prior?.period ?? null,
        priorValue,
        delta,
        deltaPct:
          priorValue !== null && priorValue !== 0 && delta !== null
            ? Math.round((delta / Math.abs(priorValue)) * 10000) / 100
            : null,
        isNew: prior !== null && priorValue === null,
      });
    }
  }
  return out;
}
