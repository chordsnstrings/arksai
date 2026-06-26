/**
 * Runtime config for app-database provisioning — lets Postgres provisioning be activated WITHOUT
 * editing /opt/arksai/.env (no SSH), exactly like the Android builder's runtime config. The admin
 * connection URL to the managed Postgres comes from env (MANAGED_PG_ADMIN_URL) if set, else from
 * app_settings (encrypted at rest). A small in-memory cache keeps pgAdminUrl() synchronous.
 *
 * loadDbRuntime() runs once at boot; setPgAdminUrl() updates the cache + persisted setting when the
 * operator configures it.
 */
import { config } from '../config';
import { getSetting, setSetting } from '../db';
import { encryptSecret, decryptSecret } from '../lib/crypto';

let cachedAdminUrl = config.pgAdminUrl || '';

export async function loadDbRuntime(): Promise<void> {
  if (!cachedAdminUrl) {
    const enc = await getSetting('managed_pg_admin_url');
    if (enc) {
      try {
        cachedAdminUrl = decryptSecret(enc);
      } catch {
        /* ignore a bad/rotated key */
      }
    }
  }
}

export function pgAdminUrl(): string {
  return cachedAdminUrl;
}
export function isPgProvisioningConfigured(): boolean {
  return !!cachedAdminUrl;
}

/** Persist + cache the managed-Postgres admin URL (encrypted). Flips Postgres provisioning ON. */
export async function setPgAdminUrl(url: string): Promise<void> {
  cachedAdminUrl = url.trim();
  await setSetting('managed_pg_admin_url', encryptSecret(cachedAdminUrl));
}
