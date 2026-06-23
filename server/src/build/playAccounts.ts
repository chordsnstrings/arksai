import { q, qOne } from '../db';
import { decryptSecret, encryptSecret } from '../lib/crypto';

/**
 * Per-org Google Play Developer connection store. MULTI-TENANT by design: each company
 * connects its OWN Play account (service-account JSON), so apps publish under that
 * company's developer identity + billing — NEVER one shared ArksAI account. Mirrors
 * `email/accounts.ts`: the service-account JSON is AES-256-GCM encrypted at rest and is
 * NEVER returned to the client (only a `hasCredentials` flag + non-secret metadata).
 *
 * DORMANT scaffold: this stores + validates + exposes the connection; the actual AAB
 * build → Play Android Publisher upload pipeline (which reads `accountCredentials`) is a
 * follow-on, gated on a real connected account to test against.
 */

export type PlayTrack = 'internal' | 'closed' | 'production';
export const PLAY_TRACKS: PlayTrack[] = ['internal', 'closed', 'production'];

export interface PlayAccount {
  orgId: string;
  developerName: string | null;
  developerId: string | null;
  packagePrefix: string | null;
  defaultTrack: PlayTrack;
  saEmail: string | null;
  saProject: string | null;
  enabled: boolean;
  verifiedAt: number | null;
  hasCredentials: boolean;
  updatedAt: number;
}

function rowToAccount(r: any): PlayAccount {
  return {
    orgId: r.org_id,
    developerName: r.developer_name ?? null,
    developerId: r.developer_id ?? null,
    packagePrefix: r.package_prefix ?? null,
    defaultTrack: (r.default_track as PlayTrack) || 'internal',
    saEmail: r.sa_email ?? null,
    saProject: r.sa_project ?? null,
    enabled: !!Number(r.enabled),
    verifiedAt: r.verified_at != null ? Number(r.verified_at) : null,
    hasCredentials: !!r.sa_json,
    updatedAt: Number(r.updated_at),
  };
}

export async function getPlayAccount(orgId: string): Promise<PlayAccount | null> {
  const r = await qOne('SELECT * FROM org_play_accounts WHERE org_id = $1', [orgId]);
  return r ? rowToAccount(r) : null;
}

/** Decrypt the stored service-account JSON for server-internal use (the upload pipeline). */
export async function accountCredentials(orgId: string): Promise<Record<string, any> | null> {
  const r = await qOne('SELECT sa_json FROM org_play_accounts WHERE org_id = $1', [orgId]);
  if (!r?.sa_json) return null;
  try {
    return JSON.parse(decryptSecret(r.sa_json));
  } catch {
    return null;
  }
}

/**
 * Validate a Google service-account JSON the way the Play Android Publisher API requires:
 * it must be a `service_account` key with a private key + client email. Returns the parsed
 * non-secret fields, or an error string. Pure — no network.
 */
export function parseServiceAccount(raw: string): { ok: true; clientEmail: string; projectId: string } | { ok: false; error: string } {
  let obj: any;
  try {
    obj = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'That is not valid JSON. Paste the entire service-account key file.' };
  }
  if (!obj || typeof obj !== 'object') return { ok: false, error: 'The credentials file is empty or malformed.' };
  if (obj.type !== 'service_account')
    return { ok: false, error: 'This is not a service-account key (expected "type":"service_account"). Create a key on the GCP service account, not an OAuth client.' };
  if (typeof obj.private_key !== 'string' || !obj.private_key.includes('PRIVATE KEY'))
    return { ok: false, error: 'The key is missing its private_key — download a fresh JSON key for the service account.' };
  if (typeof obj.client_email !== 'string' || !obj.client_email.includes('@'))
    return { ok: false, error: 'The key is missing client_email.' };
  return { ok: true, clientEmail: obj.client_email, projectId: obj.project_id || '' };
}

export interface ConnectPlayInput {
  developerName?: string | null;
  developerId?: string | null;
  packagePrefix?: string | null;
  defaultTrack?: PlayTrack;
  serviceAccountJson?: string | null; // raw JSON; omit to keep the existing one
}

/**
 * Connect / update an org's Play account. If `serviceAccountJson` is provided it is
 * validated then encrypted at rest; metadata updates without it leave credentials intact.
 * Returns the public account (never the secret).
 */
export async function upsertPlayAccount(orgId: string, input: ConnectPlayInput): Promise<PlayAccount> {
  const now = Date.now();
  const existing = await getPlayAccount(orgId);

  let saJson: string | undefined;
  let saEmail: string | null = existing?.saEmail ?? null;
  let saProject: string | null = existing?.saProject ?? null;
  let verifiedAt: number | null = existing?.verifiedAt ?? null;

  if (input.serviceAccountJson && input.serviceAccountJson.trim()) {
    const parsed = parseServiceAccount(input.serviceAccountJson.trim());
    if (!parsed.ok) throw new Error(parsed.error);
    saJson = encryptSecret(input.serviceAccountJson.trim());
    saEmail = parsed.clientEmail;
    saProject = parsed.projectId || null;
    // structural validation passed; a live API check stamps verifiedAt later
    verifiedAt = null;
  } else if (!existing) {
    throw new Error('A service-account key is required to connect a Google Play account.');
  }

  const developerName = input.developerName !== undefined ? input.developerName : existing?.developerName ?? null;
  const developerId = input.developerId !== undefined ? input.developerId : existing?.developerId ?? null;
  const packagePrefix = input.packagePrefix !== undefined ? input.packagePrefix : existing?.packagePrefix ?? null;
  const defaultTrack: PlayTrack = input.defaultTrack || existing?.defaultTrack || 'internal';

  if (existing) {
    // Only overwrite sa_json/sa_email/sa_project when new credentials were supplied.
    if (saJson !== undefined) {
      await q(
        `UPDATE org_play_accounts SET developer_name=$1, developer_id=$2, package_prefix=$3, default_track=$4,
           sa_email=$5, sa_project=$6, sa_json=$7, verified_at=$8, updated_at=$9 WHERE org_id=$10`,
        [developerName, developerId, packagePrefix, defaultTrack, saEmail, saProject, saJson, verifiedAt, now, orgId],
      );
    } else {
      await q(
        `UPDATE org_play_accounts SET developer_name=$1, developer_id=$2, package_prefix=$3, default_track=$4, updated_at=$5 WHERE org_id=$6`,
        [developerName, developerId, packagePrefix, defaultTrack, now, orgId],
      );
    }
  } else {
    await q(
      `INSERT INTO org_play_accounts(org_id, developer_name, developer_id, package_prefix, default_track,
         sa_email, sa_project, sa_json, enabled, verified_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1,$9,$10,$11)`,
      [orgId, developerName, developerId, packagePrefix, defaultTrack, saEmail, saProject, saJson ?? null, verifiedAt, now, now],
    );
  }
  const out = await getPlayAccount(orgId);
  return out!;
}

export async function setPlayEnabled(orgId: string, enabled: boolean): Promise<void> {
  await q('UPDATE org_play_accounts SET enabled=$1, updated_at=$2 WHERE org_id=$3', [enabled ? 1 : 0, Date.now(), orgId]);
}

export async function markPlayVerified(orgId: string): Promise<void> {
  await q('UPDATE org_play_accounts SET verified_at=$1, updated_at=$1 WHERE org_id=$2', [Date.now(), orgId]);
}

export async function deletePlayAccount(orgId: string): Promise<void> {
  await q('DELETE FROM org_play_accounts WHERE org_id = $1', [orgId]);
}
