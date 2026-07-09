/**
 * Runtime Meta app-secret config — activate the Meta ads connector WITHOUT editing
 * /opt/arksai/.env (no SSH), mirroring byteplusRuntime / the Android builder's runtime config.
 * The secret comes from env (META_APP_SECRET) if set, else from app_settings (encrypted at rest
 * via lib/crypto). The app_id + Facebook-Login-for-Business config_id are NOT secrets and live in
 * config.ts; this holds ONLY the app secret. Cached in-memory so metaAdapter.available() stays
 * synchronous (used in the connectors hot path).
 */
import { config } from '../config';
import { getSetting, setSetting } from '../db';
import { encryptSecret, decryptSecret } from '../lib/crypto';

let cachedSecret = config.metaAppSecret || '';

/** Load the persisted secret once at boot (env wins; else the encrypted app_settings value). */
export async function loadMetaRuntime(): Promise<void> {
  if (!cachedSecret) {
    const enc = await getSetting('meta_app_secret');
    if (enc) {
      try {
        cachedSecret = decryptSecret(enc);
      } catch {
        /* bad/rotated encryption key — leave the connector off */
      }
    }
  }
}

export function metaAppSecret(): string {
  return cachedSecret;
}

export function metaSecretConfigured(): boolean {
  return !!cachedSecret;
}

/** Persist + cache the Meta app secret (encrypted). Flips the Meta connector's creds ON. */
export async function setMetaAppSecret(secret: string): Promise<void> {
  cachedSecret = secret;
  await setSetting('meta_app_secret', encryptSecret(secret));
}

/** TEST ONLY: set the in-memory secret without a DB write. */
export function __setMetaSecretForTest(secret: string): void {
  cachedSecret = secret;
}
