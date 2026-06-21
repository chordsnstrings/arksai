import { randomUUID } from 'node:crypto';
import type {
  CreateRobotRequest,
  Robot,
  RobotConfig,
  RobotDraft,
  RobotDraftStatus,
} from '../../../shared/types';
import { q, qOne } from '../db';

/**
 * Robots data layer: a standing email agent per org, and the drafts it produces.
 * All reads/writes are org-scoped by the caller (routes pass the authenticated
 * orgId — never client input). Drafts lock to_addr to the inbound sender at
 * creation time, so an approved send can never be redirected.
 */

function parseConfig(s: any): RobotConfig {
  if (!s) return {};
  try {
    return JSON.parse(s) as RobotConfig;
  } catch {
    return {};
  }
}

function rowToRobot(r: any): Robot {
  return {
    id: r.id,
    orgId: r.org_id,
    name: r.name,
    role: r.role,
    status: r.status,
    autonomy: r.autonomy,
    model: r.model,
    config: parseConfig(r.config),
    lastPolledAt: r.last_polled_at != null ? Number(r.last_polled_at) : null,
    mailboxReady: !!Number(r.mailbox_ready ?? 0),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

// Correlated subquery (SQLite + PG portable) → 1 when the robot has its own enabled,
// receivable (IMAP) mailbox. Selected alongside robots.* as `mailbox_ready`.
const MAILBOX_READY =
  `(SELECT CASE WHEN COUNT(*) > 0 THEN 1 ELSE 0 END FROM robot_email_accounts e ` +
  `WHERE e.robot_id = robots.id AND e.enabled = 1 AND e.imap_host IS NOT NULL) AS mailbox_ready`;

function rowToDraft(r: any): RobotDraft {
  return {
    id: r.id,
    robotId: r.robot_id,
    orgId: r.org_id,
    inboundMessageId: r.inbound_message_id ?? null,
    inboundFrom: r.inbound_from,
    inboundName: r.inbound_name ?? null,
    inboundSubject: r.inbound_subject ?? null,
    inboundSnippet: r.inbound_snippet ?? null,
    toAddr: r.to_addr,
    subject: r.subject,
    draftText: r.draft_text,
    modelUsed: r.model_used ?? null,
    altText: r.alt_text ?? null,
    altModel: r.alt_model ?? null,
    escalated: !!Number(r.escalated),
    escalationReason: r.escalation_reason ?? null,
    status: r.status,
    createdAt: Number(r.created_at),
    sentAt: r.sent_at != null ? Number(r.sent_at) : null,
  };
}

// ---- robots ----

export async function listRobots(orgId: string): Promise<Robot[]> {
  const rows = await q(`SELECT robots.*, ${MAILBOX_READY} FROM robots WHERE org_id = $1 ORDER BY created_at DESC`, [orgId]);
  return rows.map(rowToRobot);
}

export async function getRobot(id: string, orgId?: string): Promise<Robot | null> {
  const r = await qOne(`SELECT robots.*, ${MAILBOX_READY} FROM robots WHERE id = $1`, [id]);
  if (!r) return null;
  if (orgId != null && r.org_id !== orgId) return null; // cross-org → not found
  return rowToRobot(r);
}

export async function createRobot(orgId: string, req: CreateRobotRequest): Promise<Robot> {
  const id = randomUUID();
  const now = Date.now();
  await q(
    `INSERT INTO robots(id, org_id, name, role, status, autonomy, model, config, last_polled_at, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      id,
      orgId,
      req.name,
      req.role,
      'draft',
      req.autonomy ?? 'ask',
      req.model ?? 'arksai-max',
      JSON.stringify(req.config ?? {}),
      null,
      now,
      now,
    ],
  );
  return (await getRobot(id, orgId))!;
}

const ROBOT_FIELDS: Record<string, string> = {
  name: 'name',
  role: 'role',
  status: 'status',
  autonomy: 'autonomy',
  model: 'model',
};

export async function updateRobot(
  id: string,
  orgId: string,
  patch: Partial<Pick<Robot, 'name' | 'role' | 'status' | 'autonomy' | 'model' | 'config'>>,
): Promise<Robot | null> {
  const robot = await getRobot(id, orgId);
  if (!robot) return null;
  const sets: string[] = [];
  const vals: any[] = [];
  let i = 1;
  for (const [key, col] of Object.entries(ROBOT_FIELDS)) {
    if (key in patch && (patch as any)[key] != null) {
      sets.push(`${col} = $${i++}`);
      vals.push((patch as any)[key]);
    }
  }
  if (patch.config) {
    sets.push(`config = $${i++}`);
    vals.push(JSON.stringify(patch.config));
  }
  sets.push(`updated_at = $${i++}`);
  vals.push(Date.now());
  vals.push(id);
  await q(`UPDATE robots SET ${sets.join(', ')} WHERE id = $${i}`, vals);
  return getRobot(id, orgId);
}

export async function deleteRobot(id: string, orgId: string): Promise<void> {
  await q('DELETE FROM robots WHERE id = $1 AND org_id = $2', [id, orgId]);
  await q('DELETE FROM robot_drafts WHERE robot_id = $1 AND org_id = $2', [id, orgId]);
  await q('DELETE FROM robot_email_accounts WHERE robot_id = $1 AND org_id = $2', [id, orgId]);
}

export async function markPolled(id: string, ts = Date.now()): Promise<void> {
  await q('UPDATE robots SET last_polled_at = $1 WHERE id = $2', [ts, id]);
}

/** Active robots across all orgs — used by the poller (internal caller, unscoped). */
export async function listActiveRobots(): Promise<Robot[]> {
  const rows = await q(`SELECT robots.*, ${MAILBOX_READY} FROM robots WHERE status = 'active'`);
  return rows.map(rowToRobot);
}

// ---- drafts ----

export interface NewDraft {
  robotId: string;
  orgId: string;
  inboundMessageId: string | null;
  inboundFrom: string;
  inboundName: string | null;
  inboundSubject: string | null;
  inboundSnippet: string | null;
  toAddr: string;
  subject: string;
  draftText: string;
  modelUsed: string | null;
  altText?: string | null;
  altModel?: string | null;
  escalated?: boolean;
  escalationReason?: string | null;
}

export async function createDraft(d: NewDraft): Promise<RobotDraft> {
  const id = randomUUID();
  const now = Date.now();
  await q(
    `INSERT INTO robot_drafts(
       id, robot_id, org_id, inbound_message_id, inbound_from, inbound_name, inbound_subject,
       inbound_snippet, to_addr, subject, draft_text, model_used, alt_text, alt_model,
       escalated, escalation_reason, status, created_at, sent_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
    [
      id,
      d.robotId,
      d.orgId,
      d.inboundMessageId,
      d.inboundFrom,
      d.inboundName,
      d.inboundSubject,
      d.inboundSnippet,
      d.toAddr,
      d.subject,
      d.draftText,
      d.modelUsed,
      d.altText ?? null,
      d.altModel ?? null,
      d.escalated ? 1 : 0,
      d.escalationReason ?? null,
      d.escalated ? 'escalated' : 'pending',
      now,
      null,
    ],
  );
  return (await getDraft(id))!;
}

export async function getDraft(id: string, orgId?: string): Promise<RobotDraft | null> {
  const r = await qOne('SELECT * FROM robot_drafts WHERE id = $1', [id]);
  if (!r) return null;
  if (orgId != null && r.org_id !== orgId) return null;
  return rowToDraft(r);
}

export async function listDrafts(orgId: string, robotId?: string, status?: RobotDraftStatus): Promise<RobotDraft[]> {
  let sql = 'SELECT * FROM robot_drafts WHERE org_id = $1';
  const vals: any[] = [orgId];
  let i = 2;
  if (robotId) {
    sql += ` AND robot_id = $${i++}`;
    vals.push(robotId);
  }
  if (status) {
    sql += ` AND status = $${i++}`;
    vals.push(status);
  }
  sql += ' ORDER BY created_at DESC LIMIT 200';
  return (await q(sql, vals)).map(rowToDraft);
}

export async function countPendingDrafts(orgId: string): Promise<number> {
  const r = await qOne<{ n: number }>(
    "SELECT COUNT(*) AS n FROM robot_drafts WHERE org_id = $1 AND status = 'pending'",
    [orgId],
  );
  return Number(r?.n ?? 0);
}

/** Has this robot already produced a draft for this inbound message? (idempotent poll) */
export async function draftExistsFor(robotId: string, messageId: string): Promise<boolean> {
  const r = await qOne('SELECT id FROM robot_drafts WHERE robot_id = $1 AND inbound_message_id = $2', [robotId, messageId]);
  return !!r;
}

export async function setDraftText(id: string, orgId: string, text: string): Promise<void> {
  await q('UPDATE robot_drafts SET draft_text = $1 WHERE id = $2 AND org_id = $3', [text, id, orgId]);
}

export async function markDraftStatus(id: string, orgId: string, status: RobotDraftStatus, sentAt?: number): Promise<void> {
  await q('UPDATE robot_drafts SET status = $1, sent_at = $2 WHERE id = $3 AND org_id = $4', [
    status,
    sentAt ?? null,
    id,
    orgId,
  ]);
}
