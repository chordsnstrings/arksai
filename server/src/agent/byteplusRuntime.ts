/**
 * Runtime ModelArk (BytePlus) key — ModelArk is the platform's only model provider, activated
 * WITHOUT editing /opt/arksai/.env (no SSH), mirroring the Android builder's runtime config.
 * The ark key comes from app_settings (encrypted at rest; set from the admin panel) when present —
 * an explicit admin rotation wins — else from env (ARK_API_KEY). Clearing the admin key
 * (DELETE /api/admin/providers/byteplus → clearByteplusKey) falls back to the env key.
 * A small in-memory cache keeps byteplusConfigured() synchronous (used in the router's hot path).
 */
import { config, registerRuntimeSecret } from '../config';
import { getSetting, setSetting, q } from '../db';
import { encryptSecret, decryptSecret } from '../lib/crypto';

let cachedKey = config.byteplusApiKey || '';
let keySource: 'env' | 'admin' | 'none' = cachedKey ? 'env' : 'none';
registerRuntimeSecret(cachedKey);

/** Load the persisted key once at boot. An admin-set key (encrypted app_settings, written by
 *  POST /api/admin/providers/byteplus) WINS over ARK_API_KEY in env: rotating the key in the
 *  admin panel must survive a restart instead of being silently replaced by a stale .env value. */
export async function loadByteplusRuntime(): Promise<void> {
  const enc = await getSetting('ark_api_key');
  if (!enc) return; // no admin-set key → keep the env key (if any)
  try {
    cachedKey = decryptSecret(enc);
    keySource = 'admin';
    registerRuntimeSecret(cachedKey);
  } catch {
    /* bad/rotated encryption key — keep the env key (boot logs if ModelArk ends up unconfigured) */
  }
}

/** Whether ARK_API_KEY is set in the server environment (never its value) — the fallback a
 *  cleared admin key returns to. */
export function byteplusEnvKeyAvailable(): boolean {
  return !!config.byteplusApiKey;
}

/** Where the active key came from (shown to the operator next to the provider status). */
export function byteplusKeySource(): 'env' | 'admin' | 'none' {
  return keySource;
}

export function byteplusKey(): string {
  return cachedKey;
}

export function byteplusConfigured(): boolean {
  return !!cachedKey;
}

/** Persist + cache the ark key (encrypted). Turns every model lane + capability ON. */
export async function setByteplusKey(key: string): Promise<void> {
  cachedKey = key;
  keySource = 'admin';
  registerRuntimeSecret(key);
  await setSetting('ark_api_key', encryptSecret(key));
}

/** Drop the admin-set key (app_settings) and fall back to ARK_API_KEY from env (or nothing).
 *  The old key stays registered for redaction — it was a live secret and may still be valid. */
export async function clearByteplusKey(): Promise<void> {
  await q('DELETE FROM app_settings WHERE key = $1', ['ark_api_key']);
  cachedKey = config.byteplusApiKey || '';
  keySource = cachedKey ? 'env' : 'none';
}

/** TEST ONLY: set the in-memory key without a DB write. */
export function __setByteplusKeyForTest(key: string): void {
  cachedKey = key;
  keySource = key ? 'admin' : 'none';
}
