import { randomUUID } from 'node:crypto';
import { q } from '../db';

/**
 * Platform analytics event recording — METADATA ONLY. `track()` is fire-and-forget:
 * it is NEVER awaited in a request path and never throws, and a scalar-only props
 * allowlist makes it physically impossible to persist message/document content.
 */

export const DAY_MS = 86_400_000;
/** Epoch-day bucket (UTC) — stored on every event so day-grained GROUP BY needs no date SQL. */
export const epochDay = (ts: number): number => Math.floor(ts / DAY_MS);

export type AnalyticsEvent =
  | 'app_open'
  | 'signup'
  | 'org_created'
  | 'invite_sent'
  | 'invite_accepted'
  | 'lead_submitted'
  | 'onboarding_completed'
  | 'session_created'
  | 'run_started'
  | 'run_finished'
  | 'deliverable_produced'
  | 'publish'
  | 'mode_switch';

type Scalar = string | number | boolean | null | undefined;

/** Keep ONLY scalars (numbers/booleans/short enum-or-id strings); drop everything
 *  else and cap length — so no chat/document content can ever leak into analytics. */
function safeProps(props?: Record<string, Scalar>): string | null {
  if (!props) return null;
  const out: Record<string, string | number | boolean> = {};
  let n = 0;
  for (const [k, v] of Object.entries(props)) {
    if (v == null || n >= 20) continue;
    if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'string') out[k] = v.slice(0, 120);
    else continue; // objects/arrays → dropped (never content)
    n++;
  }
  return JSON.stringify(out);
}

export function track(
  event: AnalyticsEvent,
  ctx: {
    orgId?: string | null;
    userId?: string | null;
    sessionId?: string | null;
    props?: Record<string, Scalar>;
  } = {},
): void {
  const ts = Date.now();
  void q(
    `INSERT INTO analytics_events(id, ts, day, event, org_id, user_id, session_id, props, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [randomUUID(), ts, epochDay(ts), event, ctx.orgId ?? null, ctx.userId ?? null, ctx.sessionId ?? null, safeProps(ctx.props), ts],
  ).catch(() => {});
}
