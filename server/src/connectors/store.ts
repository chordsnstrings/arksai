import { randomUUID } from 'node:crypto';
import { q, qOne } from '../db';
import { encryptSecret, decryptSecret } from './crypto';
import type { Connector, Provider, TokenSet } from './types';

interface Row {
  id: string;
  org_id: string;
  provider: string;
  account_id: string;
  account_name: string | null;
  access_token_enc: string;
  refresh_token_enc: string | null;
  expires_at: number | null;
  scopes: string | null;
  status: string;
  external_user_id: string | null;
}

function toConnector(r: Row): Connector {
  return {
    id: r.id,
    orgId: r.org_id,
    provider: r.provider as Provider,
    accountId: r.account_id,
    accountName: r.account_name,
    accessToken: decryptSecret(r.access_token_enc),
    refreshToken: r.refresh_token_enc ? decryptSecret(r.refresh_token_enc) : null,
    expiresAt: r.expires_at ?? null,
    scopes: r.scopes,
    status: (r.status as Connector['status']) ?? 'active',
    externalUserId: r.external_user_id ?? null,
  };
}

/** Public, token-free view for the API/UI — never leaks the tokens. */
export interface ConnectorPublic {
  id: string;
  provider: Provider;
  accountId: string;
  accountName: string | null;
  status: string;
  expiresAt: number | null;
}
export function toPublic(c: Connector): ConnectorPublic {
  return { id: c.id, provider: c.provider, accountId: c.accountId, accountName: c.accountName, status: c.status, expiresAt: c.expiresAt };
}

/** Upsert one connected ad account for an org (unique on org+provider+account). */
export async function saveConnector(
  orgId: string,
  provider: Provider,
  account: { id: string; name: string },
  tokens: TokenSet,
  createdBy: string | null,
): Promise<void> {
  const now = Date.now();
  const accessEnc = encryptSecret(tokens.accessToken);
  const refreshEnc = tokens.refreshToken ? encryptSecret(tokens.refreshToken) : null;
  const existing = await qOne<{ id: string }>(
    'SELECT id FROM connectors WHERE org_id = $1 AND provider = $2 AND account_id = $3',
    [orgId, provider, account.id],
  );
  const extUser = tokens.externalUserId ?? null;
  if (existing) {
    await q(
      `UPDATE connectors SET account_name=$1, access_token_enc=$2, refresh_token_enc=$3, expires_at=$4,
        scopes=$5, status='active', external_user_id=COALESCE($6, external_user_id), updated_at=$7 WHERE id=$8`,
      [account.name, accessEnc, refreshEnc, tokens.expiresAt ?? null, tokens.scopes ?? null, extUser, now, existing.id],
    );
    return;
  }
  await q(
    `INSERT INTO connectors(id, org_id, provider, account_id, account_name, access_token_enc, refresh_token_enc,
      expires_at, scopes, status, external_user_id, created_by, created_at, updated_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'active',$10,$11,$12,$13)`,
    [randomUUID(), orgId, provider, account.id, account.name, accessEnc, refreshEnc,
      tokens.expiresAt ?? null, tokens.scopes ?? null, extUser, createdBy, now, now],
  );
}

/** Same as saveConnector but returns the connector id (so Pages can be linked to it). */
export async function saveConnectorReturningId(
  orgId: string,
  provider: Provider,
  account: { id: string; name: string },
  tokens: TokenSet,
  createdBy: string | null,
): Promise<string> {
  await saveConnector(orgId, provider, account, tokens, createdBy);
  const row = await qOne<{ id: string }>(
    'SELECT id FROM connectors WHERE org_id = $1 AND provider = $2 AND account_id = $3',
    [orgId, provider, account.id],
  );
  return row!.id;
}

export interface MetaPageRow {
  id: string;
  pageId: string;
  name: string | null;
  category: string | null;
  igUserId: string | null;
  igUsername: string | null;
}

/** Upsert the Pages a Meta connection manages (page tokens encrypted at rest). Idempotent
 *  on (connector, page) — a reconnect refreshes tokens + names without duplicating. */
