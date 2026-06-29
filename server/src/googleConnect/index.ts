import { config } from '../config';
import { GOOGLE_SCOPES, buildAuthUrl, googleClientId, googleConfigured, refreshAccessToken } from '../googleOauth';
import { getConnectionForUser, markStatus, updateAccessToken } from './store';

// The Google Workspace connector — a per-user Google account link for the agent + robots
// (Gmail / Calendar / Drive·Sheets). Reuses the shared googleOauth core. The non-login scopes are
// RESTRICTED, so production use needs Google consent-screen verification; the connect flow itself
// works for test users (or with the "unverified app" notice) the moment the OAuth client is set.

export { googleConfigured };

/** Identity (to read which account connected) + the data scopes: Gmail, Calendar, Drive·Sheets, Google Ads. */
export const GOOGLE_CONNECT_SCOPES = [
  GOOGLE_SCOPES.identity,
  GOOGLE_SCOPES.gmail,
  GOOGLE_SCOPES.calendar,
  GOOGLE_SCOPES.drive,
  GOOGLE_SCOPES.ads,
].join(' ');

export function googleConnectCallbackUrl(): string {
  return `${config.publicBaseUrl}/api/google/callback`;
}

/** The consent URL. offline + consent → a refresh token, so the agent keeps access between sessions. */
export function googleConnectUrl(state: string): string {
  return buildAuthUrl({
    clientId: googleClientId(),
    redirectUri: googleConnectCallbackUrl(),
    scope: GOOGLE_CONNECT_SCOPES,
    state,
    accessType: 'offline',
    prompt: 'consent',
  });
}

/**
 * A valid access token for a user's Google connection — transparently refreshed (with a 60s margin)
 * and persisted. Returns null when the user isn't connected or the refresh fails (the connector
 * tools degrade gracefully). Server-internal only; the token never reaches the model or the client.
 */
export async function getValidAccessToken(userId: string): Promise<string | null> {
  const conn = await getConnectionForUser(userId);
  if (!conn || conn.status === 'revoked') return null;
  if (conn.expiresAt && conn.expiresAt < Date.now() + 60_000 && conn.refreshToken) {
    try {
      const t = await refreshAccessToken(conn.refreshToken);
      await updateAccessToken(userId, t.accessToken, t.expiresAt ?? null);
      return t.accessToken;
    } catch {
      await markStatus(userId, 'error').catch(() => {});
      return null;
    }
  }
  return conn.accessToken;
}
