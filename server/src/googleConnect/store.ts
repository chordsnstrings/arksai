import { randomUUID } from 'node:crypto';
import { q, qOne } from '../db';
import { encryptSecret, decryptSecret } from '../lib/crypto';

/**
 * Per-user Google Workspace connection store. Access + refresh tokens are AES-256-GCM encrypted at
 * rest (lib/crypto → ENCRYPTION_KEY||APP_PASSWORD) and decrypted only inside the server. The public
 * view is token-free; raw tokens never leave the server or reach the model. One row per user.
 */

export interface GoogleConnection {
  id: string;
  userId: string;
  orgId: string | null;
  email: string | null;
  accessToken: string; // decrypted
  refreshToken: string | null; // decrypted
  scopes: string | null;
  expiresAt: number | null;
  status: 'active' | 'error' | 'revoked';
}

export interface GoogleConnectionPublic {
  connected: boolean;
  email: string | null;
  scopes: string | null;
  status: string;
}

interface Row {
  id: string;
  user_id: string;
  org_id: string | null;
  email: string | null;
  access_token_enc: string;
  refresh_token_enc: string | null;
  scopes: string | null;
  expires_at: number | null;
  status: string;
}

function toConn(r: Row): GoogleConnection {
  return {
    id: r.id,
    userId: r.user_id,
    orgId: r.org_id ?? null,
    email: r.email,
    accessToken: decryptSecret(r.access_token_enc),
    refreshToken: r.refresh_token_enc ? decryptSecret(r.refresh_token_enc) : null,
    scopes: r.scopes,
    expiresAt: r.expires_at != null ? Number(r.expires_at) : null,
    status: (r.status as GoogleConnection['status']) ?? 'active',
  };
}

export function toPublic(c: GoogleConnection | null): GoogleConnectionPublic {
  if (!c) return { connected: false, email: null, scopes: null, status: 'none' };
  return { connected: c.status === 'active', email: c.email, scopes: c.scopes, status: c.status };
}

const SELECT = 'id, user_id, org_id, email, access_token_enc, refresh_token_enc, scopes, expires_at, status';

/** Upsert the caller's Google connection (one per user — reconnect replaces). A refresh token is
 *  only returned by Google on the FIRST consent, so keep the existing one when a re-auth omits it. */
export async function saveConnection(
  userId: string,
  orgId: string | null,
  email: string | null,
  tokens: { accessToken: string; refreshToken?: string | null; scopes?: string | null; expiresAt?: number | null },
): Promise<void> {
  const now = Date.now();
  const accessEnc = encryptSecret(tokens.accessToken);
  const existing = await qOne<{ id: string; refresh_token_enc: string | null }>(
    'SELECT id, refresh_token_enc FROM google_connections WHERE user_id = $1',
    [userId],
  );
  const refreshEnc = tokens.refreshToken ? encryptSecret(tokens.refreshToken) : existing?.refresh_token_enc ?? null;
  if (existing) {
    await q(
      `UPDATE google_connections SET org_id=$1, email=$2, access_token_enc=$3, refresh_token_enc=$4, scopes=$5, expires_at=$6, status='active', updated_at=$7 WHERE id=$8`,
      [orgId, email, accessEnc, refreshEnc, tokens.scopes ?? null, tokens.expiresAt ?? null, now, existing.id],
    );
  } else {
    await q(
      `INSERT INTO google_connections(id, user_id, org_id, email, access_token_enc, refresh_token_enc, scopes, expires_at, status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active',$9,$10)`,
      [randomUUID(), userId, orgId, email, accessEnc, refreshEnc, tokens.scopes ?? null, tokens.expiresAt ?? null, now, now],
    );
  }
}

/** The caller's connection (full, with decrypted tokens). Resolved BY userId → strict isolation. */
export async function getConnectionForUser(userId: string): Promise<GoogleConnection | null> {
  const row = await qOne<Row>(`SELECT ${SELECT} FROM google_connections WHERE user_id = $1`, [userId]);
  return row ? toConn(row) : null;
}

/** Persist a freshly-refreshed access token (+ new expiry). */
export async function updateAccessToken(userId: string, accessToken: string, expiresAt: number | null): Promise<void> {
  await q('UPDATE google_connections SET access_token_enc=$1, expires_at=$2, status=\'active\', updated_at=$3 WHERE user_id=$4', [
    encryptSecret(accessToken),
    expiresAt,
    Date.now(),
    userId,
  ]);
}

export async function deleteConnectionForUser(userId: string): Promise<boolean> {
  const existing = await qOne<{ id: string }>('SELECT id FROM google_connections WHERE user_id = $1', [userId]);
  if (!existing) return false;
  await q('DELETE FROM google_connections WHERE user_id = $1', [userId]);
  return true;
}

export async function markStatus(userId: string, status: GoogleConnection['status']): Promise<void> {
  await q('UPDATE google_connections SET status=$1, updated_at=$2 WHERE user_id=$3', [status, Date.now(), userId]);
}
