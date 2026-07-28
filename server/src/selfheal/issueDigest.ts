import { randomUUID } from 'node:crypto';
import { q } from '../db';
import { config } from '../config';
import { getTimeline } from '../sessions/store';
import {
  clusterSignals,
  classifyError,
  looksLikeComplaint,
  redactSnippet,
  type IssueCluster,
  type IssueSignal,
} from './issues';

/**
 * Self-healing PHASE 1 — the nightly ISSUE DIGEST (detect + cluster + report; NO auto-fix).
 * Gathers the last N hours of platform activity across ALL tenants, turns failures and user
 * complaints into ranked, redacted clusters, stores them for the operator console, and (if a
 * webhook is set) pushes a short brief. Operator-only; metadata + short redacted snippets only.
 */

const HOUR_MS = 3_600_000;
const safeParse = (s: any): any => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

// Bound the work so this stays cheap as the platform grows (logged in the summary when it bites).
const MAX_SESSIONS_SCANNED = Number(process.env.ISSUE_DIGEST_MAX_SESSIONS || '1200') || 1200;
const MAX_ERROR_TIMELINES = 400; // read terminal error text for at most this many failed runs

export interface IssueDigestSummary {
  windowHours: number;
  runErrors: number;
  complaints: number;
  clusters: number;
  affectedOrgs: number;
  scannedSessions: number;
  truncated: boolean;
  topRemediation: string | null;
}

/** Pull the terminal error/system text of a session (for failure classification), redacted. */
async function terminalErrorText(sessionId: string): Promise<string> {
  try {
    const tl = await getTimeline(sessionId);
    const tail = tl.slice(-8).filter((i: any) => i.kind === 'system' || i.kind === 'error' || i.kind === 'assistant');
    return tail
      .map((i: any) => String(i.text ?? ''))
      .join(' ')
      .slice(0, 600);
  } catch {
    return '';
  }
}

/** Detect complaint turns in a session: a user message that reacts to a bad output (i.e. it comes
 *  AFTER the robot has produced something). Returns one representative redacted snippet or null. */
function firstComplaintSnippet(timeline: any[]): string | null {
  let sawOutput = false;
  for (const item of timeline) {
    const kind = item?.kind;
    if (kind === 'assistant' || kind === 'tool' || kind === 'system') sawOutput = true;
    else if (kind === 'user' && sawOutput && looksLikeComplaint(String(item.text ?? ''))) {
      return redactSnippet(String(item.text ?? ''));
    }
  }
  return null;
}

/** Gather issue signals across all tenants in the window. I/O; the transforms are pure (issues.ts). */
export async function collectSignals(sinceMs: number): Promise<{ signals: IssueSignal[]; scanned: number; truncated: boolean }> {
  const signals: IssueSignal[] = [];

  // (1) Failed runs — from analytics_events (metadata: mode/deliverable), classified via the
  // session's terminal error text. Only tenant orgs surface issues (operator's own runs excluded).
  const errEvents: any[] = await q(
    `SELECT session_id, org_id, ts, props FROM analytics_events WHERE event = 'run_finished' AND ts >= $1 ORDER BY ts DESC`,
    [sinceMs],
  ).catch(() => []);
  let errReads = 0;
  for (const e of errEvents) {
    const props = safeParse(e.props) ?? {};
    if (props.status !== 'error') continue;
    const errText = errReads < MAX_ERROR_TIMELINES ? await terminalErrorText(String(e.session_id ?? '')) : '';
    errReads++;
    signals.push({
      kind: 'run_error',
      orgId: e.org_id ?? null,
      sessionId: e.session_id ?? null,
      ts: Number(e.ts),
      mode: props.mode ?? undefined,
      deliverable: props.deliverable ?? undefined,
      errorClass: classifyError(errText),
      snippet: errText ? redactSnippet(errText) : undefined,
    });
  }

  // (2) User complaints — scan recently-active sessions' timelines for a bad-reaction turn.
  const rows: any[] = await q(
    `SELECT id, org_id, mode, updated_at FROM sessions WHERE updated_at >= $1 ORDER BY updated_at DESC LIMIT ${MAX_SESSIONS_SCANNED + 1}`,
    [sinceMs],
  ).catch(() => []);
  const truncated = rows.length > MAX_SESSIONS_SCANNED;
  const scan = rows.slice(0, MAX_SESSIONS_SCANNED);
  for (const s of scan) {
    let tl: any[];
    try {
      tl = await getTimeline(String(s.id));
    } catch {
      continue;
    }
    const snip = firstComplaintSnippet(tl);
    if (snip) {
      signals.push({
        kind: 'complaint',
        orgId: s.org_id ?? null,
        sessionId: s.id,
        ts: Number(s.updated_at),
        mode: s.mode ?? undefined,
        snippet: snip,
      });
    }
  }

  return { signals, scanned: scan.length, truncated };
}

/** OPTIONAL model refinement (best-effort, off without a key): one-line root-cause hypothesis per
 *  top cluster, from the REDACTED metadata + example snippets only. Never blocks the digest. */
