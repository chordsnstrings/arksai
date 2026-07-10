import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { q, qOne } from '../db';
import { config } from '../config';
import {
  createCampaignRequest, createAdSetRequest, dynamicCreativeRequest, leadCreativeRequest,
  createAdRequest, createLeadFormRequest, uploadImageRequest, uploadVideoRequest,
  updateStatusRequest, graphPost, resolveAdCreds, type Objective, type Targeting,
} from '../connectors/metaCampaigns';
import { resolveSocialCreds } from './social';
import { mintRobotFileToken } from '../routes/robotFiles';
import { generateImagePool } from '../agent/social/creativeBatch';
import { autonomyPolicy } from './autonomy';
import { guardCampaignAction, recordCampaignAction } from './campaigns';

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
export async function dueForOptimize(now: number, intervalMs = 48 * 3600_000, limit = 10): Promise<SocialCampaign[]> {
  // Longest-unoptimized first so the per-tick batch bound can never starve a campaign.
  const rows = await q(
    `SELECT * FROM social_campaigns WHERE status = 'active' AND (last_optimized_at IS NULL OR last_optimized_at <= $1)
     ORDER BY COALESCE(last_optimized_at, 0) ASC, created_at ASC LIMIT $2`,
    [now - intervalMs, limit],
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

// ═══════════════════════════════════════════════════════════════════════════════════════════
// SETUP LOOP (Phase 4) — brief → objective/degrade → funnel → creative pool → assemble PAUSED
// → launch decision. Pure planners first (unit-tested), then the I/O orchestrator.
// ═══════════════════════════════════════════════════════════════════════════════════════════

/** Pure: detect Meta special-ad-category obligations from the brief's own words. */
export function detectSpecialAdCategories(brief: CampaignBrief): string[] {
  const text = `${brief.product} ${brief.topics.join(' ')}`.toLowerCase();
  const out: string[] = [];
  if (/\b(rent|rental|apartment|villa|property|real estate|housing|tenant)\b/.test(text)) out.push('HOUSING');
  if (/\b(job|jobs|hiring|recruit|career|vacanc)\b/.test(text)) out.push('EMPLOYMENT');
  if (/\b(loan|credit|mortgage|financing|refinanc)\b/.test(text)) out.push('CREDIT');
  return out;
}

export interface ObjectivePlan {
  objective: CampaignObjective;
  optimizationGoal: string;
  destinationType?: string;
  needsLeadForm: boolean;
  needsUrl: boolean;
  cta: string;
  /** Honest note when the requested outcome had to degrade (e.g. sales without a pixel). */
  degradeNote?: string;
}

/** Pure: resolve the requested outcome into an executable Meta plan, degrading honestly.
 *  `hasPixel` is false for v1 (Pixel/CAPI install is a later arc) — 'sales' therefore degrades. */
export function resolveObjectivePlan(objective: CampaignObjective, destination: string | undefined, hasPixel = false): ObjectivePlan {
  const url = destination && /^https?:\/\//.test(destination) ? destination : undefined;
  switch (objective) {
    case 'leads':
      return { objective: 'leads', optimizationGoal: 'LEAD_GENERATION', needsLeadForm: true, needsUrl: false, cta: 'SIGN_UP' };
    case 'messages': {
      const dest = destination === 'instagram_direct' ? 'INSTAGRAM_DIRECT' : 'MESSENGER';
      return { objective: 'messages', optimizationGoal: 'CONVERSATIONS', destinationType: dest, needsLeadForm: false, needsUrl: false, cta: 'MESSAGE_PAGE' };
    }
    case 'sales':
      if (!hasPixel) {
        return url
          ? { objective: 'traffic', optimizationGoal: 'LINK_CLICKS', needsLeadForm: false, needsUrl: true, cta: 'SHOP_NOW', degradeNote: 'Sales optimisation needs a Meta Pixel + Conversions API on your site — running as website traffic until that is set up.' }
          : { objective: 'leads', optimizationGoal: 'LEAD_GENERATION', needsLeadForm: true, needsUrl: false, cta: 'SIGN_UP', degradeNote: 'Sales optimisation needs a Meta Pixel and a website — collecting leads instead so you can close them directly.' };
      }
      return { objective: 'sales', optimizationGoal: 'OFFSITE_CONVERSIONS', needsLeadForm: false, needsUrl: true, cta: 'SHOP_NOW' };
    case 'engagement':
      return { objective: 'engagement', optimizationGoal: 'POST_ENGAGEMENT', needsLeadForm: false, needsUrl: false, cta: 'LEARN_MORE' };
    case 'awareness':
      return { objective: 'awareness', optimizationGoal: 'REACH', needsLeadForm: false, needsUrl: false, cta: 'LEARN_MORE' };
    default:
      return { objective: 'traffic', optimizationGoal: 'LINK_CLICKS', needsLeadForm: false, needsUrl: true, cta: 'LEARN_MORE' };
  }
}

/** Pure: 2 ad sets when the daily budget supports two healthy learning floors, else 1. */
export function adSetCountFor(dailyBudgetUsd: number): number {
  return dailyBudgetUsd >= 14 ? 2 : 1;
}

/** Pure: validate a campaign brief before any spend. Returns human-fixable problems. */
export function validateCampaignInput(p: {
  brief: CampaignBrief; objective: CampaignObjective; budgetModel: 'daily' | 'lifetime';
  budgetUsd: number; durationDays?: number;
}): string[] {
  const errs: string[] = [];
  if (!p.brief.product?.trim()) errs.push('Say what you are promoting (product/service).');
  if (!(p.budgetUsd > 0)) errs.push('Set a positive budget.');
  if (p.budgetModel === 'lifetime' && !(p.durationDays && p.durationDays >= 1)) errs.push('A total budget needs a duration (days).');
  const plan = resolveObjectivePlan(p.objective, p.brief.destination);
  if (plan.needsUrl && !(p.brief.destination && /^https?:\/\//.test(p.brief.destination))) {
    errs.push('This goal needs a website URL destination.');
  }
  const daily = p.budgetModel === 'daily' ? p.budgetUsd : p.budgetUsd / Math.max(1, p.durationDays ?? 1);
  if (daily < 3) errs.push(`Budget works out to $${daily.toFixed(2)}/day — below Meta's healthy minimum (~$3/day).`);
  return errs;
}

export interface SetupInput {
  orgId: string;
  robotId?: string | null;
  name: string;
  brief: CampaignBrief;
  objective: CampaignObjective;
  budgetModel: 'daily' | 'lifetime';
  budgetUsd: number;
  durationDays?: number;
  engageSpecifics?: EngageSpecifics | null;
  /** Autonomy slider value (≥80 = Autopilot auto-launches within caps). */
  autonomyLevel: number;
  /** Hard ad-spend cap (USD/day) — launch is blocked above it at ANY autonomy. */
  adDailyCapUsd: number;
  /** Hard creative-generation spend cap (USD), separate from ad spend. */
  generationCapUsd?: number;
  accountId?: string;
  signal?: AbortSignal;
  onProgress?: (line: string) => void;
  addCost?: (usd: number) => void;
}

export interface SetupResult {
  ok: boolean;
  campaignId?: string;
  status?: CampaignStatus;
  launched?: boolean;
  detail: string;
  degradeNote?: string;
  generatedCreatives?: number;
  generationSpendUsd?: number;
}

const dailyOf = (p: { budgetModel: 'daily' | 'lifetime'; budgetUsd: number; durationDays?: number }): number =>
  p.budgetModel === 'daily' ? p.budgetUsd : p.budgetUsd / Math.max(1, p.durationDays ?? 1);

/** The whole setup loop. Assembles EVERYTHING PAUSED; only the launch step can turn spend on,
 *  and only within the cap (+ approval unless Autopilot). Never throws — honest SetupResult. */
export async function setupManagedCampaign(input: SetupInput, repoDir: string): Promise<SetupResult> {
  const say = input.onProgress ?? (() => {});
  const signal = input.signal ?? new AbortController().signal;
  try {
    // 1) Validate + resolve the outcome plan.
    const errs = validateCampaignInput(input);
    if (errs.length) return { ok: false, detail: `Fix before launch: ${errs.join(' ')}` };
    const plan = resolveObjectivePlan(input.objective, input.brief.destination);
    const specialCats = detectSpecialAdCategories(input.brief);
    const daily = dailyOf(input);
    if (daily > input.adDailyCapUsd) {
      return { ok: false, detail: `Budget $${daily.toFixed(2)}/day exceeds the robot's $${input.adDailyCapUsd}/day cap — raise the cap or lower the budget.` };
    }

    // 2) Credentials.
    const ad = await resolveAdCreds(input.orgId, input.accountId);
    if (!ad) return { ok: false, detail: 'No Meta ad account is connected (Settings → Connections).' };
    const social = await resolveSocialCreds(input.orgId);
    if (!social?.pageId) return { ok: false, detail: 'Connect the Facebook Page (the ads run as the Page).' };
    if (plan.needsLeadForm && !social.pageToken) return { ok: false, detail: 'Lead forms need the connected Page token.' };
    const wantsInstagram = !!social.igUserId;

    // 3) Durable record first (so a crash mid-setup is resumable/visible).
    const rec = await createCampaignRecord({
      orgId: input.orgId, robotId: input.robotId ?? null, name: input.name,
      brief: input.brief, objective: plan.objective,
      funnel: { optimizationGoal: plan.optimizationGoal, destinationType: plan.destinationType, cta: plan.cta, specialCats, degraded: plan.degradeNote ?? null },
      budgetModel: input.budgetModel, dailyCapUsd: input.adDailyCapUsd,
      totalCapUsd: input.budgetModel === 'lifetime' ? input.budgetUsd : null,
      startAt: Date.now(),
      endAt: input.durationDays ? Date.now() + input.durationDays * 86_400_000 : null,
      engageSpecifics: input.engageSpecifics ?? null, status: 'generating',
    });

    // 4) Creative pool (budget-capped).
    say('Generating the creative pool…');
    const genCap = input.generationCapUsd ?? 3;
    const batch = await generateImagePool(input.brief, input.brief.imageCount ?? 30, repoDir, signal, {
      maxUsd: genCap, accent: input.brief.brand?.accent, logoAbsPath: input.brief.brand?.logo ?? null,
      onProgress: (d, t) => say(`Creatives: background ${d}/${t}`),
    });
    input.addCost?.(batch.spentUsd);
    if (!batch.pool.length) {
      await updateCampaignRecord(rec.id, { status: 'failed' });
      return { ok: false, campaignId: rec.id, detail: `Creative generation produced nothing: ${batch.errors.join('; ') || 'unknown error'}` };
    }

    // 5) Upload images → image_hash (chunk of the pool that made it).
    say(`Uploading ${batch.pool.length} creatives to the ad account…`);
    const pool: PoolCreative[] = [];
    for (const c of batch.pool) {
      try {
        const b64 = fs.readFileSync(c.ref).toString('base64');
        const up = uploadImageRequest(ad.accountId, b64);
        const res = await graphPost(up.url, ad.accessToken, up.body);
        const first = res?.images && Object.values<any>(res.images)[0];
        pool.push({ ...c, imageHash: first?.hash ? String(first.hash) : undefined });
      } catch (e: any) {
        pool.push({ ...c }); // keep in the pool without a hash; rotation skips it
      }
    }
    await updateCampaignRecord(rec.id, { creativePool: pool });

    // 6) Lead form when the funnel needs one.
    let formId: string | undefined;
    if (plan.needsLeadForm) {
      say('Creating the Instant Form…');
      const lf = createLeadFormRequest(social.pageId, {
        name: `${input.name} — lead form`,
        fields: ['FULL_NAME', 'PHONE', 'EMAIL'],
        privacyPolicyUrl: input.brief.destination && /^https?:\/\//.test(input.brief.destination)
          ? input.brief.destination
          : `${config.publicBaseUrl}/privacy`,
      });
      const res = await graphPost(lf.url, social.pageToken, lf.body);
      formId = String(res.id);
      await updateCampaignRecord(rec.id, { formId });
    }

    // 7) Assemble — campaign (CBO) + ad sets + Dynamic Creative ads, ALL PAUSED.
    say('Assembling the campaign (paused)…');
    const c = createCampaignRequest(ad.accountId, {
      name: input.name, objective: plan.objective as Objective, specialAdCategories: specialCats,
      ...(input.budgetModel === 'lifetime'
        ? { lifetimeBudgetUsd: input.budgetUsd, stopTimeSec: Math.floor((Date.now() + (input.durationDays ?? 7) * 86_400_000) / 1000) }
        : { dailyBudgetUsd: input.budgetUsd }),
    });
    const campaign = await graphPost(c.url, ad.accessToken, c.body);
    const metaCampaignId = String(campaign.id);

    const targeting: Targeting = {
      countries: input.brief.audience?.countries?.length ? input.brief.audience.countries : ['AE'],
      ageMin: input.brief.audience?.ageMin, ageMax: input.brief.audience?.ageMax,
      genders: input.brief.audience?.genders,
      interests: input.brief.audience?.broad === false ? input.brief.audience?.interests : undefined,
      instagram: wantsInstagram,
    };
    const nAdSets = adSetCountFor(daily);
    const adsetIds: string[] = [];
    const usable = pool.filter((p) => p.imageHash);
    for (let i = 0; i < nAdSets; i++) {
      const s = createAdSetRequest(ad.accountId, {
        campaignId: metaCampaignId, name: `${input.name} — ad set ${i + 1}`,
        targeting, dynamicCreative: true,
        optimizationGoal: plan.optimizationGoal,
        promotedPageId: plan.needsLeadForm || plan.destinationType ? social.pageId : undefined,
        destinationType: plan.destinationType,
        endAtSec: input.durationDays ? Math.floor((Date.now() + input.durationDays * 86_400_000) / 1000) : undefined,
      });
      const adset = await graphPost(s.url, ad.accessToken, s.body);
      adsetIds.push(String(adset.id));

      // Slice the pool across ad sets: up to 8 images + 5 headlines/bodies each.
      const slice = usable.filter((_, idx) => idx % nAdSets === i).slice(0, 8);
      if (!slice.length) continue;
      const heads = [...new Set(slice.map((p) => p.headline).filter(Boolean))].slice(0, 5) as string[];
      const bodies = [...new Set(slice.map((p) => p.body).filter(Boolean))].slice(0, 5) as string[];
      const cr = plan.needsLeadForm && formId && slice.length === 1
        ? leadCreativeRequest(ad.accountId, { name: `${input.name} — creative ${i + 1}`, pageId: social.pageId, instagramActorId: social.igUserId || undefined, message: bodies[0] ?? input.brief.product, imageHash: slice[0].imageHash, leadFormId: formId, link: `${config.publicBaseUrl}` })
        : dynamicCreativeRequest(ad.accountId, {
            name: `${input.name} — creative ${i + 1}`, pageId: social.pageId, instagramActorId: social.igUserId || undefined,
            feed: {
              imageHashes: slice.map((p) => p.imageHash!) ,
              bodies: bodies.length ? bodies : [input.brief.product],
              titles: heads.length ? heads : [input.brief.product],
              linkUrl: plan.needsUrl ? input.brief.destination : plan.needsLeadForm ? undefined : config.publicBaseUrl,
              cta: plan.cta,
            },
          });
      const creative = await graphPost(cr.url, ad.accessToken, cr.body);
      const a = createAdRequest(ad.accountId, { name: `${input.name} — ad ${i + 1}`, adSetId: String(adset.id), creativeId: String(creative.id) });
      const adObj = await graphPost(a.url, ad.accessToken, a.body);
      await recordCampaignAd({ orgId: input.orgId, campaignId: rec.id, adId: String(adObj.id), adsetId: String(adset.id), creativeRef: slice.map((p) => p.ref).join(',') });
      slice.forEach((p) => { p.used = true; p.live = true; p.adId = String(adObj.id); });
    }
    await updateCampaignRecord(rec.id, { metaCampaignId, adsetIds, creativePool: pool, status: 'pending_approval' });
    await recordCampaignAction({ orgId: input.orgId, robotId: input.robotId ?? null, action: 'create_campaign', objectIds: JSON.stringify({ campaignId: metaCampaignId, adsetIds }), requestedBudgetUsd: daily, status: 'executed', detail: input.name });

    // 8) Launch decision — Autopilot within the cap, else wait for approval.
    const policy = autonomyPolicy(input.autonomyLevel);
    const guard = guardCampaignAction(
      { action: 'launch', approved: policy.autoLaunch, requestedDailyUsd: daily, wantsInstagram, hasPageAndIg: wantsInstagram ? !!social.igUserId : undefined },
      { dailyCapUsd: input.adDailyCapUsd, requireApproval: !policy.autoLaunch },
    );
    if (policy.autoLaunch && guard.ok) {
      say('Launching (autopilot, within your cap)…');
      await graphPost(updateStatusRequest(metaCampaignId, 'ACTIVE').url, ad.accessToken, updateStatusRequest(metaCampaignId, 'ACTIVE').body);
      for (const asid of adsetIds) {
        const u = updateStatusRequest(asid, 'ACTIVE');
        await graphPost(u.url, ad.accessToken, u.body);
      }
      await updateCampaignRecord(rec.id, { status: 'active' });
      await recordCampaignAction({ orgId: input.orgId, robotId: input.robotId ?? null, action: 'launch', objectIds: JSON.stringify({ campaignId: metaCampaignId }), requestedBudgetUsd: daily, status: 'executed', detail: 'autopilot launch within cap' });
      return { ok: true, campaignId: rec.id, status: 'active', launched: true, degradeNote: plan.degradeNote, generatedCreatives: pool.length, generationSpendUsd: batch.spentUsd, detail: `Live. ${pool.length} creatives in the pool, ${nAdSets} ad set(s), $${daily.toFixed(2)}/day. Ads enter Meta review; the 48h loop takes it from here.` };
    }
    return { ok: true, campaignId: rec.id, status: 'pending_approval', launched: false, degradeNote: plan.degradeNote, generatedCreatives: pool.length, generationSpendUsd: batch.spentUsd, detail: `Assembled PAUSED (${pool.length} creatives, ${nAdSets} ad set(s), $${daily.toFixed(2)}/day). ${guard.ok ? 'Awaiting your approval to launch.' : `Not launched: ${guard.reason}`}` };
  } catch (e: any) {
    return { ok: false, detail: `Setup failed: ${e?.message ?? e}` };
  }
}

/** Approve + launch a pending campaign (the owner's tap / APPROVE reply). */
export async function launchManagedCampaign(campaignId: string, approvedBy: string): Promise<{ ok: boolean; detail: string }> {
  const rec = await getCampaignRecord(campaignId);
  if (!rec) return { ok: false, detail: 'Unknown campaign.' };
  if (rec.status === 'active') return { ok: true, detail: 'Already live.' };
  if (!rec.metaCampaignId) return { ok: false, detail: 'Campaign was never assembled.' };
  const ad = await resolveAdCreds(rec.orgId);
  if (!ad) return { ok: false, detail: 'Meta ad account is no longer connected.' };
  try {
    const u = updateStatusRequest(rec.metaCampaignId, 'ACTIVE');
    await graphPost(u.url, ad.accessToken, u.body);
    for (const asid of rec.adsetIds) {
      const su = updateStatusRequest(asid, 'ACTIVE');
      await graphPost(su.url, ad.accessToken, su.body);
    }
    await updateCampaignRecord(rec.id, { status: 'active' });
    await recordCampaignAction({ orgId: rec.orgId, robotId: rec.robotId, action: 'launch', objectIds: JSON.stringify({ campaignId: rec.metaCampaignId }), status: 'executed', detail: `approved by ${approvedBy}` });
    return { ok: true, detail: 'Campaign is live. Ads enter Meta review.' };
  } catch (e: any) {
    return { ok: false, detail: `Launch failed: ${e?.message ?? e}` };
  }
}

/** Pause a managed campaign (always allowed — stops spend). */
export async function pauseManagedCampaign(campaignId: string, reason: string): Promise<{ ok: boolean; detail: string }> {
  const rec = await getCampaignRecord(campaignId);
  if (!rec?.metaCampaignId) return { ok: false, detail: 'Unknown or unassembled campaign.' };
  const ad = await resolveAdCreds(rec.orgId);
  if (!ad) return { ok: false, detail: 'Meta ad account is no longer connected.' };
  try {
    const u = updateStatusRequest(rec.metaCampaignId, 'PAUSED');
    await graphPost(u.url, ad.accessToken, u.body);
    await updateCampaignRecord(rec.id, { status: 'paused' });
    await recordCampaignAction({ orgId: rec.orgId, robotId: rec.robotId, action: 'pause', objectIds: JSON.stringify({ campaignId: rec.metaCampaignId }), status: 'executed', detail: reason });
    return { ok: true, detail: 'Paused — spend stopped.' };
  } catch (e: any) {
    return { ok: false, detail: `Pause failed: ${e?.message ?? e}` };
  }
}

// mintRobotFileToken + uploadVideoRequest are used by the agent-driven video-pool path
// (videos join the pool via public URLs); referenced here so the wiring stays in one module.
export const __videoPoolHelpers = { mintRobotFileToken, uploadVideoRequest };

// ═══════════════════════════════════════════════════════════════════════════════════════════
// OPTIMISE LOOP (Phase 5) — every 48h per active campaign: status-poll → significance-gated
// pause/rotate decisions → CBO-friendly budget behaviour → lifecycle. Pure decisions first.
// ═══════════════════════════════════════════════════════════════════════════════════════════

export interface AdMetrics {
  adId: string;
  spend: number;
  impressions: number;
  ctr: number; // %
  frequency: number;
  results: number;
  costPerResult: number | null;
}

export interface OptimizeDecision {
  /** Ads to pause, with the plain-English reason. NEVER empties a campaign. */
  pause: { adId: string; reason: string }[];
  /** True → rebuild the Dynamic Creative ad with fresh pool creatives. */
  rotate: boolean;
  notes: string[];
}

/** Pure, unit-tested: the 48h rebalance decision. Significance-gated (never judges noise or
 *  ads still in learning), pauses ADS not ad sets (no learning resets — CBO shifts budget),
 *  and flags fatigue (freq>3.5 + weak CTR) for rotation. */
export function decideOptimizations(
  ads: AdMetrics[],
  opts: { minSpendUsd?: number; minImpressions?: number } = {},
): OptimizeDecision {
  const minSpend = opts.minSpendUsd ?? 5;
  const minImp = opts.minImpressions ?? 1000;
  const out: OptimizeDecision = { pause: [], rotate: false, notes: [] };
  const judged = ads.filter((a) => a.spend >= minSpend && a.impressions >= minImp);
  const skipped = ads.length - judged.length;
  if (skipped > 0) out.notes.push(`${skipped} ad(s) below the significance floor ($${minSpend}/${minImp} imp) — left to learn.`);
  if (judged.length === 0) return out;

  // Losers: clear cost-per-result laggards vs the best performer (needs ≥2 judged ads).
  const withResults = judged.filter((a) => a.results > 0 && a.costPerResult != null);
  if (withResults.length >= 2) {
    const best = Math.min(...withResults.map((a) => a.costPerResult!));
    for (const a of withResults) {
      if (a.costPerResult! > best * 2.5) out.pause.push({ adId: a.adId, reason: `cost/result $${a.costPerResult} vs best $${best}` });
    }
  } else if (judged.length >= 2 && withResults.length === 0) {
    // No results anywhere: pause only a CTR collapse vs a working sibling.
    const bestCtr = Math.max(...judged.map((a) => a.ctr));
    if (bestCtr >= 1) {
      for (const a of judged) {
        if (a.ctr < 0.4) out.pause.push({ adId: a.adId, reason: `CTR ${a.ctr}% vs best ${bestCtr}%` });
      }
    }
  }

  // Fatigue → rotation (fresh creatives), even when nothing is paused.
  const fatigued = judged.filter((a) => a.frequency > 3.5 && a.ctr < 0.8);
  if (fatigued.length) {
    out.rotate = true;
    out.notes.push(`${fatigued.length} ad(s) fatigued (frequency >3.5, weak CTR) — rotating fresh creatives.`);
  }
  if (out.pause.length) out.rotate = true;

  // Never pause everything — a campaign must keep at least one live ad.
  if (out.pause.length >= ads.length) {
    out.pause = out.pause.slice(0, ads.length - 1);
    out.notes.push('kept one ad live (never empty the campaign)');
  }
  return out;
}

/** Per-ad insights for OUR ads (last 7 days) via the Graph batch path. */
async function fetchAdMetrics(token: string, accountId: string, adIds: string[]): Promise<AdMetrics[]> {
  if (!adIds.length) return [];
  const { graphGet } = await import('../connectors/metaCampaigns');
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  const until = new Date(Date.now() - 0).toISOString().slice(0, 10);
  const acct = accountId.startsWith('act_') ? accountId : `act_${accountId}`;
  const qstr = `${acct}/insights?level=ad&fields=ad_id,spend,impressions,clicks,ctr,frequency,actions&time_range=${encodeURIComponent(JSON.stringify({ since, until }))}&limit=200`;
  const data = await graphGet(qstr, token);
  const rows: any[] = Array.isArray(data?.data) ? data.data : [];
  const mine = new Set(adIds);
  return rows
    .filter((r) => mine.has(String(r.ad_id)))
    .map((r) => {
      const spend = Number(r.spend) || 0;
      const results = (Array.isArray(r.actions) ? r.actions : [])
        .filter((a: any) => /lead|purchase|messaging_conversation_started/i.test(String(a.action_type)))
        .reduce((s: number, a: any) => s + (Number(a.value) || 0), 0);
      return {
        adId: String(r.ad_id),
        spend,
        impressions: Number(r.impressions) || 0,
        ctr: Number(r.ctr) || 0,
        frequency: Number(r.frequency) || 0,
        results,
        costPerResult: results ? Math.round((spend / results) * 100) / 100 : null,
      };
    });
}

/** One campaign's optimise pass. Exported for tests via the early-return paths. */
export async function optimizeCampaign(rec: SocialCampaign, now: number): Promise<string> {
  const ad = await resolveAdCreds(rec.orgId);
  if (!ad) {
    // Best-effort Meta-side pause; ALWAYS mark paused + stamp the bookkeeping locally so a
    // dead campaign can't spin the tick forever.
    await pauseManagedCampaign(rec.id, 'Meta connection lost — re-authorize in Settings → Connections').catch(() => {});
    await updateCampaignRecord(rec.id, { status: 'paused', lastOptimizedAt: now, leaseUntil: null });
    return 'connection lost → paused';
  }
  const notes: string[] = [];
  const ads = await listCampaignAds(rec.id, true);
  const pool = [...rec.creativePool];

  // 1) Review/rejection poll — a DISAPPROVED ad is dead weight; swap it out.
  try {
    const { fetchAdStatuses } = await import('../connectors/metaCampaigns');
    const statuses = await fetchAdStatuses(ad.accessToken, ads.map((a) => a.adId));
    for (const a of ads) {
      const st = statuses[a.adId];
      if (!st) continue;
      await setAdState(a.adId, { effectiveStatus: st.effectiveStatus, postId: st.postId });
      if (st.effectiveStatus === 'DISAPPROVED' || st.effectiveStatus === 'WITH_ISSUES') {
        a.live = false;
        await setAdState(a.adId, { live: false });
        notes.push(`ad ${a.adId} ${st.effectiveStatus.toLowerCase()}${st.reviewFeedback ? ` (${st.reviewFeedback.slice(0, 120)})` : ''} — replacing`);
      }
    }
  } catch (e: any) {
    notes.push(`status poll failed: ${e?.message ?? e}`);
  }

  // 2) Performance decisions (significance-gated).
  let decision: OptimizeDecision = { pause: [], rotate: false, notes: [] };
  try {
    const liveIds = ads.filter((a) => a.live).map((a) => a.adId);
    const metrics = await fetchAdMetrics(ad.accessToken, ad.accountId, liveIds);
    // Spend tracking + lifecycle first.
    const spent = Math.round(metrics.reduce((s, m) => s + m.spend, 0) * 100) / 100;
    if (spent > 0) await updateCampaignRecord(rec.id, { spentUsd: Math.max(rec.spentUsd, spent) });
    if (rec.totalCapUsd && Math.max(rec.spentUsd, spent) >= rec.totalCapUsd) {
      await pauseManagedCampaign(rec.id, `total budget $${rec.totalCapUsd} reached`);
      await updateCampaignRecord(rec.id, { status: 'completed' });
      return 'total budget reached → completed';
    }
    if (rec.endAt && now >= rec.endAt) {
      await pauseManagedCampaign(rec.id, 'scheduled end date reached');
      await updateCampaignRecord(rec.id, { status: 'completed' });
      return 'end date reached → completed';
    }
    decision = decideOptimizations(metrics);
    notes.push(...decision.notes);
    for (const p of decision.pause) {
      const u = updateStatusRequest(p.adId, 'PAUSED');
      await graphPost(u.url, ad.accessToken, u.body).catch(() => {});
      await setAdState(p.adId, { live: false });
      pool.forEach((c) => { if (c.adId === p.adId) c.live = false; });
      notes.push(`paused ${p.adId}: ${p.reason}`);
      await recordCampaignAction({ orgId: rec.orgId, robotId: rec.robotId, action: 'pause', objectIds: JSON.stringify({ adId: p.adId }), status: 'executed', detail: p.reason });
    }
  } catch (e: any) {
    notes.push(`insights failed: ${e?.message ?? e}`);
  }

  // 3) Rotation — rebuild the DCO ad on each ad set with fresh (never-used) hashed creatives.
  const needsRotation = decision.rotate || ads.some((a) => !a.live);
  if (needsRotation) {
    const social = await resolveSocialCreds(rec.orgId);
    const fresh = pool.filter((c) => c.imageHash && !c.used);
    if (!social?.pageId) {
      notes.push('rotation skipped: Page connection missing');
    } else if (!fresh.length) {
      notes.push('pool exhausted — no fresh creatives to rotate in (generate more via the campaign brief)');
    } else {
      for (const adsetId of rec.adsetIds) {
        const slice = fresh.splice(0, 8);
        if (!slice.length) break;
        try {
          const heads = [...new Set(slice.map((c) => c.headline).filter(Boolean))].slice(0, 5) as string[];
          const bodies = [...new Set(slice.map((c) => c.body).filter(Boolean))].slice(0, 5) as string[];
          const funnel = (rec.funnel ?? {}) as any;
          const cr = dynamicCreativeRequest(ad.accountId, {
            name: `${rec.name} — refresh ${new Date(now).toISOString().slice(0, 10)}`,
            pageId: social.pageId, instagramActorId: social.igUserId || undefined,
            feed: {
              imageHashes: slice.map((c) => c.imageHash!),
              bodies: bodies.length ? bodies : [rec.brief?.product ?? rec.name],
              titles: heads.length ? heads : [rec.brief?.product ?? rec.name],
              linkUrl: rec.brief?.destination && /^https?:\/\//.test(rec.brief.destination) ? rec.brief.destination : config.publicBaseUrl,
              cta: typeof funnel.cta === 'string' ? funnel.cta : 'LEARN_MORE',
            },
          });
          const creative = await graphPost(cr.url, ad.accessToken, cr.body);
          const na = createAdRequest(ad.accountId, { name: `${rec.name} — rotated ad`, adSetId: adsetId, creativeId: String(creative.id) });
          const newAd = await graphPost(na.url, ad.accessToken, na.body);
          const act = updateStatusRequest(String(newAd.id), 'ACTIVE');
          await graphPost(act.url, ad.accessToken, act.body).catch(() => {});
          await recordCampaignAd({ orgId: rec.orgId, campaignId: rec.id, adId: String(newAd.id), adsetId, creativeRef: slice.map((c) => c.ref).join(',') });
          slice.forEach((c) => { c.used = true; c.live = true; c.adId = String(newAd.id); });
          notes.push(`rotated ${slice.length} fresh creative(s) into ad set ${adsetId}`);
        } catch (e: any) {
          notes.push(`rotation on ${adsetId} failed: ${e?.message ?? e}`);
        }
      }
    }
  }

  const summary = notes.length ? notes.join('; ') : 'healthy — no changes needed';
  await updateCampaignRecord(rec.id, {
    creativePool: pool, lastOptimizedAt: now, leaseUntil: null,
    funnel: { ...(rec.funnel ?? {}), lastOptimizeNote: summary, lastOptimizeAt: now },
  });
  return summary;
}

/** Scheduler entry point (next to publishDueSocialPosts): optimise every due campaign. */
export async function optimizeDueCampaigns(now = Date.now()): Promise<number> {
  let n = 0;
  const due = await dueForOptimize(now).catch(() => [] as SocialCampaign[]);
  for (const rec of due) {
    if (!(await acquireCampaignLease(rec.id, now))) continue;
    try {
      const summary = await optimizeCampaign(rec, now);
      console.log(`[campaign-bot] optimised "${rec.name}": ${summary}`);
      n++;
    } catch (e: any) {
      console.error(`[campaign-bot] optimise ${rec.id} failed:`, e?.message ?? e);
      await updateCampaignRecord(rec.id, { lastOptimizedAt: now, leaseUntil: null }).catch(() => {});
    }
  }
  return n;
}
