/**
 * Runtime build config — lets the Android builder be activated WITHOUT editing
 * /opt/arksai/.env (no SSH). The DO API token + baked snapshot id come from env
 * if set, else from app_settings (token encrypted at rest). A small in-memory
 * cache keeps isBuildConfigured() synchronous (it's used in a tool's available()).
 *
 * loadBuildRuntime() runs once at boot; activateBuild() updates both the cache and
 * the persisted settings when a bake completes or the operator configures it.
 */
import { config } from '../config';
import { getSetting, setSetting } from '../db';
import { encryptSecret, decryptSecret } from '../lib/crypto';

let cachedToken = config.doApiToken || '';
let cachedSnapshot = config.androidSnapshotId || '';

export async function loadBuildRuntime(): Promise<void> {
  if (!cachedToken) {
    const enc = await getSetting('do_api_token');
    if (enc) {
      try { cachedToken = decryptSecret(enc); } catch { /* ignore a bad/rotated key */ }
    }
  }
  if (!cachedSnapshot) {
    cachedSnapshot = (await getSetting('android_snapshot_id')) || '';
  }
}

export function doToken(): string {
  return cachedToken;
}
export function snapshotId(): string {
  return cachedSnapshot;
}
export function isBuildConfigured(): boolean {
  return !!(cachedToken && cachedSnapshot);
}

/** Persist + cache the DO token (encrypted). */
export async function setBuildToken(token: string): Promise<void> {
  cachedToken = token;
  await setSetting('do_api_token', encryptSecret(token));
}

/** Persist + cache the baked snapshot id — this is what flips the builder ON. */
export async function setSnapshotId(id: string): Promise<void> {
  cachedSnapshot = id;
  await setSetting('android_snapshot_id', id);
}
