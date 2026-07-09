import { findForProvider } from './store';

/**
 * PAID ADS write layer (Track C) — Meta Marketing API. Pure request builders (unit-tested) +
 * thin I/O. Everything is created PAUSED; going live / changing budget is gated at the tool
 * layer by the autonomy slider + spend caps + approval. Shapes verified against the Marketing
 * API (v21) docs, 2026-07. Ad-account WRITE uses the org's connected Meta ads token.
 */

const GRAPH = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || 'v21.0'}`;
const TIMEOUT_MS = 30_000;

let httpFetch: typeof fetch = fetch;
export function __setCampaignsFetch(f: typeof fetch): void {
  httpFetch = f;
}

export type Objective = 'traffic' | 'engagement' | 'leads' | 'sales' | 'awareness';
const OBJECTIVE_MAP: Record<Objective, string> = {
  traffic: 'OUTCOME_TRAFFIC',
  engagement: 'OUTCOME_ENGAGEMENT',
  leads: 'OUTCOME_LEADS',
  sales: 'OUTCOME_SALES',
  awareness: 'OUTCOME_AWARENESS',
};

export interface AdCreds {
  accessToken: string;
  accountId: string; // may or may not carry the act_ prefix
}

export interface Targeting {
  countries: string[];
  ageMin?: number;
  ageMax?: number;
  genders?: ('male' | 'female')[];
  interests?: string[]; // interest ids
  instagram?: boolean; // include Instagram placements
}

/** USD → integer minor units (Meta budgets are in the account's minor currency unit). */
export function usdToMinor(usd: number): number {
  return Math.round((Number(usd) || 0) * 100);
}

const actId = (id: string): string => (id.startsWith('act_') ? id : `act_${id}`);

// ---- pure builders ----

export function createCampaignRequest(accountId: string, p: { name: string; objective: Objective; specialAdCategories?: string[] }): { url: string; body: Record<string, any> } {
  return {
    url: `${actId(accountId)}/campaigns`,
    body: {
      name: p.name,
      objective: OBJECTIVE_MAP[p.objective],
      status: 'PAUSED',
      special_ad_categories: JSON.stringify(p.specialAdCategories ?? []),
    },
  };
}

/** Pure: a Marketing-API targeting spec (unit-tested — this is where money is wasted if wrong). */
export function buildTargeting(t: Targeting): Record<string, any> {
  const spec: Record<string, any> = { geo_locations: { countries: t.countries } };
  if (typeof t.ageMin === 'number') spec.age_min = t.ageMin;
  if (typeof t.ageMax === 'number') spec.age_max = t.ageMax;
  if (t.genders?.length) spec.genders = t.genders.map((g) => (g === 'male' ? 1 : 2));
  if (t.interests?.length) spec.flexible_spec = [{ interests: t.interests.map((id) => ({ id })) }];
  spec.publisher_platforms = t.instagram ? ['facebook', 'instagram'] : ['facebook'];
  spec.facebook_positions = ['feed'];
  if (t.instagram) spec.instagram_positions = ['stream', 'story', 'reels', 'explore'];
  return spec;
}

export function createAdSetRequest(accountId: string, p: {
  campaignId: string; name: string; dailyBudgetUsd: number; optimizationGoal?: string; billingEvent?: string;
  targeting: Targeting; startAtSec?: number; endAtSec?: number;
}): { url: string; body: Record<string, any> } {
  const body: Record<string, any> = {
    name: p.name,
    campaign_id: p.campaignId,
    daily_budget: usdToMinor(p.dailyBudgetUsd),
    billing_event: p.billingEvent || 'IMPRESSIONS',
    optimization_goal: p.optimizationGoal || 'LINK_CLICKS',
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    targeting: buildTargeting(p.targeting),
    status: 'PAUSED',
  };
  if (p.startAtSec) body.start_time = p.startAtSec;
  if (p.endAtSec) body.end_time = p.endAtSec;
  return { url: `${actId(accountId)}/adsets`, body };
}

export function createCreativeRequest(accountId: string, p: { name: string; pageId: string; instagramActorId?: string; message: string; link: string; imageHash?: string; imageUrl?: string; cta?: string }): { url: string; body: Record<string, any> } {
  const linkData: Record<string, any> = { message: p.message, link: p.link };
  if (p.imageHash) linkData.image_hash = p.imageHash;
  if (p.imageUrl) linkData.picture = p.imageUrl;
  if (p.cta) linkData.call_to_action = { type: p.cta };
  const objectStorySpec: Record<string, any> = { page_id: p.pageId, link_data: linkData };
  if (p.instagramActorId) objectStorySpec.instagram_actor_id = p.instagramActorId;
  return { url: `${actId(accountId)}/adcreatives`, body: { name: p.name, object_story_spec: objectStorySpec } };
}

export function createAdRequest(accountId: string, p: { name: string; adSetId: string; creativeId: string }): { url: string; body: Record<string, any> } {
  return {
    url: `${actId(accountId)}/ads`,
    body: { name: p.name, adset_id: p.adSetId, creative: JSON.stringify({ creative_id: p.creativeId }), status: 'PAUSED' },
  };
}

export function updateStatusRequest(objectId: string, status: 'ACTIVE' | 'PAUSED'): { url: string; body: Record<string, any> } {
  return { url: `${objectId}`, body: { status } };
}

export function updateBudgetRequest(adSetId: string, dailyBudgetUsd: number): { url: string; body: Record<string, any> } {
  return { url: `${adSetId}`, body: { daily_budget: usdToMinor(dailyBudgetUsd) } };
}

// ---- I/O ----

export async function graphPost(url: string, token: string, body: Record<string, any>): Promise<any> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await httpFetch(`${GRAPH}/${url}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok || data?.error) throw new Error(data?.error?.message || `HTTP ${res.status}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

/** Resolve the org's Meta ads token + account (from the connected ads connector). */
export async function resolveAdCreds(orgId: string, accountId?: string): Promise<AdCreds | null> {
  const c = await findForProvider(orgId, 'meta', accountId);
  if (!c) return null;
  return { accessToken: c.accessToken, accountId: c.accountId };
}
