export type Provider = 'meta' | 'google' | 'tiktok';

export const PROVIDERS: Provider[] = ['meta', 'google', 'tiktok'];

export const PROVIDER_LABELS: Record<Provider, string> = {
  meta: 'Meta Ads (Facebook / Instagram)',
  google: 'Google Ads',
  tiktok: 'TikTok Ads',
};

/** A stored connector (tokens are decrypted only inside the adapter, never exposed). */
export interface Connector {
  id: string;
  orgId: string;
  provider: Provider;
  accountId: string;
  accountName: string | null;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number | null;
  scopes: string | null;
  status: 'active' | 'error' | 'revoked';
  /** The provider's app-scoped user id for the person who granted this connector.
   *  Meta sends this (and only this) in the Data Deletion / Deauthorize callbacks —
   *  it's how we locate the rows to purge when a user removes the app. */
  externalUserId?: string | null;
}

/** A normalized row of ad performance data — provider-agnostic, table-friendly. */
export interface AdsRow {
  [key: string]: string | number;
}

export interface ReportParams {
  /** Which connected ad account (defaults to the org's first active one for the provider). */
  accountId?: string;
  /** ISO dates YYYY-MM-DD. */
  since: string;
  until: string;
  /** Requested metrics (provider-mapped); a sensible default set is used if omitted. */
  metrics?: string[];
  /** A breakdown dimension, e.g. 'campaign' | 'day' | 'ad'. */
  level?: 'account' | 'campaign' | 'adset' | 'ad' | 'day';
}

export interface TokenSet {
  accessToken: string;
  refreshToken?: string | null;
  /** epoch ms */
  expiresAt?: number | null;
  scopes?: string | null;
  /** the ad accounts this grant covers (provider-resolved) */
  accounts?: { id: string; name: string }[];
  /** the provider's app-scoped user id for the granting user (Meta: the `id` from /me) */
  externalUserId?: string | null;
}

/** Each ad platform implements this. Pure URL/normalize helpers are exported separately
 *  for unit tests; the methods here do the network I/O. */
export interface Adapter {
  provider: Provider;
  /** True when this provider's app credentials are configured. */
  available(): boolean;
  /** OAuth consent URL to redirect the admin to. */
  authUrl(state: string, redirectUri: string): string;
  /** Exchange the returned ?code for tokens (+ resolve the accessible ad accounts). */
  exchangeCode(code: string, redirectUri: string): Promise<TokenSet>;
  /** Refresh an expired access token (if the provider supports it). */
  refresh(refreshToken: string): Promise<TokenSet>;
  /** Pull a normalized performance report for a connector. */
  fetchReport(c: Connector, params: ReportParams, signal: AbortSignal): Promise<AdsRow[]>;
}