export async function saveMetaPages(
  orgId: string,
  connectorId: string,
  pages: NonNullable<TokenSet['pages']>,
): Promise<void> {
  const now = Date.now();
  for (const p of pages) {
    if (!p.id) continue;
    const enc = encryptSecret(p.accessToken || '');
    const existing = await qOne<{ id: string }>(
      'SELECT id FROM meta_pages WHERE connector_id = $1 AND page_id = $2',
      [connectorId, p.id],
    );
    if (existing) {
      await q(
        `UPDATE meta_pages SET name=$1, category=$2, page_token_enc=$3, ig_user_id=$4, ig_username=$5, updated_at=$6 WHERE id=$7`,
        [p.name, p.category, enc, p.igUserId, p.igUsername, now, existing.id],
      );
    } else {
      await q(
        `INSERT INTO meta_pages(id, org_id, connector_id, page_id, name, category, page_token_enc, ig_user_id, ig_username, created_at, updated_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [randomUUID(), orgId, connectorId, p.id, p.name, p.category, enc, p.igUserId, p.igUsername, now, now],
      );
    }
  }
}

/** All Pages across an org's Meta connections (token-free view for the API/UI). */
export async function listMetaPages(orgId: string): Promise<MetaPageRow[]> {
  const rows = await q<{ id: string; page_id: string; name: string | null; category: string | null; ig_user_id: string | null; ig_username: string | null }>(
    'SELECT id, page_id, name, category, ig_user_id, ig_username FROM meta_pages WHERE org_id = $1 ORDER BY name',
    [orgId],
  );
  return rows.map((r) => ({ id: r.id, pageId: r.page_id, name: r.name, category: r.category, igUserId: r.ig_user_id, igUsername: r.ig_username }));
}

/** One Page WITH its decrypted token (server-side only — for insights/posts). */
export async function getMetaPageWithToken(orgId: string, pageRowId: string): Promise<(MetaPageRow & { pageToken: string }) | null> {
  const r = await qOne<{ id: string; page_id: string; name: string | null; category: string | null; page_token_enc: string; ig_user_id: string | null; ig_username: string | null }>(
    'SELECT id, page_id, name, category, page_token_enc, ig_user_id, ig_username FROM meta_pages WHERE id = $1 AND org_id = $2',
    [pageRowId, orgId],
  );
  if (!r) return null;
  return { id: r.id, pageId: r.page_id, name: r.name, category: r.category, igUserId: r.ig_user_id, igUsername: r.ig_username, pageToken: decryptSecret(r.page_token_enc) };
}

/** Persist refreshed tokens for an existing connector. */
export async function updateTokens(id: string, tokens: TokenSet): Promise<void> {
  await q(
    `UPDATE connectors SET access_token_enc=$1, refresh_token_enc=COALESCE($2, refresh_token_enc),
      expires_at=$3, status='active', updated_at=$4 WHERE id=$5`,
    [encryptSecret(tokens.accessToken), tokens.refreshToken ? encryptSecret(tokens.refreshToken) : null,
      tokens.expiresAt ?? null, Date.now(), id],
  );
}

export async function markStatus(id: string, status: Connector['status']): Promise<void> {
  await q('UPDATE connectors SET status=$1, updated_at=$2 WHERE id=$3', [status, Date.now(), id]);
}

/** All connectors for an org (decrypted; server-side use only). */
export async function listConnectors(orgId: string): Promise<Connector[]> {
  const rows = await q<Row>('SELECT * FROM connectors WHERE org_id = $1 ORDER BY provider, account_name', [orgId]);
  return rows.map(toConnector);
}

/** A specific connector, ORG-SCOPED (returns null cross-org → no leakage). */
export async function getConnector(orgId: string, id: string): Promise<Connector | null> {
  const r = await qOne<Row>('SELECT * FROM connectors WHERE id = $1 AND org_id = $2', [id, orgId]);
  return r ? toConnector(r) : null;
}

/** The first active connector for a provider in an org (the default when none specified). */
export async function findForProvider(orgId: string, provider: Provider, accountId?: string): Promise<Connector | null> {
  const list = (await listConnectors(orgId)).filter((c) => c.provider === provider && c.status === 'active');
  if (accountId) return list.find((c) => c.accountId === accountId) ?? null;
  return list[0] ?? null;
}

export async function deleteConnector(orgId: string, id: string): Promise<boolean> {
  const c = await getConnector(orgId, id);
  if (!c) return false;
  await q('DELETE FROM meta_pages WHERE connector_id = $1 AND org_id = $2', [id, orgId]);
  await q('DELETE FROM connectors WHERE id = $1 AND org_id = $2', [id, orgId]);
  return true;
}

/** Delete every connector for an org (used by org deletion cascade). */
export async function deleteConnectorsForOrg(orgId: string): Promise<void> {
  await q('DELETE FROM meta_pages WHERE org_id = $1', [orgId]);
  await q('DELETE FROM connectors WHERE org_id = $1', [orgId]);
}

/** Purge every connector granted by a provider's app-scoped user (the Data Deletion /
 *  Deauthorize callback path). Cross-org by design — one user may have connected accounts
 *  in more than one org. Returns how many rows were removed. */
export async function deleteConnectorsByExternalUser(provider: Provider, externalUserId: string): Promise<number> {
  if (!externalUserId) return 0;
  const rows = await q<{ id: string }>(
    'SELECT id FROM connectors WHERE provider = $1 AND external_user_id = $2',
    [provider, externalUserId],
  );
  if (rows.length) {
    for (const r of rows) await q('DELETE FROM meta_pages WHERE connector_id = $1', [r.id]);
    await q('DELETE FROM connectors WHERE provider = $1 AND external_user_id = $2', [provider, externalUserId]);
  }
  return rows.length;
}

/** Record a data-deletion request (backs the user-accessible status page). */
export interface DeletionRecord {
  code: string;
  provider: Provider;
  externalUserId: string | null;
  connectorsDeleted: number;
  status: 'completed' | 'pending';
  createdAt: number;
}
export async function recordDeletionRequest(rec: DeletionRecord): Promise<void> {
  await q(
    `INSERT INTO data_deletion_requests(code, provider, external_user_id, connectors_deleted, status, created_at)
     VALUES($1,$2,$3,$4,$5,$6)`,
    [rec.code, rec.provider, rec.externalUserId, rec.connectorsDeleted, rec.status, rec.createdAt],
  );
}
export async function getDeletionRequest(code: string): Promise<DeletionRecord | null> {
  const r = await qOne<{
    code: string; provider: string; external_user_id: string | null;
    connectors_deleted: number; status: string; created_at: number;
  }>('SELECT * FROM data_deletion_requests WHERE code = $1', [code]);
  if (!r) return null;
  return {
    code: r.code,
    provider: r.provider as Provider,
    externalUserId: r.external_user_id ?? null,
    connectorsDeleted: r.connectors_deleted ?? 0,
    status: (r.status as DeletionRecord['status']) ?? 'completed',
    createdAt: r.created_at,
  };
}
