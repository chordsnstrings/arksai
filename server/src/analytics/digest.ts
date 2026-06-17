import { randomUUID } from 'node:crypto';
import { q } from '../db';
import { config } from '../config';
import { alerts, overview } from './queries';

/**
 * Scheduled analytics digest — a periodic platform metric snapshot (METADATA ONLY).
 * Stored in `analytics_digests` for the operator to review in-app, and (if configured)
 * pushed to a webhook. Runs on a cheap hourly self-check; generates at most one digest
 * per `config.analyticsDigestHours` window. No model, no content — just aggregates.
 */

const HOUR_MS = 3_600_000;
const round = (n: number) => Math.round(n * 1e4) / 1e4;
const safeParse = (s: string): any => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

export interface DigestSummary {
  activeUsers7d: number;
  sessions7d: number;
  cost7d: number;
  successRate: number;
  totalOrgs: number;
  totalUsers: number;
  churnRisk: number;
  costSpikes: number;
  deltas: { sessions7d: number; cost7d: number; activeUsers7d: number } | null;
}

function formatDigest(s: DigestSummary): string {
  const d = s.deltas;
  const sign = (n: number) => (n > 0 ? `+${n}` : `${n}`);
  const lines = [
    'ArksAI — platform digest',
    `Active users (7d): ${s.activeUsers7d}${d ? ` (${sign(d.activeUsers7d)})` : ''}`,
    `Sessions (7d): ${s.sessions7d}${d ? ` (${sign(d.sessions7d)})` : ''}`,
    `Cost (7d): $${s.cost7d.toFixed(2)}${d ? ` (${sign(round(d.cost7d))})` : ''}`,
    `Success rate: ${s.successRate}%`,
    `Orgs: ${s.totalOrgs} · Users: ${s.totalUsers}`,
  ];
  if (s.churnRisk) lines.push(`⚠ Churn-risk orgs: ${s.churnRisk}`);
  if (s.costSpikes) lines.push(`⚠ Cost spikes: ${s.costSpikes}`);
  return lines.join('\n');
}

async function deliver(text: string): Promise<void> {
  const url = config.analyticsDigestWebhook;
  if (!url) return;
  try {
    const { fetchPublic } = await import('../lib/web');
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10_000);
    try {
      await fetchPublic(url, ctrl.signal, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
    } finally {
      clearTimeout(t);
    }
  } catch (e: any) {
    console.error('[digest] webhook delivery failed:', e?.message ?? e);
  }
}

/** Compute + store one platform digest (with deltas vs the previous one); deliver if configured. */
export async function generateDigest(now = Date.now()): Promise<DigestSummary> {
  const ov = await overview({ orgId: null });
  const al: any = await alerts({ orgId: null });
  const prevRow: any = (await q(`SELECT summary FROM analytics_digests WHERE org_id IS NULL ORDER BY generated_at DESC LIMIT 1`, []))[0];
  const prev: DigestSummary | null = prevRow ? safeParse(prevRow.summary) : null;
  const summary: DigestSummary = {
    activeUsers7d: ov.activeUsers7d ?? 0,
    sessions7d: ov.sessions7d ?? 0,
    cost7d: ov.cost7d ?? 0,
    successRate: ov.successRate ?? 100,
    totalOrgs: ov.totalOrgs ?? 0,
    totalUsers: ov.totalUsers ?? 0,
    churnRisk: al.churnRisk?.length ?? 0,
    costSpikes: al.costSpikes?.length ?? 0,
    deltas: prev
      ? {
          sessions7d: (ov.sessions7d ?? 0) - (prev.sessions7d ?? 0),
          cost7d: round((ov.cost7d ?? 0) - (prev.cost7d ?? 0)),
          activeUsers7d: (ov.activeUsers7d ?? 0) - (prev.activeUsers7d ?? 0),
        }
      : null,
  };
  await q(
    `INSERT INTO analytics_digests(id, org_id, period_end, generated_at, summary, created_at) VALUES($1,$2,$3,$4,$5,$6)`,
    [randomUUID(), null, now, now, JSON.stringify(summary), now],
  );
  await deliver(formatDigest(summary));
  return summary;
}

/** Recent platform digests for the operator console. */
export async function listDigests(limit = 30) {
  const n = Math.min(100, Math.max(1, Math.floor(limit)));
  const rows: any[] = await q(`SELECT id, period_end, generated_at, summary FROM analytics_digests WHERE org_id IS NULL ORDER BY generated_at DESC LIMIT ${n}`, []);
  return rows.map((r) => ({ id: r.id, periodEnd: Number(r.period_end), generatedAt: Number(r.generated_at), summary: safeParse(r.summary) as DigestSummary }));
}

let timer: ReturnType<typeof setInterval> | null = null;
/** Boot the digest scheduler: hourly check, generate when a window has elapsed. */
export function startAnalyticsDigest(): void {
  if (timer) return;
  const windowMs = config.analyticsDigestHours * HOUR_MS;
  const check = async () => {
    try {
      const last: any = (await q(`SELECT generated_at FROM analytics_digests WHERE org_id IS NULL ORDER BY generated_at DESC LIMIT 1`, []))[0];
      if (!last || Date.now() - Number(last.generated_at) >= windowMs) await generateDigest();
    } catch (e: any) {
      console.error('[digest] check failed:', e?.message ?? e);
    }
  };
  timer = setInterval(() => void check(), HOUR_MS);
  setTimeout(() => void check(), 15_000); // shortly after boot so the console isn't empty
  console.log(`[digest] analytics digest scheduler started (every ${config.analyticsDigestHours}h${config.analyticsDigestWebhook ? ' + webhook' : ''})`);
}
