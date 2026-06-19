import { config } from '../config';
import type { Adapter, AdsRow, Connector, ReportParams, TokenSet } from './types';

// Google Ads API version — verify + bump against the live release notes at setup time.
const V = process.env.GOOGLE_ADS_API_VERSION || 'v18';
const ADS = `https://googleads.googleapis.com/${V}`;
const SCOPE = 'https://www.googleapis.com/auth/adwords';

const num = (v: any): number | string => {
  if (v == null) return '';
  const n = Number(v);
  return Number.isFinite(n) && String(v).trim() !== '' ? n : String(v);
};

/** Pure: build the Google OAuth consent URL (offline → refresh token). Unit-tested. */
export function buildGoogleAuthUrl(clientId: string, state: string, redirectUri: string): string {
  const p = new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: SCOPE,
    access_type: 'offline', prompt: 'consent', state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

/** Pure: build the GAQL query for a report (unit-tested). */
export function buildGaql(params: ReportParams): string {
  const level = params.level && params.level !== 'account' ? params.level : 'campaign';
  const dim =
    level === 'campaign' ? 'campaign.name' :
    level === 'ad' ? 'ad_group_ad.ad.name' :
    level === 'adset' ? 'ad_group.name' : '';
  const date = level === 'day' ? 'segments.date' : '';
  const sel = [dim, date, 'metrics.impressions', 'metrics.clicks', 'metrics.cost_micros', 'metrics.ctr', 'metrics.conversions']
    .filter(Boolean).join(', ');
  const from = level === 'ad' ? 'ad_group_ad' : level === 'adset' ? 'ad_group' : 'campaign';
  return `SELECT ${sel} FROM ${from} WHERE segments.date BETWEEN '${params.since}' AND '${params.until}'`;
}

/** Pure: flatten googleAds:searchStream batches → normalized rows (unit-tested). */
export function normalizeGoogle(batches: any[]): AdsRow[] {
  const out: AdsRow[] = [];
  for (const batch of batches ?? []) {
    for (const r of batch.results ?? []) {
      const row: AdsRow = {};
      if (r.campaign?.name) row.campaign = r.campaign.name;
      if (r.adGroup?.name) row.ad_group = r.adGroup.name;
      if (r.adGroupAd?.ad?.name) row.ad = r.adGroupAd.ad.name;
      if (r.segments?.date) row.date = r.segments.date;
      const m = r.metrics ?? {};
      if (m.impressions != null) row.impressions = num(m.impressions);
      if (m.clicks != null) row.clicks = num(m.clicks);
      if (m.costMicros != null) row.cost = Number(m.costMicros) / 1e6; // micros → currency units
      if (m.ctr != null) row.ctr = num(m.ctr);
      if (m.conversions != null) row.conversions = num(m.conversions);
      out.push(row);
    }
  }
  return out;
}

async function exchangeToken(body: Record<string, string>): Promise<any> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  return res.json();
}

export const googleAdapter: Adapter = {
  provider: 'google',
  available: () => !!(config.googleAdsClientId && config.googleAdsClientSecret && config.googleAdsDeveloperToken),
  authUrl: (state, redirectUri) => buildGoogleAuthUrl(config.googleAdsClientId, state, redirectUri),

  async exchangeCode(code, redirectUri): Promise<TokenSet> {
    const t = await exchangeToken({
      code, client_id: config.googleAdsClientId, client_secret: config.googleAdsClientSecret,
      redirect_uri: redirectUri, grant_type: 'authorization_code',
    });
    if (!t.access_token) throw new Error(`Google token exchange failed: ${JSON.stringify(t).slice(0, 200)}`);
    // Resolve accessible customer accounts.
    const list: any = await (await fetch(`${ADS}/customers:listAccessibleCustomers`, {
      headers: { Authorization: `Bearer ${t.access_token}`, 'developer-token': config.googleAdsDeveloperToken },
    })).json();
    const accounts = (list.resourceNames ?? []).map((rn: string) => {
      const id = rn.split('/')[1] ?? rn;
      return { id, name: `Customer ${id}` };
    });
    return { accessToken: t.access_token, refreshToken: t.refresh_token ?? null, expiresAt: t.expires_in ? Date.now() + t.expires_in * 1000 : null, scopes: SCOPE, accounts };
  },

  async refresh(refreshToken): Promise<TokenSet> {
    const t = await exchangeToken({
      refresh_token: refreshToken, client_id: config.googleAdsClientId, client_secret: config.googleAdsClientSecret, grant_type: 'refresh_token',
    });
    if (!t.access_token) throw new Error('Google token refresh failed');
    return { accessToken: t.access_token, refreshToken, expiresAt: t.expires_in ? Date.now() + t.expires_in * 1000 : null };
  },

  async fetchReport(c: Connector, params: ReportParams, signal): Promise<AdsRow[]> {
    const cid = c.accountId.replace(/-/g, '');
    const res = await fetch(`${ADS}/customers/${cid}/googleAds:searchStream`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${c.accessToken}`,
        'developer-token': config.googleAdsDeveloperToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: buildGaql(params) }),
      signal,
    });
    const json: any = await res.json();
    if (json.error || (Array.isArray(json) && json[0]?.error)) {
      const e = json.error ?? json[0].error;
      throw new Error(`Google Ads error: ${e.message ?? JSON.stringify(e).slice(0, 200)}`);
    }
    return normalizeGoogle(Array.isArray(json) ? json : [json]);
  },
};
