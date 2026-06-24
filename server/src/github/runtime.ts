import { config } from '../config';
import { getSetting, setSetting } from '../db';
import { encryptSecret, decryptSecret } from '../lib/crypto';

/**
 * Runtime GitHub OAuth-app config — lets the GitHub connect feature be activated WITHOUT editing
 * /opt/arksai/.env (no SSH). Client id + secret come from env if set, else from app_settings
 * (secret encrypted at rest via lib/crypto → ENCRYPTION_KEY||APP_PASSWORD, always available). A
 * small in-memory cache keeps githubCreds()/githubConfigured() synchronous (used in routes +
 * the connect path). loadGithubRuntime() runs once at boot; setGithubCreds() updates both.
 */
let cachedId = config.githubOauthClientId || '';
let cachedSecret = config.githubOauthClientSecret || '';

export async function loadGithubRuntime(): Promise<void> {
  if (!cachedId) cachedId = (await getSetting('github_oauth_client_id')) || '';
  if (!cachedSecret) {
    const enc = await getSetting('github_oauth_client_secret');
    if (enc) {
      try {
        cachedSecret = decryptSecret(enc);
      } catch {
        /* ignore a bad/rotated key */
      }
    }
  }
}

/** The resolved OAuth-app credentials, or null when not configured. Sync (cache-backed). */
export function githubCreds(): { clientId: string; clientSecret: string } | null {
  return cachedId && cachedSecret ? { clientId: cachedId, clientSecret: cachedSecret } : null;
}

/** Persist + cache the OAuth-app credentials (secret encrypted at rest). */
export async function setGithubCreds(clientId: string, clientSecret: string): Promise<void> {
  cachedId = clientId.trim();
  cachedSecret = clientSecret.trim();
  await setSetting('github_oauth_client_id', cachedId);
  await setSetting('github_oauth_client_secret', encryptSecret(cachedSecret));
}
