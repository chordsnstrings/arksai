/**
 * Facebook PAGES on a connected Meta account — enumeration + organic Page insights, the
 * companion to the ad-account report path (`meta.ts`). A Facebook Login that granted the page
 * scopes returns, from `/me/accounts`, every Page the user manages WITH its own page access
 * token and the linked Instagram account — so once a user connects, we can read Page reach /
 * engagement / follower growth the same deterministic way the ad report reads spend.
 *
 * Pure builders + normalizers are exported for unit tests; the network I/O wrappers below use
 * them. NOTHING here works until the Meta app's Login-for-Business config (or scope set) grants
 * `pages_show_list`, `pages_read_engagement`, `read_insights` — advanced-access permissions that
 * need App Review before non-test users can grant them (the operator's Meta-side action).
 */

const V = process.env.META_API_VERSION || 'v21.0';
const GRAPH = `https://graph.facebook.com/${V}`;

export interface MetaPage {
  id: string;
  name: string;
  category: string | null;
  /** Page access token (long-lived alongside the user token) — used for Page insights + posts. */
  accessToken: string;
  igUserId: string | null;
  igUsername: string | null;
}

/** Pure: the `/me/accounts` request (fields include the per-page token + linked IG account). */
export function pagesRequest(userToken: string): { url: string } {
  const p = new URLSearchParams({
    fields: 'id,name,category,access_token,instagram_business_account{id,username}',
    limit: '200',
    access_token: userToken,
  });
  return { url: `${GRAPH}/me/accounts?${p}` };
}

/** Pure: normalize the `/me/accounts` payload → typed Page list (unit-tested). */
export function normalizePages(data: any): MetaPage[] {
  const rows: any[] = Array.isArray(data?.data) ? data.data : [];
  return rows
    .filter((r) => r?.id)
    .map((r) => ({
      id: String(r.id),
      name: String(r.name ?? r.id),
      category: r.category ? String(r.category) : null,
      accessToken: String(r.access_token ?? ''),
      igUserId: r.instagram_business_account?.id ? String(r.instagram_business_account.id) : null,
      igUsername: r.instagram_business_account?.username ? String(r.instagram_business_account.username) : null,
    }));
}

/** The organic Page metrics we read (conservative, broadly-available set). `_unique` = reach. */
export const PAGE_METRICS = [
  'page_impressions',
  'page_impressions_unique',
  'page_post_engagements',
  'page_follows',
  'page_fan_adds',
] as const;

/** Pure: the Page-insights request for a window. `period=day` → one value per day in range. */
export function pageInsightsRequest(pageId: string, pageToken: string, since: string, until: string, metrics: readonly string[] = PAGE_METRICS): { url: string } {
  const p = new URLSearchParams({
    metric: metrics.join(','),
    period: 'day',
    since,
    until,
    access_token: pageToken,
  });
  return { url: `${GRAPH}/${pageId}/insights?${p}` };
}

export interface PageInsights {
  /** Total impressions over the window (additive). */
  impressions: number;
  /** Reach = unique impressions. Meta reports it per-day unique; we sum daily uniques as a
   *  practical proxy (documented over-count vs true windowed reach — the report labels it). */
  reach: number;
  engagements: number;
  /** Net follower change over the window (follows/fan-adds, whichever the account reports). */
  followerChange: number;
}

const numsOf = (values: any): number[] =>
  (Array.isArray(values) ? values : []).map((v) => (typeof v?.value === 'number' ? v.value : Number(v?.value))).filter((n) => Number.isFinite(n));

/** Pure: normalize a Page-insights payload → the summary the report consumes (unit-tested). */
export function normalizePageInsights(data: any): PageInsights {
  const byMetric = new Map<string, number[]>();
  const rows: any[] = Array.isArray(data?.data) ? data.data : [];
  for (const r of rows) if (r?.name) byMetric.set(String(r.name), numsOf(r.values));
  const sum = (m: string) => (byMetric.get(m) ?? []).reduce((a, b) => a + b, 0);
  return {
    impressions: sum('page_impressions'),
    reach: sum('page_impressions_unique'),
    engagements: sum('page_post_engagements'),
    // Prefer the explicit follows metric; fall back to fan_adds on accounts that only report that.
    followerChange: byMetric.has('page_follows') ? sum('page_follows') : sum('page_fan_adds'),
  };
}

// ── Network I/O (uses the pure builders above) ────────────────────────────────────────────────

/** Enumerate the Pages a user token can manage. Fail-soft → [] (the connect still succeeds). */
export async function fetchPages(userToken: string): Promise<MetaPage[]> {
  try {
    const { url } = pagesRequest(userToken);
    const json: any = await (await fetch(url)).json();
    if (json?.error) throw new Error(json.error.message);
    return normalizePages(json);
  } catch {
    return [];
  }
}

/** Pull organic insights for one Page over a window. Throws with Meta's message on error. */
export async function fetchPageInsights(pageId: string, pageToken: string, since: string, until: string, signal?: AbortSignal): Promise<PageInsights> {
  const { url } = pageInsightsRequest(pageId, pageToken, since, until);
  const json: any = await (await fetch(url, { signal })).json();
  if (json?.error) throw new Error(`Meta Page insights error: ${json.error.message}`);
  return normalizePageInsights(json);
}
