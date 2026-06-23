import { randomUUID } from 'node:crypto';
import { q, qOne } from '../db';
import { encryptSecret, decryptSecret } from '../connectors/crypto';

/**
 * Per-user GitHub connection store. The access token is AES-256-GCM encrypted at rest (reusing
 * the connector crypto) and decrypted only inside the server (push/clone + repo listing). The
 * public view is token-free; the raw token never leaves the server or reaches the model.
 */

export interface GithubConnection {
  id: string;
  userId: string;
  orgId: string | null;
  login: string | null;
  githubUserId: string | null;
  avatarUrl: string | null;
  accessToken: string; // decrypted
  scopes: string | null;
  status: 'active' | 'error' | 'revoked';
}

export interface GithubConnectionPublic {
  id: string;
  login: string | null;
  avatarUrl: string | null;
  status: string;
}

interface Row {
  id: string;
  user_id: string;
  org_id: string | null;
  github_login: string | null;
  github_user_id: string | null;
  avatar_url: string | null;
  access_token_enc: string;
  scopes: string | null;
  status: string;
}

function toConn(r: Row): GithubConnection {
  return {
    id: r.id,
    userId: r.user_id,
    orgId: r.org_id ?? null,
    login: r.github_login,
    githubUserId: r.github_user_id,
    avatarUrl: r.avatar_url,
    accessToken: decryptSecret(r.access_token_enc),
    scopes: r.scopes,
    status: (r.status as GithubConnection['status']) ?? 'active',
  };
}

export function toPublic(c: GithubConnection): GithubConnectionPublic {
  return { id: c.id, login: c.login, avatarUrl: c.avatarUrl, status: c.status };
}

const SELECT = 'id, user_id, org_id, github_login, github_user_id, avatar_url, access_token_enc, scopes, status';

/** Upsert the caller's GitHub connection (one per user — reconnect replaces). */
export async function saveConnection(
  userId: string,
  orgId: string | null,
  identity: { login: string; id: string; avatarUrl: string | null },
  token: { accessToken: string; scopes: string | null },
): Promise<void> {
  const now = Date.now();
  const enc = encryptSecret(token.accessToken);
  const existing = await qOne<{ id: string }>('SELECT id FROM github_connections WHERE user_id = $1', [userId]);
  if (existing) {
    await q(
      `UPDATE github_connections SET org_id=$1, github_login=$2, github_user_id=$3, avatar_url=$4, access_token_enc=$5, scopes=$6, status='active', updated_at=$7 WHERE id=$8`,
      [orgId, identity.login, identity.id, identity.avatarUrl, enc, token.scopes, now, existing.id],
    );
  } else {
    await q(
      `INSERT INTO github_connections(id, user_id, org_id, github_login, github_user_id, avatar_url, access_token_enc, scopes, status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active',$9,$10)`,
      [randomUUID(), userId, orgId, identity.login, identity.id, identity.avatarUrl, enc, token.scopes, now, now],
    );
  }
}

/** The caller's connection (full, with decrypted token). Resolved BY userId → strict isolation. */
export async function getConnectionForUser(userId: string): Promise<GithubConnection | null> {
  const row = await qOne<Row>(`SELECT ${SELECT} FROM github_connections WHERE user_id = $1`, [userId]);
  return row ? toConn(row) : null;
}

/** A connection by its id, but ONLY if it belongs to the given user (isolation). */
export async function getConnectionByIdForUser(id: string, userId: string): Promise<GithubConnection | null> {
  const row = await qOne<Row>(`SELECT ${SELECT} FROM github_connections WHERE id = $1 AND user_id = $2`, [id, userId]);
  return row ? toConn(row) : null;
}

/** A connection by id with no user filter — for the runner/push path (server-internal only). */
export async function getConnectionById(id: string): Promise<GithubConnection | null> {
  const row = await qOne<Row>(`SELECT ${SELECT} FROM github_connections WHERE id = $1`, [id]);
  return row ? toConn(row) : null;
}

export async function deleteConnectionForUser(userId: string): Promise<boolean> {
  const existing = await qOne<{ id: string }>('SELECT id FROM github_connections WHERE user_id = $1', [userId]);
  if (!existing) return false;
  await q('DELETE FROM github_connections WHERE user_id = $1', [userId]);
  return true;
}

export async function markStatus(id: string, status: GithubConnection['status']): Promise<void> {
  await q('UPDATE github_connections SET status = $1, updated_at = $2 WHERE id = $3', [status, Date.now(), id]);
}
