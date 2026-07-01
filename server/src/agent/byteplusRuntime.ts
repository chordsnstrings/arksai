/**
 * Runtime BytePlus (Dola / "ArksAI Swift") config — lets the fast-lane provider be activated
 * WITHOUT editing /opt/arksai/.env (no SSH), mirroring the Android builder's runtime config.
 * The ark key comes from env (ARK_API_KEY) if set, else from app_settings (encrypted at rest).
 * A small in-memory cache keeps byteplusConfigured() synchronous (used in the router's hot path).
 */
import { config } from '../config';
import { getSetting, setSetting } from '../db';
import { encryptSecret, decryptSecret } from '../lib/crypto';

let cachedKey = config.byteplusApiKey || '';

/** Load the persisted key once at boot (env wins; else the encrypted app_settings value). */
export async function loadByteplusRuntime(): Promise<void> {
  if (!cachedKey) {
    const enc = await getSetting('ark_api_key');
    if (enc) {
      try {
        cachedKey = decryptSecret(enc);
      } catch {
        /* bad/rotated encryption key — leave the fast lane off */
      }
    }
  }
}

export function byteplusKey(): string {
  return cachedKey;
}

export function byteplusConfigured(): boolean {
  return !!cachedKey;
}

/** Persist + cache the ark key (encrypted). Flips the Swift fast lane ON for simple builds. */
export async function setByteplusKey(key: string): Promise<void> {
  cachedKey = key;
  await setSetting('ark_api_key', encryptSecret(key));
}

/** TEST ONLY: set the in-memory key without a DB write. */
export function __setByteplusKeyForTest(key: string): void {
  cachedKey = key;
}
