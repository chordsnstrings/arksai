import { randomUUID } from 'node:crypto';
import { q, qOne } from '../db';

/**
 * Track C safety spine — money guardrails + the ad-action audit trail. Real ad spend is
 * gated: no launch or budget change without approval (unless the autonomy slider is at
 * Autopilot) AND never over the configured cap. Every mutation is a campaign_actions row.
 */

export type CampaignActionKind = 'create_campaign' | 'launch' | 'pause' | 'budget_change' | 'boost';
export type CampaignActionStatus = 'proposed' | 'approved' | 'executed' | 'rejected' | 'failed';

export interface SpendCaps {
  dailyCapUsd: number;
  campaignCapUsd?: number;
  /** When false (Autopilot), launches/budget changes within the cap don't need approval. */
  requireApproval: boolean;
}

export interface GuardInput {
  action: CampaignActionKind;
  approved: boolean;
  /** The daily budget this action would set/spend (USD). */
  requestedDailyUsd?: number;
  /** True when a linked Facebook Page + Instagram account exist (needed for IG placements). */
  hasPageAndIg?: boolean;
  /** True when the action requests Instagram placements. */
  wantsInstagram?: boolean;
}

export interface GuardResult {
  ok: boolean;
  reason?: string;
}

/** Pure, unit-tested: may this ad action proceed? (Two invariants: approval + cap.) */
export function guardCampaignAction(input: GuardInput, caps: SpendCaps): GuardResult {
  const spendy = input.action === 'launch' || input.action === 'budget_change' || input.action === 'boost';
  if (spendy) {
    const daily = Number(input.requestedDailyUsd) || 0;
    if (daily <= 0) return { ok: false, reason: 'A positive daily budget is required.' };
    if (daily > caps.dailyCapUsd) return { ok: false, reason: `Daily budget $${daily} exceeds the $${caps.dailyCapUsd} cap — raise the cap or lower the budget.` };
    if (caps.requireApproval && !input.approved) return { ok: false, reason: 'This spends money — it needs your approval first.' };
  }
  if (input.wantsInstagram && input.hasPageAndIg === false) {
    return { ok: false, reason: 'Instagram placements need a linked Facebook Page + Instagram account.' };
  }
  return { ok: true };
}

/** Resolve spend caps from a robot's config (with safe defaults). */
export function capsFromConfig(config: { adDailyCapUsd?: number; adCampaignCapUsd?: number; autonomyLevel?: number } | null | undefined): SpendCaps {
  const level = typeof config?.autonomyLevel === 'number' ? config.autonomyLevel : 30;
  return {
    dailyCapUsd: typeof config?.adDailyCapUsd === 'number' && config.adDailyCapUsd > 0 ? config.adDailyCapUsd : 20,
    campaignCapUsd: typeof config?.adCampaignCapUsd === 'number' ? config.adCampaignCapUsd : undefined,
    requireApproval: level < 80, // only Autopilot (>=80) auto-launches within the cap
  };
}

// ---- audit store ----

export interface CampaignAction {
  id: string;
  orgId: string;
  robotId: string | null;
  connectorId: string | null;
  action: CampaignActionKind;
  objectIds: string | null;
  requestedBudgetUsd: number | null;
  status: CampaignActionStatus;
  approvedBy: string | null;
  detail: string | null;
  createdAt: number;
  updatedAt: number;
}

function rowToAction(r: any): CampaignAction {
  return {
    id: r.id, orgId: r.org_id, robotId: r.robot_id ?? null, connectorId: r.connector_id ?? null,
    action: r.action, objectIds: r.object_ids ?? null, requestedBudgetUsd: r.requested_budget_usd ?? null,
    status: r.status, approvedBy: r.approved_by ?? null, detail: r.detail ?? null,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export async function recordCampaignAction(p: {
  orgId: string; robotId?: string | null; connectorId?: string | null; action: CampaignActionKind;
  objectIds?: string | null; requestedBudgetUsd?: number | null; status: CampaignActionStatus; detail?: string | null;
}): Promise<CampaignAction> {
  const id = randomUUID();
  const now = Date.now();
  await q(
    `INSERT INTO campaign_actions(id, org_id, robot_id, connector_id, action, object_ids, requested_budget_usd, status, detail, created_at, updated_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [id, p.orgId, p.robotId ?? null, p.connectorId ?? null, p.action, p.objectIds ?? null, p.requestedBudgetUsd ?? null, p.status, p.detail ?? null, now, now],
  );
  return (await qOne('SELECT * FROM campaign_actions WHERE id = $1', [id]).then((r) => (r ? rowToAction(r) : null)))!;
}

export async function setCampaignActionStatus(id: string, status: CampaignActionStatus, approvedBy?: string, detail?: string): Promise<void> {
  await q('UPDATE campaign_actions SET status=$1, approved_by=COALESCE($2, approved_by), detail=COALESCE($3, detail), updated_at=$4 WHERE id=$5',
    [status, approvedBy ?? null, detail ?? null, Date.now(), id]);
}

export async function listCampaignActions(orgId: string, limit = 50): Promise<CampaignAction[]> {
  const rows = await q('SELECT * FROM campaign_actions WHERE org_id = $1 ORDER BY created_at DESC LIMIT $2', [orgId, limit]);
  return rows.map(rowToAction);
}
