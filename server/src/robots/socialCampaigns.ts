import { randomUUID } from 'node:crypto';
import { q, qOne } from '../db';

/**
 * Campaign bot — the durable record of a MANAGED campaign (brief → funnel → creative pool →
 * live Meta objects → 48h optimise bookkeeping) + the ad_id/post_id → campaign attribution map
 * + captured leads. Pure store here; the setup/optimise loops live further down this module
 * (Phases 4–5) so all campaign-bot state logic stays in one place.
 */

export type CampaignObjective = 'leads' | 'messages' | 'traffic' | 'sales' | 'engagement' | 'awareness';
export type CampaignStatus = 'draft' | 'generating' | 'pending_approval' | 'active' | 'paused' | 'completed' | 'failed';

/** One creative in the rotating pool. `ref` is the workspace/media path or uploaded handle. */
export interface PoolCreative {
  ref: string;
  type: 'image' | 'video';
  format: string; // 1:1 | 4:5 | 9:16 | 1.91:1 | 16:9
  headline?: string;
  body?: string;
  imageHash?: string;
  videoId?: string;
  /** Currently attached to a live ad. */
  live?: boolean;
  /** Ever used in an ad (rotation prefers never-used creatives). */
  used?: boolean;
  adId?: string;
}

export interface CampaignBrief {
  product: string;
  topics: string[];
  cta?: string;
  destination?: string; // URL / 'instant_form' / 'messenger' / 'instagram_direct'
  audience?: { countries?: string[]; ageMin?: number; ageMax?: number; genders?: ('male' | 'female')[]; interests?: string[]; broad?: boolean };
  imageCount?: number;
  videoCount?: number;
  brand?: { accent?: string; logo?: string };
  knowledge?: string;
}

export interface EngageSpecifics {
  say?: string;
  doNotSay?: string;
  escalateIf?: string;
}

export interface SocialCampaign {
  id: string;
  orgId: string;
  robotId: string | null;
  connectorId: string | null;
  name: string;
  brief: CampaignBrief | null;
  objective: CampaignObjective;
  funnel: Record<string, unknown> | null;
  budgetModel: 'daily' | 'lifetime';
  dailyCapUsd: number | null;
  totalCapUsd: number | null;
  spentUsd: number;
  startAt: number | null;
  endAt: number | null;
  metaCampaignId: string | null;
  adsetIds: string[];
  formId: string | null;
  creativePool: PoolCreative[];
  engageSpecifics: EngageSpecifics | null;
  status: CampaignStatus;
  lastOptimizedAt: number | null;
  leaseUntil: number | null;
  createdAt: number;
  updatedAt: number;
}

const j = (v: unknown): string | null => (v == null ? null : JSON.stringify(v));
const pj = <T>(s: string | null | undefined, fallback: T): T => {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
};

