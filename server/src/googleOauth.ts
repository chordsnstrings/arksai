import { googleCreds } from './googleRuntime';

// Shared Google OAuth 2.0 core — used by "Sign in with Google" (login) now, and by the Google
// Workspace connectors (Gmail / Calendar / Drive·Sheets) once the consent screen is verified.
// One client, many scopes; the pure URL builder is unit-tested.

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/userinfo';

/** Scope presets. Login is non-sensitive (works immediately); the rest are sensitive/restricted
 *  and need Google app verification before production use. */
export const GOOGLE_SCOPES = {
  login: 'openid email profile',
  gmail: 'https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send',
  calendar: 'https://www.googleapis.com/auth/calendar.events',
  drive: 'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/spreadsheets.readonly',
} as const;

export function googleConfigured(): boolean {
  return !!googleCreds();
}

/** The configured client id (env or stored), or '' when unconfigured. */
export function googleClientId(): string {
  return googleCreds()?.clientId ?? '';
}

/** Pure: build the Google consent URL. `accessType:'offline' + prompt:'consent'` yields a refresh
 *  token (needed by the data connectors); login uses the default online flow. Unit-tested. */
export function buildAuthUrl(o: {
  clientId: string;
  redirectUri: string;
  scope: string;
  state: string;
  accessType?: 'online' | 'offline';
  prompt?: string;
  loginHint?: string;
}): string {
  const p = new URLSearchParams({
    client_id: o.clientId,
    redirect_uri: o.redirectUri,
    response_type: 'code',
    scope: o.scope,
    state: o.state,
    access_type: o.accessType ?? 'online',
    include_granted_scopes: 'true',
  });
  if (o.prompt) p.set('prompt', o.prompt);
  if (o.loginHint) p.set('login_hint', o.loginHint);
  return `${AUTH_ENDPOINT}?${p.toString()}`;
}

export interface GoogleTokens {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  scope?: string;
  expiresAt?: number; // epoch ms
}

function parseTokenResponse(j: any, fallbackRefresh?: string): GoogleTokens {
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token ?? fallbackRefresh,
    idToken: j.id_token,
    scope: j.scope,
    expiresAt: typeof j.expires_in === 'number' ? Date.now() + j.expires_in * 1000 : undefined,
  };
}

export async function exchangeCode(code: string, redirectUri: string): Promise<GoogleTokens> {
  const creds = googleCreds();
  if (!creds) throw new Error('Google OAuth is not configured.');
  const body = new URLSearchParams({
    code,
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });
  const r = await fetch(TOKEN_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  if (!r.ok) throw new Error(`Google token exchange failed (${r.status})`);
  return parseTokenResponse(await r.json());
}

export async function refreshAccessToken(refreshToken: string): Promise<GoogleTokens> {
  const creds = googleCreds();
  if (!creds) throw new Error('Google OAuth is not configured.');
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    grant_type: 'refresh_token',
  });
  const r = await fetch(TOKEN_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  if (!r.ok) throw new Error(`Google token refresh failed (${r.status})`);
  return parseTokenResponse(await r.json(), refreshToken);
}

export interface GoogleProfile {
  sub: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  picture?: string;
}

export async function fetchUserInfo(accessToken: string): Promise<GoogleProfile> {
  const r = await fetch(USERINFO_ENDPOINT, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!r.ok) throw new Error(`Google userinfo failed (${r.status})`);
  const j: any = await r.json();
  return {
    sub: String(j.sub ?? ''),
    email: String(j.email ?? '').toLowerCase(),
    // Google may send the boolean as a real bool or the string "true".
    emailVerified: j.email_verified === true || j.email_verified === 'true',
    name: typeof j.name === 'string' ? j.name : undefined,
    picture: typeof j.picture === 'string' ? j.picture : undefined,
  };
}
