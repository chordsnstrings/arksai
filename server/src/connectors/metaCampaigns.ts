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

export function createCampaignRequest(accountId: string, p: {
  name: string; objective: Objective; specialAdCategories?: string[];
  /** Campaign-level (CBO/Advantage+) budget — Meta then shifts spend to the winning ad sets
   *  automatically, which the 48h loop prefers over manual ad-set edits (no learning resets). */
  dailyBudgetUsd?: number; lifetimeBudgetUsd?: number; stopTimeSec?: number;
}): { url: string; body: Record<string, any> } {
  const body: Record<string, any> = {
    name: p.name,
    objective: OBJECTIVE_MAP[p.objective],
    status: 'PAUSED',
    special_ad_categories: JSON.stringify(p.specialAdCategories ?? []),
  };
  if (p.lifetimeBudgetUsd) {
    body.lifetime_budget = usdToMinor(p.lifetimeBudgetUsd);
    body.bid_strategy = 'LOWEST_COST_WITHOUT_CAP';
    if (p.stopTimeSec) body.stop_time = p.stopTimeSec;
  } else if (p.dailyBudgetUsd) {
    body.daily_budget = usdToMinor(p.dailyBudgetUsd);
    body.bid_strategy = 'LOWEST_COST_WITHOUT_CAP';
  }
  return { url: `${actId(accountId)}/campaigns`, body };
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
  campaignId: string; name: string; dailyBudgetUsd?: number; lifetimeBudgetUsd?: number;
  optimizationGoal?: string; billingEvent?: string;
  targeting: Targeting; startAtSec?: number; endAtSec?: number;
  /** Dynamic Creative ad set (pairs with dynamicCreativeRequest). */
  dynamicCreative?: boolean;
  /** Required for LEAD_GENERATION / CONVERSATIONS goals. */
  promotedPageId?: string;
  /** Messages destination: MESSENGER | INSTAGRAM_DIRECT. */
  destinationType?: string;
}): { url: string; body: Record<string, any> } {
  const body: Record<string, any> = {
    name: p.name,
    campaign_id: p.campaignId,
    billing_event: p.billingEvent || 'IMPRESSIONS',
    optimization_goal: p.optimizationGoal || 'LINK_CLICKS',
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    targeting: buildTargeting(p.targeting),
    status: 'PAUSED',
  };
  // Lifetime budget requires an end_time; daily is the default model.
  if (p.lifetimeBudgetUsd) body.lifetime_budget = usdToMinor(p.lifetimeBudgetUsd);
  else if (p.dailyBudgetUsd) body.daily_budget = usdToMinor(p.dailyBudgetUsd);
  if (p.dynamicCreative) body.is_dynamic_creative = true;
  if (p.promotedPageId) body.promoted_object = JSON.stringify({ page_id: p.promotedPageId });
  if (p.destinationType) body.destination_type = p.destinationType;
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

/** A creative that PROMOTES AN EXISTING post (a "boost") — references the post by its
 *  object_story_id (`<pageId>_<postId>`) instead of composing new link_data. */
export function boostCreativeRequest(accountId: string, p: { name: string; objectStoryId: string; instagramActorId?: string }): { url: string; body: Record<string, any> } {
  const body: Record<string, any> = { name: p.name, object_story_id: p.objectStoryId };
  if (p.instagramActorId) body.instagram_actor_id = p.instagramActorId;
  return { url: `${actId(accountId)}/adcreatives`, body };
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

// ---- Campaign-bot builders (uploads, lead forms, Dynamic Creative, video, status) ----

/** Upload an image to the ad account → image_hash. Body carries base64 `bytes`. */
export function uploadImageRequest(accountId: string, base64: string): { url: string; body: Record<string, any> } {
  return { url: `${actId(accountId)}/adimages`, body: { bytes: base64 } };
}

/** Upload a video by PUBLIC url (we host workspace files via the robot-file mint) → video id. */
export function uploadVideoRequest(accountId: string, fileUrl: string, name?: string): { url: string; body: Record<string, any> } {
  const body: Record<string, any> = { file_url: fileUrl };
  if (name) body.name = name;
  return { url: `${actId(accountId)}/advideos`, body };
}

/** An Instant Form (Lead Ads) on the PAGE (page token, not the ads token). `fields` are the
 *  standard question types to collect. Meta requires a privacy-policy URL. */
export function createLeadFormRequest(pageId: string, p: { name: string; fields: ('FULL_NAME' | 'EMAIL' | 'PHONE' | 'CITY' | 'JOB_TITLE' | 'COMPANY_NAME')[]; privacyPolicyUrl: string; thankYouMessage?: string }): { url: string; body: Record<string, any> } {
  return {
    url: `${pageId}/leadgen_forms`,
    body: {
      name: p.name,
      questions: JSON.stringify(p.fields.map((type) => ({ type }))),
      privacy_policy: JSON.stringify({ url: p.privacyPolicyUrl }),
      ...(p.thankYouMessage
        ? { thank_you_page: JSON.stringify({ title: 'Thank you', body: p.thankYouMessage }) }
        : {}),
    },
  };
}

export interface AssetFeed {
  imageHashes?: string[];
  videoIds?: string[];
  bodies: string[]; // primary texts
  titles: string[]; // headlines
  descriptions?: string[];
  linkUrl?: string;
  cta?: string; // e.g. LEARN_MORE / SIGN_UP / SHOP_NOW / MESSAGE_PAGE
}

/** Dynamic Creative: one creative carrying a POOL of assets (Meta auto-combines + optimises).
 *  Caps follow Meta's limits: ≤10 images/videos, ≤5 bodies/titles/descriptions. The paired
 *  ad set must set `is_dynamic_creative: true`. */
export function dynamicCreativeRequest(accountId: string, p: { name: string; pageId: string; instagramActorId?: string; feed: AssetFeed }): { url: string; body: Record<string, any> } {
  const f = p.feed;
  const spec: Record<string, any> = {
    bodies: f.bodies.slice(0, 5).map((text) => ({ text })),
    titles: f.titles.slice(0, 5).map((text) => ({ text })),
    ad_formats: [f.videoIds?.length ? 'SINGLE_VIDEO' : 'SINGLE_IMAGE'],
    call_to_action_types: [f.cta || 'LEARN_MORE'],
  };
  if (f.imageHashes?.length) spec.images = f.imageHashes.slice(0, 10).map((hash) => ({ hash }));
  if (f.videoIds?.length) spec.videos = f.videoIds.slice(0, 10).map((video_id) => ({ video_id }));
  if (f.descriptions?.length) spec.descriptions = f.descriptions.slice(0, 5).map((text) => ({ text }));
  if (f.linkUrl) spec.link_urls = [{ website_url: f.linkUrl }];
  const objectStorySpec: Record<string, any> = { page_id: p.pageId };
  if (p.instagramActorId) objectStorySpec.instagram_actor_id = p.instagramActorId;
  return {
    url: `${actId(accountId)}/adcreatives`,
    body: { name: p.name, object_story_spec: JSON.stringify(objectStorySpec), asset_feed_spec: JSON.stringify(spec) },
  };
}

/** A single VIDEO ad creative (object_story_spec.video_data). */
export function videoCreativeRequest(accountId: string, p: { name: string; pageId: string; instagramActorId?: string; videoId: string; thumbnailUrl: string; message: string; title?: string; link?: string; cta?: string; leadFormId?: string }): { url: string; body: Record<string, any> } {
  const videoData: Record<string, any> = { video_id: p.videoId, image_url: p.thumbnailUrl, message: p.message };
  if (p.title) videoData.title = p.title;
  if (p.cta || p.link || p.leadFormId) {
    videoData.call_to_action = {
      type: p.cta || 'LEARN_MORE',
      value: p.leadFormId ? { lead_gen_form_id: p.leadFormId } : { link: p.link },
    };
  }
  const objectStorySpec: Record<string, any> = { page_id: p.pageId, video_data: videoData };
  if (p.instagramActorId) objectStorySpec.instagram_actor_id = p.instagramActorId;
  return { url: `${actId(accountId)}/adcreatives`, body: { name: p.name, object_story_spec: objectStorySpec } };
}

/** A LEAD-ADS image creative: link_data whose CTA carries the Instant Form id. */
export function leadCreativeRequest(accountId: string, p: { name: string; pageId: string; instagramActorId?: string; message: string; imageHash?: string; imageUrl?: string; leadFormId: string; cta?: string; link: string }): { url: string; body: Record<string, any> } {
  const linkData: Record<string, any> = {
    message: p.message,
    link: p.link,
    call_to_action: { type: p.cta || 'SIGN_UP', value: { lead_gen_form_id: p.leadFormId } },
  };
  if (p.imageHash) linkData.image_hash = p.imageHash;
  if (p.imageUrl) linkData.picture = p.imageUrl;
  const objectStorySpec: Record<string, any> = { page_id: p.pageId, link_data: linkData };
  if (p.instagramActorId) objectStorySpec.instagram_actor_id = p.instagramActorId;
  return { url: `${actId(accountId)}/adcreatives`, body: { name: p.name, object_story_spec: objectStorySpec } };
}

/** Poll review/delivery state for a set of ads: GET ?ids=…&fields=effective_status,… */
export function adStatusUrl(adIds: string[]): string {
  return `?ids=${adIds.map(encodeURIComponent).join(',')}&fields=effective_status,ad_review_feedback,creative{effective_object_story_id}`;
}

export async function fetchAdStatuses(token: string, adIds: string[]): Promise<Record<string, { effectiveStatus: string; reviewFeedback?: string; postId?: string }>> {
  if (!adIds.length) return {};
  const out: Record<string, { effectiveStatus: string; reviewFeedback?: string; postId?: string }> = {};
  // Chunk to stay well under URL limits.
  for (let i = 0; i < adIds.length; i += 40) {
    const data = await graphGet(adStatusUrl(adIds.slice(i, i + 40)), token);
    for (const [id, v] of Object.entries<any>(data ?? {})) {
      out[id] = {
        effectiveStatus: String(v?.effective_status ?? ''),
        reviewFeedback: v?.ad_review_feedback ? JSON.stringify(v.ad_review_feedback).slice(0, 400) : undefined,
        postId: v?.creative?.effective_object_story_id ? String(v.creative.effective_object_story_id) : undefined,
      };
    }
  }
  return out;
}

// ---- I/O ----

export async function graphGet(pathAndQuery: string, token: string): Promise<any> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    // A leading "?ids=…" hits the Graph root batch-get (`/v21.0/?ids=…`).
    const res = await httpFetch(`${GRAPH}/${pathAndQuery}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: ac.signal,
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok || data?.error) throw new Error(data?.error?.message || `HTTP ${res.status}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

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