function rowToCampaign(r: any): SocialCampaign {
  return {
    id: r.id, orgId: r.org_id, robotId: r.robot_id ?? null, connectorId: r.connector_id ?? null,
    name: r.name, brief: pj(r.brief, null), objective: r.objective,
    funnel: pj(r.funnel, null), budgetModel: r.budget_model === 'lifetime' ? 'lifetime' : 'daily',
    dailyCapUsd: r.daily_cap_usd ?? null, totalCapUsd: r.total_cap_usd ?? null,
    spentUsd: Number(r.spent_usd) || 0, startAt: r.start_at ?? null, endAt: r.end_at ?? null,
    metaCampaignId: r.meta_campaign_id ?? null, adsetIds: pj(r.adset_ids, []),
    formId: r.form_id ?? null, creativePool: pj(r.creative_pool, []),
    engageSpecifics: pj(r.engage_specifics, null), status: r.status,
    lastOptimizedAt: r.last_optimized_at ?? null, leaseUntil: r.lease_until ?? null,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export async function createCampaignRecord(p: {
  orgId: string; robotId?: string | null; connectorId?: string | null; name: string;
  brief?: CampaignBrief | null; objective: CampaignObjective; funnel?: Record<string, unknown> | null;
  budgetModel?: 'daily' | 'lifetime'; dailyCapUsd?: number | null; totalCapUsd?: number | null;
  startAt?: number | null; endAt?: number | null; engageSpecifics?: EngageSpecifics | null;
  status?: CampaignStatus;
}): Promise<SocialCampaign> {
  const id = randomUUID();
  const now = Date.now();
  await q(
    `INSERT INTO social_campaigns(id, org_id, robot_id, connector_id, name, brief, objective, funnel,
      budget_model, daily_cap_usd, total_cap_usd, start_at, end_at, engage_specifics, status, created_at, updated_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
    [id, p.orgId, p.robotId ?? null, p.connectorId ?? null, p.name, j(p.brief), p.objective, j(p.funnel),
      p.budgetModel ?? 'daily', p.dailyCapUsd ?? null, p.totalCapUsd ?? null, p.startAt ?? null, p.endAt ?? null,
      j(p.engageSpecifics), p.status ?? 'draft', now, now],
  );
  return (await getCampaignRecord(id))!;
}

export async function getCampaignRecord(id: string): Promise<SocialCampaign | null> {
  const r = await qOne('SELECT * FROM social_campaigns WHERE id = $1', [id]);
  return r ? rowToCampaign(r) : null;
}

export async function listCampaignRecords(orgId: string, status?: CampaignStatus): Promise<SocialCampaign[]> {
  const rows = status
    ? await q('SELECT * FROM social_campaigns WHERE org_id = $1 AND status = $2 ORDER BY created_at DESC', [orgId, status])
    : await q('SELECT * FROM social_campaigns WHERE org_id = $1 ORDER BY created_at DESC', [orgId]);
  return rows.map(rowToCampaign);
}

/** Patch selected fields (JSON columns serialized; updated_at stamped). */
export async function updateCampaignRecord(id: string, patch: Partial<{
  status: CampaignStatus; metaCampaignId: string; adsetIds: string[]; formId: string;
  creativePool: PoolCreative[]; funnel: Record<string, unknown>; spentUsd: number;
  lastOptimizedAt: number; leaseUntil: number | null; engageSpecifics: EngageSpecifics;
}>): Promise<void> {
  const sets: string[] = [];
  const vals: any[] = [];
  let i = 1;
  const map: [string, unknown, boolean][] = [
    ['status', patch.status, false],
    ['meta_campaign_id', patch.metaCampaignId, false],
    ['adset_ids', patch.adsetIds, true],
    ['form_id', patch.formId, false],
    ['creative_pool', patch.creativePool, true],
    ['funnel', patch.funnel, true],
    ['spent_usd', patch.spentUsd, false],
    ['last_optimized_at', patch.lastOptimizedAt, false],
    ['engage_specifics', patch.engageSpecifics, true],
  ];
  for (const [col, val, json] of map) {
    if (val !== undefined) { sets.push(`${col} = $${i++}`); vals.push(json ? j(val) : val); }
  }
  if ('leaseUntil' in patch) { sets.push(`lease_until = $${i++}`); vals.push(patch.leaseUntil ?? null); }
  if (!sets.length) return;
  sets.push(`updated_at = $${i++}`);
  vals.push(Date.now(), id);
  await q(`UPDATE social_campaigns SET ${sets.join(', ')} WHERE id = $${i}`, vals);
}

/** Acquire a short optimise lease; false when another tick holds it. Portable across the
 *  SQLite/PG drivers (no RETURNING — the q helper runs non-SELECTs without row output):
 *  a guarded conditional UPDATE writes a distinct expiry, then a read-back verifies we won. */
export async function acquireCampaignLease(id: string, now: number, leaseMs = 10 * 60_000): Promise<boolean> {
  // Nudge the expiry by a sub-ms-safe unique offset so two contenders write different values.
  const token = now + leaseMs + Math.floor(Math.random() * 997);
  await q(
    'UPDATE social_campaigns SET lease_until = $1 WHERE id = $2 AND (lease_until IS NULL OR lease_until < $3)',
    [token, id, now],
  );
  const r = await qOne<{ lease_until: number }>('SELECT lease_until FROM social_campaigns WHERE id = $1', [id]);
  return r != null && Number(r.lease_until) === token;
}

/** Active campaigns due a 48h optimise pass. */
export async function dueForOptimize(now: number, intervalMs = 48 * 3600_000): Promise<SocialCampaign[]> {
  const rows = await q(
    "SELECT * FROM social_campaigns WHERE status = 'active' AND (last_optimized_at IS NULL OR last_optimized_at <= $1) LIMIT 10",
    [now - intervalMs],
  );
  return rows.map(rowToCampaign);
}

// ---- campaign_ads: the attribution + rotation map ----

export interface CampaignAd {
  id: string;
  orgId: string;
  campaignId: string;
  adId: string;
  adsetId: string | null;
  postId: string | null;
  creativeRef: string | null;
  effectiveStatus: string | null;
  live: boolean;
  createdAt: number;
  updatedAt: number;
}

function rowToAd(r: any): CampaignAd {
  return {
    id: r.id, orgId: r.org_id, campaignId: r.campaign_id, adId: r.ad_id, adsetId: r.adset_id ?? null,
    postId: r.post_id ?? null, creativeRef: r.creative_ref ?? null, effectiveStatus: r.effective_status ?? null,
    live: !!r.live, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

export async function recordCampaignAd(p: { orgId: string; campaignId: string; adId: string; adsetId?: string | null; postId?: string | null; creativeRef?: string | null }): Promise<CampaignAd> {
  const id = randomUUID();
  const now = Date.now();
  await q(
    `INSERT INTO campaign_ads(id, org_id, campaign_id, ad_id, adset_id, post_id, creative_ref, live, created_at, updated_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,1,$8,$9)`,
    [id, p.orgId, p.campaignId, p.adId, p.adsetId ?? null, p.postId ?? null, p.creativeRef ?? null, now, now],
  );
  return (await qOne('SELECT * FROM campaign_ads WHERE id = $1', [id]).then((r) => (r ? rowToAd(r) : null)))!;
}

export async function listCampaignAds(campaignId: string, liveOnly = false): Promise<CampaignAd[]> {
  const rows = liveOnly
    ? await q('SELECT * FROM campaign_ads WHERE campaign_id = $1 AND live = 1', [campaignId])
    : await q('SELECT * FROM campaign_ads WHERE campaign_id = $1', [campaignId]);
  return rows.map(rowToAd);
}

export async function setAdState(adId: string, patch: { effectiveStatus?: string; live?: boolean; postId?: string }): Promise<void> {
  const sets: string[] = [];
  const vals: any[] = [];
  let i = 1;
  if (patch.effectiveStatus !== undefined) { sets.push(`effective_status = $${i++}`); vals.push(patch.effectiveStatus); }
  if (patch.live !== undefined) { sets.push(`live = $${i++}`); vals.push(patch.live ? 1 : 0); }
  if (patch.postId !== undefined) { sets.push(`post_id = $${i++}`); vals.push(patch.postId); }
  if (!sets.length) return;
  sets.push(`updated_at = $${i++}`);
  vals.push(Date.now(), adId);
  await q(`UPDATE campaign_ads SET ${sets.join(', ')} WHERE ad_id = $${i}`, vals);
}

/** Attribution: which managed campaign does this ad/post belong to? (Loop 2.) */
export async function campaignForAdOrPost(orgless: { adId?: string | null; postId?: string | null }): Promise<{ campaign: SocialCampaign; ad: CampaignAd } | null> {
  let r: any = null;
  if (orgless.adId) r = await qOne('SELECT * FROM campaign_ads WHERE ad_id = $1', [orgless.adId]);
  if (!r && orgless.postId) r = await qOne('SELECT * FROM campaign_ads WHERE post_id = $1', [orgless.postId]);
  if (!r) return null;
  const ad = rowToAd(r);
  const campaign = await getCampaignRecord(ad.campaignId);
  return campaign ? { campaign, ad } : null;
}

// ---- social_leads: Lead Ads capture ----

export async function recordLead(p: { orgId: string; campaignId?: string | null; leadgenId: string; formId?: string | null; adId?: string | null; fields?: Record<string, string> | null }): Promise<boolean> {
  try {
    await q(
      `INSERT INTO social_leads(id, org_id, campaign_id, leadgen_id, form_id, ad_id, fields, created_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [randomUUID(), p.orgId, p.campaignId ?? null, p.leadgenId, p.formId ?? null, p.adId ?? null, j(p.fields), Date.now()],
    );
    return true;
  } catch {
    return false; // unique(leadgen_id) → duplicate webhook delivery, already stored
  }
}

export async function listLeads(orgId: string, limit = 100): Promise<{ leadgenId: string; campaignId: string | null; adId: string | null; fields: Record<string, string>; createdAt: number }[]> {
  const rows = await q('SELECT * FROM social_leads WHERE org_id = $1 ORDER BY created_at DESC LIMIT $2', [orgId, limit]);
  return rows.map((r: any) => ({
    leadgenId: r.leadgen_id, campaignId: r.campaign_id ?? null, adId: r.ad_id ?? null,
    fields: pj(r.fields, {}), createdAt: r.created_at,
  }));
}
