import { config } from '../config';
import { encryptionReady } from './crypto';
import { metaAdapter } from './meta';
import { googleAdapter } from './google';
import { tiktokAdapter } from './tiktok';
import { updateTokens, markStatus } from './store';
import type { Adapter, AdsRow, Connector, Provider, ReportParams } from './types';
import { PROVIDERS, PROVIDER_LABELS } from './types';

export type { Provider, AdsRow, ReportParams } from './types';
export { PROVIDERS, PROVIDER_LABELS } from './types';

const ADAPTERS: Record<Provider, Adapter> = {
  meta: metaAdapter,
  google: googleAdapter,
  tiktok: tiktokAdapter,
};

export function adapterFor(provider: Provider): Adapter {
  return ADAPTERS[provider];
}

/** Connectors as a whole require a token-encryption key; each provider also needs its app creds. */
export function connectorsEnabled(): boolean {
  return encryptionReady();
}

export function providerAvailable(provider: Provider): boolean {
  return connectorsEnabled() && ADAPTERS[provider].available();
}

/** Which providers are connectable in this deployment (creds + encryption configured). */
export function availableProviders(): { provider: Provider; label: string }[] {
  return PROVIDERS.filter((p) => providerAvailable(p)).map((p) => ({ provider: p, label: PROVIDER_LABELS[p] }));
}

/** The OAuth redirect URI registered in each provider's app. */
export function redirectUri(provider: Provider): string {
  return `${config.publicBaseUrl}/api/connectors/${provider}/callback`;
}

/** Fetch a report, transparently refreshing an expired access token first. */
export async function fetchReport(c: Connector, params: ReportParams, signal: AbortSignal): Promise<AdsRow[]> {
  const adapter = ADAPTERS[c.provider];
  let conn = c;
  // Refresh if expired (with a 60s safety margin) and we have something to refresh with.
  if (conn.expiresAt && conn.expiresAt < Date.now() + 60_000) {
    try {
      const tokens = await adapter.refresh(conn.refreshToken || conn.accessToken);
      await updateTokens(conn.id, tokens);
      conn = { ...conn, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken ?? conn.refreshToken, expiresAt: tokens.expiresAt ?? null };
    } catch {
      /* try the existing token anyway; if it fails we mark the connector below */
    }
  }
  try {
    return await adapter.fetchReport(conn, params, signal);
  } catch (e) {
    await markStatus(conn.id, 'error').catch(() => {});
    throw e;
  }
}
