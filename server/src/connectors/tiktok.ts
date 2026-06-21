import { config } from '../config';
import type { Adapter, AdsRow, Connector, ReportParams, TokenSet } from './types';

// TikTok Marketing API. Verify + bump the version at setup time.
const V = process.env.TIKTOK_API_VERSION || 'v1.3';
const BASE = `https://business-api.tiktok.com/open_api/${V}`;
const DEFAULT_METRICS = ['spend', 'impressions', 'clicks', 'ctr', 'cpc', 'conversion'];

const num = (v: any): number | string => {
  if (v == null) return '';
  const n = Number(v);
  return Number.isFinite(n) && String(v).trim() !== '' ? n : String(v);
};

/** Pure: build the TikTok advertiser-authorization URL (unit-tested). */
export function buildTiktokAuthUrl(appId: string, state: string, redirectUri: string): string {
  const p = new URLSearchParams({ app_id: appId, state, redirect_uri: redirectUri });
  return `https://business-api.tiktok.com/portal/auth?${p}`;
}

/** Pure: flatten a TikTok integrated-report response → normalized rows (unit-tested). */
export function normalizeTiktok(list: any[]): AdsRow[] {
  return (list ?? []).map((item) => {
    const row: AdsRow = {};
    for (const [k, v] of Object.entries(item.dimensions ?? {})) row[k] = num(v);
    for (const [k, v] of Object.entries(item.metrics ?? {})) row[k] = num(v);
    return row;
  });
}

export const tiktokAdapter: Adapter = {
  provider: 'tiktok',
  available: () => !!(config.tiktokClientKey && config.tiktokClientSecret),
  authUrl: (state, redirectUri) => buildTiktokAuthUrl(config.tiktokClientKey, state, redirectUri),

  async exchangeCode(code): Promise<TokenSet> {
    const res = await fetch(`${BASE}/oauth2/access_token/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: config.tiktokClientKey, secret: config.tiktokClientSecret, auth_code: code }),
    });
    const json: any = await res.json();
    const data = json.data ?? {};
    if (!data.access_token) throw new Error(`TikTok token exchange failed: ${JSON.stringify(json).slice(0, 200)}`);
    // Resolve advertiser accounts (names).
    let accounts: { id: string; name: string }[] = (data.advertiser_ids ?? []).map((id: string) => ({ id, name: id }));
    try {
      const advUrl = `${BASE}/oauth2/advertiser/get/?access_token=${encodeURIComponent(data.access_token)}&secret=${encodeURIComponent(config.tiktokClientSecret)}&app_id=${encodeURIComponent(config.tiktokClientKey)}`;
      const adv: any = await (await fetch(advUrl)).json();
      const named = (adv.data?.list ?? []).map((a: any) => ({ id: a.advertiser_id, name: a.advertiser_name || a.advertiser_id }));
      if (named.length) accounts = named;
    } catch {
      /* keep ids if name lookup fails */
    }
    // TikTok Marketing API access tokens are long-lived (no expiry / no refresh token).
    return { accessToken: data.access_token, refreshToken: null, expiresAt: null, scopes: String(data.scope ?? ''), accounts };
  },

  // No refresh flow — long-lived token.
  async refresh(token): Promise<TokenSet> {
    return { accessToken: token, refreshToken: null, expiresAt: null };
  },

  async fetchReport(c: Connector, params: ReportParams, signal): Promise<AdsRow[]> {
    const level = params.level && params.level !== 'account' ? params.level : 'campaign';
    const dataLevel = level === 'ad' ? 'AUCTION_AD' : level === 'adset' ? 'AUCTION_ADGROUP' : 'AUCTION_CAMPAIGN';
    const dimId = level === 'ad' ? 'ad_id' : level === 'adset' ? 'adgroup_id' : 'campaign_id';
    const dimensions = level === 'day' ? [dimId, 'stat_time_day'] : [dimId];
    const metrics = params.metrics?.length ? params.metrics : DEFAULT_METRICS;
    const p = new URLSearchParams({
      advertiser_id: c.accountId,
      report_type: 'BASIC',
      data_level: dataLevel,
      dimensions: JSON.stringify(dimensions),
      metrics: JSON.stringify(metrics),
      start_date: params.since,
      end_date: params.until,
      page_size: '200',
    });
    const res = await fetch(`${BASE}/report/integrated/get/?${p}`, {
      headers: { 'Access-Token': c.accessToken },
      signal,
    });
    const json: any = await res.json();
    if (json.code && json.code !== 0) throw new Error(`TikTok report error: ${json.message ?? json.code}`);
    return normalizeTiktok(json.data?.list ?? []);
  },
};
