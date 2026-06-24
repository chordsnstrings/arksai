import { randomUUID } from 'node:crypto';
import { q } from '../db';
import type { CreateFeedbackRequest, Feedback } from '../../../shared/types';

function safeJson(s: string | null): Record<string, string> | null {
  if (!s) return null;
  try {
    const o = JSON.parse(s);
    return o && typeof o === 'object' ? o : null;
  } catch {
    return null;
  }
}

const toFeedback = (r: any): Feedback => ({
  id: r.id,
  orgId: r.org_id ?? null,
  sessionId: r.session_id,
  messageId: r.message_id ?? null,
  kind: r.kind,
  rating: r.rating,
  complaint: r.complaint ?? null,
  meta: safeJson(r.meta),
  status: r.status ?? 'new',
  createdAt: Number(r.created_at),
});

// Write-side allowlist: only these scalar string props are persisted, capped — so raw user
// CONTENT can never leak into the feedback record via meta.
function scrubMeta(meta?: Record<string, any>): string | null {
  if (!meta || typeof meta !== 'object') return null;
  const out: Record<string, string> = {};
  for (const k of ['mode', 'task', 'deliverableKind', 'name', 'model']) {
    if (typeof meta[k] === 'string' && meta[k]) out[k] = String(meta[k]).slice(0, 80);
  }
  return Object.keys(out).length ? JSON.stringify(out) : null;
}

export interface FeedbackScope {
  /** null = the whole platform (operator); a string = one org. */
  orgId: string | null;
}

export async function recordFeedback(orgId: string | null, sessionId: string, req: CreateFeedbackRequest): Promise<Feedback> {
  const id = randomUUID();
  const now = Date.now();
  const day = Math.floor(now / 86_400_000);
  const complaint =
    req.rating === 'down' && typeof req.complaint === 'string' && req.complaint.trim() ? req.complaint.trim().slice(0, 2000) : null;
  await q(
    `INSERT INTO feedback(id, org_id, session_id, message_id, kind, rating, complaint, meta, status, created_at, day)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [id, orgId, sessionId, req.messageId ?? null, req.kind, req.rating, complaint, scrubMeta(req.meta), 'new', now, day],
  );
  return {
    id,
    orgId,
    sessionId,
    messageId: req.messageId ?? null,
    kind: req.kind,
    rating: req.rating,
    complaint,
    meta: safeJson(scrubMeta(req.meta)),
    status: 'new',
    createdAt: now,
  };
}

export async function listFeedback(
  scope: FeedbackScope,
  opts?: { rating?: 'up' | 'down'; status?: Feedback['status']; limit?: number },
): Promise<Feedback[]> {
  const where: string[] = [];
  const params: any[] = [];
  let i = 1;
  if (scope.orgId !== null) {
    where.push(`org_id = $${i++}`);
    params.push(scope.orgId);
  }
  if (opts?.rating) {
    where.push(`rating = $${i++}`);
    params.push(opts.rating);
  }
  if (opts?.status) {
    where.push(`status = $${i++}`);
    params.push(opts.status);
  }
  const lim = Math.min(opts?.limit ?? 200, 500);
  const rows = await q(
    `SELECT * FROM feedback ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT ${lim}`,
    params,
  );
  return rows.map(toFeedback);
}

/** Update status. Org-scoped callers can only touch their own org's rows. */
export async function setFeedbackStatus(id: string, status: Feedback['status'], scope: FeedbackScope): Promise<void> {
  if (scope.orgId !== null) await q(`UPDATE feedback SET status=$1 WHERE id=$2 AND org_id=$3`, [status, id, scope.orgId]);
  else await q(`UPDATE feedback SET status=$1 WHERE id=$2`, [status, id]);
}

export async function feedbackSummary(scope: FeedbackScope): Promise<{ up: number; down: number; openComplaints: number }> {
  const all = await listFeedback(scope, { limit: 500 });
  return {
    up: all.filter((f) => f.rating === 'up').length,
    down: all.filter((f) => f.rating === 'down').length,
    openComplaints: all.filter((f) => f.rating === 'down' && f.complaint && f.status === 'new').length,
  };
}
