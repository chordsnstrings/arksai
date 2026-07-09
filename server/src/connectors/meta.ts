import { config } from '../config';
import { metaAppSecret } from './metaRuntime';
import type { Adapter, AdsRow, Connector, ReportParams, TokenSet } from './types';

// Graph/Marketing API version. Verify + bump against the live changelog at setup time.
const V = process.env.META_API_VERSION || 'v21.0';
const GRAPH = `https://graph.facebook.com/${V}`;
const SCOPES = 'ads_read,business_management';
const DEFAULT_METRICS = ['impressions', 'clicks', 'spend', 'ctr', 'cpc', 'reach', 'actions'];

const num = (v: any): number | string => {
  if (v == null) return '';
  const n = Number(v);
  return Number.isFinite(n) && String(v).trim() !== '' ? n : String(v);
};

/** Pure: build the Meta OAuth consent URL (unit-tested).
 *  With a Facebook-Login-for-Business `configId`, the configuration itself defines the requested
 *  permissions/assets, so `config_id` REPLACES `scope` and `override_default_response_type=true`
 *  is required to force the authorization-code grant (verified against developers.facebook.com). */
export function buildMetaAuthUrl(clientId: string, state: string, redirectUri: string, configId?: string): string {
  const p = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, state, response_type: 'code' });
  if (configId) {
    p.set('config_id', configId);
    p.set('override_default_response_type', 'true');
  } else {
    p.set('scope', SCOPES);
  }
  return `https://www.facebook.com/${V}/dialog/oauth?${p}`;
}

/** Pure: flatten Meta insights rows → normalized table rows (unit-tested). */
export function normalizeMeta(data: any[]): AdsRow[] {
  return (data ?? []).map((d) => {
    const row: AdsRow = {};
    for (const [k, v] of Object.entries(d)) {
      if (k === 'actions' && Array.isArray(v)) {
        for (const a of v as any[]) row[`action_${a.action_type}`] = num(a.value);
      } else if (typeof v === 'object') {
        // skip nested time ranges etc.
      } else {
        row[k] = num(v);
      }
    }
    return row;
  });
}

export const metaAdapter: Adapter = {
  provider: 'meta',
  available: () => !!(config.metaAppId && metaAppSecret()),
  authUrl: (state, redirectUri) => buildMetaAuthUrl(config.metaAppId, state, redirectUri, config.metaConfigId || undefined),

  async exchangeCode(code, redirectUri): Promise<TokenSet> {
    // 1) code → short-lived token
    const t = new URLSearchParams({ client_id: config.metaAppId, client_secret: metaAppSecret(), redirect_uri: redirectUri, code });
    const r1: any = await (await fetch(`${GRAPH}/oauth/access_token?${t}`)).json();
    if (!r1.access_token) throw new Error(`Meta token exchange failed: ${JSON.stringify(r1).slice(0, 200)}`);
    // 2) short → long-lived (~60d)
    const ex = new URLSearchParams({ grant_type: 'fb_exchange_token', client_id: config.metaAppId, client_secret: metaAppSecret(), fb_exchange_token: r1.access_token });
    const r2: any = await (await fetch(`${GRAPH}/oauth/access_token?${ex}`)).json();
    const access = r2.access_token || r1.access_token;
    const expiresIn = Number(r2.expires_in || r1.expires_in || 0);
    // 3) resolve accessible ad accounts
    const accts: any = await (await fetch(`${GRAPH}/me/adaccounts?fields=account_id,name&access_token=${encodeURIComponent(access)}`)).json();
    const accounts = (accts.data ?? []).map((a: any) => ({ id: a.account_id, name: a.name || a.account_id }));
    return { accessToken: access, refreshToken: null, expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : null, scopes: SCOPES, accounts };
  },

  // Meta has no refresh token; re-extend the long-lived token via fb_exchange_token.
  async refresh(currentAccess): Promise<TokenSet> {
    const ex = new URLSearchParams({ grant_type: 'fb_exchange_token', client_id: config.metaAppId, client_secret: metaAppSecret(), fb_exchange_token: currentAccess });
    const r: any = await (await fetch(`${GRAPH}/oauth/access_token?${ex}`)).json();
    if (!r.access_token) throw new Error('Meta token re-extend failed');
    return { accessToken: r.access_token, refreshToken: null, expiresAt: r.expires_in ? Date.now() + r.expires_in * 1000 : null };
  },

  async fetchReport(c: Connector, params: ReportParams, signal): Promise<AdsRow[]> {
    const level = params.level && params.level !== 'account' ? params.level : 'campaign';
    const metrics = (params.metrics?.length ? params.metrics : DEFAULT_METRICS).join(',');
    const fields = `${level === 'campaign' ? 'campaign_name' : level === 'adset' ? 'adset_name' : level === 'ad' ? 'ad_name' : ''}${level ? ',' : ''}${metrics}`.replace(/^,/, '');
    const acct = c.accountId.startsWith('act_') ? c.accountId : `act_${c.accountId}`;
    const p = new URLSearchParams({
      fields,
      level: level === 'day' ? 'account' : level,
      time_range: JSON.stringify({ since: params.since, until: params.until }),
      access_token: c.accessToken,
      limit: '200',
    });
    if (level === 'day') p.set('time_increment', '1');
    const res = await fetch(`${GRAPH}/${acct}/insights?${p}`, { signal });
    const json: any = await res.json();
    if (json.error) throw new Error(`Meta insights error: ${json.error.message}`);
    return normalizeMeta(json.data);
  },
};