async function enrichWithModel(clusters: IssueCluster[]): Promise<Record<string, string>> {
  if (!config.minimaxApiKey || !clusters.length) return {};
  const out: Record<string, string> = {};
  try {
    const { generateTextM3 } = await import('../engines/minimax');
    const top = clusters.slice(0, 6);
    const payload = top
      .map(
        (c, i) =>
          `${i + 1}. [${c.remediation}] ${c.title} — ${c.count}× across ${c.orgs} tenant(s). Examples: ${c.examples.join(' | ') || '(none)'}`,
      )
      .join('\n');
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 60_000);
    try {
      const r = await generateTextM3(
        `These are clustered platform issues from the last day (redacted). For EACH numbered item, give ONE short line: the most likely ROOT CAUSE and whether it's a code, prompt, model, or environment fix. Reply as "N: <cause>" lines only.\n\n${payload}`,
        ac.signal,
        { maxTokens: 500, system: 'You are a terse senior engineer triaging production issues. One line per item, no preamble.' },
      );
      if (r.ok && r.text) {
        for (const line of r.text.split('\n')) {
          const m = /^\s*(\d+)[:.)]\s*(.+)$/.exec(line);
          if (m) {
            const idx = Number(m[1]) - 1;
            if (top[idx]) out[top[idx].key] = redactSnippet(m[2], 240);
          }
        }
      }
    } finally {
      clearTimeout(t);
    }
  } catch {
    /* best-effort — the deterministic digest stands on its own */
  }
  return out;
}

/** Build + store one issue digest for the window ending now; deliver a short brief if configured. */
export async function generateIssueDigest(now = Date.now()): Promise<IssueDigestSummary> {
  const windowHours = config.issueDigestHours;
  const since = now - windowHours * HOUR_MS;
  const { signals, scanned, truncated } = await collectSignals(since);
  const clusters = clusterSignals(signals);
  const hypotheses = await enrichWithModel(clusters);
  const enriched = clusters.map((c) => (hypotheses[c.key] ? { ...c, hypothesis: hypotheses[c.key] } : c));

  const affectedOrgs = new Set(signals.map((s) => s.orgId ?? '·')).size;
  const runErrors = signals.filter((s) => s.kind === 'run_error').length;
  const complaints = signals.filter((s) => s.kind === 'complaint').length;
  const remCounts = new Map<string, number>();
  for (const c of clusters) remCounts.set(c.remediation, (remCounts.get(c.remediation) ?? 0) + c.count);
  const topRemediation = [...remCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const summary: IssueDigestSummary = {
    windowHours,
    runErrors,
    complaints,
    clusters: clusters.length,
    affectedOrgs,
    scannedSessions: scanned,
    truncated,
    topRemediation,
  };

  await q(
    `INSERT INTO issue_digests(id, period_start, period_end, generated_at, clusters, summary, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [randomUUID(), since, now, now, JSON.stringify(enriched), JSON.stringify(summary), now],
  );
  await deliver(formatIssueDigest(summary, enriched as IssueCluster[]));
  return summary;
}

export function formatIssueDigest(s: IssueDigestSummary, clusters: IssueCluster[]): string {
  const lines = [
    'ArksAI — nightly issue digest',
    `Window: last ${s.windowHours}h · ${s.runErrors} failed run(s) · ${s.complaints} user complaint(s) · ${s.clusters} cluster(s) · ${s.affectedOrgs} tenant(s)`,
  ];
  if (!clusters.length) {
    lines.push('All clear — nothing surfaced.');
    return lines.join('\n');
  }
  lines.push('Top issues (most severe first):');
  for (const c of clusters.slice(0, 6)) {
    const hyp = (c as any).hypothesis ? ` — ${(c as any).hypothesis}` : '';
    lines.push(`• [${c.remediation}] ${c.title} — ${c.count}× / ${c.orgs} tenant(s)${hyp}`);
  }
  if (s.truncated) lines.push(`(scan capped at ${s.scannedSessions} sessions — some activity not scanned)`);
  return lines.join('\n');
}

async function deliver(text: string): Promise<void> {
  const url = config.issueDigestWebhook || config.analyticsDigestWebhook;
  if (!url) return;
  try {
    const { fetchPublic } = await import('../lib/web');
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10_000);
    try {
      await fetchPublic(url, ctrl.signal, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
    } finally {
      clearTimeout(t);
    }
  } catch (e: any) {
    console.error('[issue-digest] webhook delivery failed:', e?.message ?? e);
  }
}

/** Recent issue digests for the operator console (newest first). */
export async function listIssueDigests(limit = 20) {
  const n = Math.min(60, Math.max(1, Math.floor(limit)));
  const rows: any[] = await q(
    `SELECT id, period_start, period_end, generated_at, clusters, summary FROM issue_digests ORDER BY generated_at DESC LIMIT ${n}`,
    [],
  ).catch(() => []);
  return rows.map((r) => ({
    id: r.id,
    periodStart: Number(r.period_start),
    periodEnd: Number(r.period_end),
    generatedAt: Number(r.generated_at),
    clusters: (safeParse(r.clusters) as IssueCluster[]) ?? [],
    summary: safeParse(r.summary) as IssueDigestSummary,
  }));
}

let timer: ReturnType<typeof setInterval> | null = null;
/** Boot the nightly issue-digest scheduler (hourly self-check; generate once per window). */
export function startIssueDigest(): void {
  if (timer) return;
  const windowMs = config.issueDigestHours * HOUR_MS;
  const check = async () => {
    try {
      const last: any = (await q(`SELECT generated_at FROM issue_digests ORDER BY generated_at DESC LIMIT 1`, []))[0];
      if (!last || Date.now() - Number(last.generated_at) >= windowMs) await generateIssueDigest();
    } catch (e: any) {
      console.error('[issue-digest] check failed:', e?.message ?? e);
    }
  };
  timer = setInterval(() => void check(), HOUR_MS);
  setTimeout(() => void check(), 20_000);
  console.log(`[issue-digest] scheduler started (every ${config.issueDigestHours}h${config.issueDigestWebhook || config.analyticsDigestWebhook ? ' + webhook' : ''})`);
}
