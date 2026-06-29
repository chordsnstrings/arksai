import { config } from './config';
import { getSetting, setSetting } from './db';
import { encryptSecret, decryptSecret } from './lib/crypto';

/**
 * Runtime Google OAuth-client config — lets "Sign in with Google" (and later the Workspace
 * connectors) be activated WITHOUT editing /opt/arksai/.env (no SSH). Client id + secret come from
 * env if set, else from app_settings (secret encrypted at rest via lib/crypto → ENCRYPTION_KEY||
 * APP_PASSWORD, always available). A small in-memory cache keeps googleCreds()/googleConfigured()
 * synchronous (used in the auth routes). loadGoogleRuntime() runs once at boot; setGoogleCreds()
 * (the operator /api/admin/google-oauth/configure endpoint) updates both.
 */
let cachedId = config.googleOauthClientId || '';
let cachedSecret = config.googleOauthClientSecret || '';

export async function loadGoogleRuntime(): Promise<void> {
  if (!cachedId) cachedId = (await getSetting('google_oauth_client_id')) || '';
  if (!cachedSecret) {
    const enc = await getSetting('google_oauth_client_secret');
    if (enc) {
      try {
        cachedSecret = decryptSecret(enc);
      } catch {
        /* ignore a bad/rotated key */
      }
    }
  }
}

/** The resolved OAuth-client credentials, or null when not configured. Sync (cache-backed). */
export function googleCreds(): { clientId: string; clientSecret: string } | null {
  return cachedId && cachedSecret ? { clientId: cachedId, clientSecret: cachedSecret } : null;
}

/** Persist + cache the OAuth-client credentials (secret encrypted at rest). */
export async function setGoogleCreds(clientId: string, clientSecret: string): Promise<void> {
  cachedId = clientId.trim();
  cachedSecret = clientSecret.trim();
  await setSetting('google_oauth_client_id', cachedId);
  await setSetting('google_oauth_client_secret', encryptSecret(cachedSecret));
}
