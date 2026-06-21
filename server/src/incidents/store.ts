import crypto from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { q, qOne } from '../db';
import { config, secretValues } from '../config';

export type IncidentKind = 'run_error' | 'timeout' | 'stall' | 'cost_spike' | 'tool_error' | 'http_5xx';
export type Severity = 'low' | 'med' | 'high';

export interface IncidentInput {
  kind: IncidentKind;
  severity?: Severity;
  /** Stable signature for dedup (e.g. error class + location). Falls back to title. */
  signature?: string;
  title: string;
  detail?: string;
  context?: Record<string, unknown>;
  orgId?: string | null;
  sessionId?: string | null;
}

/** Strip any known secret from text before it's stored or sent anywhere. */
function scrub(s: string): string {
  let out = s;
  for (const v of secretValues()) out = out.split(v).join('[redacted]');
  return out;
}

/** A stable fingerprint so repeats collapse into one incident (count++). */
export function fingerprint(kind: string, signature: string): string {
  const norm = signature
    .replace(/0x[0-9a-f]+/gi, '0x') // pointers
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27}\b/gi, '<id>') // uuids
    .replace(/\d{3,}/g, '<n>') // long numbers (e.g. "150s" → "<n>s"; no word-boundary needed)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
  return crypto.createHash('sha256').update(`${kind}|${norm}`).digest('hex').slice(0, 16);
}

export interface Incident {
  id: string;
  fingerprint: string;
  kind: string;
  severity: string;
  title: string;
  detail: string | null;
  context: any;
  orgId: string | null;
  sessionId: string | null;
  count: number;
  status: 'open' | 'fixing' | 'resolved' | 'wontfix';
  issueUrl: string | null;
  firstSeen: number;
  lastSeen: number;
}

interface Row {
  id: string; fingerprint: string; kind: string; severity: string; title: string;
  detail: string | null; context: string | null; org_id: string | null; session_id: string | null;
  count: number; status: string; issue_url: string | null; first_seen: number; last_seen: number;
}
function toIncident(r: Row): Incident {
  return {
    id: r.id, fingerprint: r.fingerprint, kind: r.kind, severity: r.severity, title: r.title,
    detail: r.detail, context: r.context ? safeParse(r.context) : null, orgId: r.org_id, sessionId: r.session_id,
    count: r.count, status: (r.status as Incident['status']) ?? 'open', issueUrl: r.issue_url,
    firstSeen: r.first_seen, lastSeen: r.last_seen,
  };
}
function safeParse(s: string): any { try { return JSON.parse(s); } catch { return null; } }

/**
 * Record an incident (fire-and-forget; never throws into the caller). Repeats with the
 * same fingerprint bump the count + last_seen and re-open a resolved one. Returns the
 * incident id and whether it's NEW (a brand-new fingerprint) — the trigger for filing.
 */
export async function recordIncident(input: IncidentInput): Promise<{ id: string; isNew: boolean } | null> {
  if (!config.autoHeal) return null;
  try {
    const fp = fingerprint(input.kind, input.signature || input.title);
    const now = Date.now();
    const detail = input.detail ? scrub(input.detail).slice(0, 4000) : null;
    const ctx = input.context ? scrub(JSON.stringify(input.context)).slice(0, 8000) : null;
    const existing = await qOne<Row>('SELECT * FROM incidents WHERE fingerprint = $1', [fp]);
    if (existing) {
      const status = existing.status === 'resolved' || existing.status === 'wontfix' ? 'open' : existing.status;
      await q(
        'UPDATE incidents SET count = count + 1, last_seen = $1, status = $2, detail = COALESCE($3, detail) WHERE fingerprint = $4',
        [now, status, detail, fp],
      );
      return { id: existing.id, isNew: false };
    }
    const id = randomUUID();
    await q(
      `INSERT INTO incidents(id, fingerprint, kind, severity, title, detail, context, org_id, session_id, count, status, first_seen, last_seen)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,1,'open',$10,$11)`,
      [id, fp, input.kind, input.severity ?? 'med', scrub(input.title).slice(0, 200), detail, ctx,
        input.orgId ?? null, input.sessionId ?? null, now, now],
    );
    // A fresh fingerprint → file the auto-fix issue (the "check in with Claude" trigger).
    // Best-effort + lazy import so the store has no hard dependency on the reporter.
    void (async () => {
      try {
        const { fileIncidentIssue } = await import('./report');
        const created = await qOne<Row>('SELECT * FROM incidents WHERE id = $1', [id]);
        if (created) {
          const url = await fileIncidentIssue(toIncident(created));
          if (url) await setIncidentIssueUrl(id, url);
        }
      } catch { /* never block on filing */ }
    })();
    return { id, isNew: true };
  } catch (e) {
    console.warn('[incidents] record failed:', (e as any)?.message ?? e);
    return null;
  }
}

export async function listIncidents(status?: string): Promise<Incident[]> {
  const rows = status
    ? await q<Row>('SELECT * FROM incidents WHERE status = $1 ORDER BY last_seen DESC', [status])
    : await q<Row>('SELECT * FROM incidents ORDER BY last_seen DESC');
  return rows.map(toIncident);
}

export async function setIncidentStatus(id: string, status: Incident['status']): Promise<void> {
  await q('UPDATE incidents SET status = $1 WHERE id = $2', [status, id]);
}

export async function setIncidentIssueUrl(id: string, url: string): Promise<void> {
  await q('UPDATE incidents SET issue_url = $1 WHERE id = $2', [url, id]);
}
