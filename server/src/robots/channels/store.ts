import { randomUUID } from 'node:crypto';
import type { RobotChannel, RobotChannelKind } from '../../../../shared/types';
import { q, qOne } from '../../db';
import { decryptSecret, encryptSecret } from '../../lib/crypto';
import type { ChannelSecrets, ChannelWithSecrets } from './types';

/**
 * robot_channels data layer. Secrets are AES-256-GCM encrypted at rest as one JSON blob and
 * WRITE-ONLY over the API — reads return `hasSecrets` + the plain meta, never the values.
 * Org scoping is the caller's job (routes pass the authenticated orgId).
 */

function parseJson<T>(s: any, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

function rowToChannel(r: any): RobotChannel {
  return {
    id: r.id,
    robotId: r.robot_id,
    orgId: r.org_id,
    kind: r.kind,
    label: r.label ?? null,
    meta: parseJson<Record<string, string>>(r.meta, {}),
    enabled: !!Number(r.enabled),
    hasSecrets: !!r.secrets,
    verifiedAt: r.verified_at != null ? Number(r.verified_at) : null,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

export async function listChannels(robotId: string, orgId?: string): Promise<RobotChannel[]> {
  const rows = await q('SELECT * FROM robot_channels WHERE robot_id = $1 ORDER BY created_at', [robotId]);
  return rows.map(rowToChannel).filter((c) => orgId == null || c.orgId === orgId);
}

export async function getChannel(robotId: string, kind: RobotChannelKind): Promise<RobotChannel | null> {
  const r = await qOne('SELECT * FROM robot_channels WHERE robot_id = $1 AND kind = $2', [robotId, kind]);
  return r ? rowToChannel(r) : null;
}

/** Decrypted secrets — server-side only. */
export async function channelSecrets(robotId: string, kind: RobotChannelKind): Promise<ChannelSecrets> {
  const r = await qOne<{ secrets: string | null }>(
    'SELECT secrets FROM robot_channels WHERE robot_id = $1 AND kind = $2',
    [robotId, kind],
  );
  if (!r?.secrets) return {};
  return parseJson<ChannelSecrets>(decryptSecret(r.secrets), {});
}

export async function withSecrets(robotId: string, kind: RobotChannelKind): Promise<ChannelWithSecrets | null> {
  const channel = await getChannel(robotId, kind);
  if (!channel) return null;
  return { channel, secrets: await channelSecrets(robotId, kind) };
}

/** The first enabled channel of a kind in an org, with its decrypted secrets (Track A/C use
 *  this to publish/advertise on the org's connected Facebook Page + Instagram). */
export async function findChannelForOrg(orgId: string, kind: RobotChannelKind): Promise<ChannelWithSecrets | null> {
  const r = await qOne('SELECT * FROM robot_channels WHERE org_id = $1 AND kind = $2 AND enabled = 1 ORDER BY created_at LIMIT 1', [orgId, kind]);
  if (!r) return null;
  const channel = rowToChannel(r);
  return { channel, secrets: await channelSecrets(channel.robotId, kind) };
}

export interface UpsertChannelInput {
  label?: string | null;
  /** New secret values to store (merged over existing — an omitted key keeps its value). */
  secrets?: ChannelSecrets;
  meta?: Record<string, string>;
  enabled?: boolean;
}

export async function upsertChannel(
  robotId: string,
  orgId: string,
  kind: RobotChannelKind,
  input: UpsertChannelInput,
): Promise<RobotChannel> {
  const existing = await getChannel(robotId, kind);
  const now = Date.now();
  // Merge secrets: keep stored values unless a new non-empty value is supplied.
  const stored = existing ? await channelSecrets(robotId, kind) : {};
  const merged: ChannelSecrets = { ...stored };
  for (const [k, v] of Object.entries(input.secrets ?? {})) {
    if (typeof v === 'string' && v.trim()) merged[k] = v.trim();
  }
  const secretsEnc = Object.keys(merged).length ? encryptSecret(JSON.stringify(merged)) : null;
  const meta = JSON.stringify({ ...(existing?.meta ?? {}), ...(input.meta ?? {}) });
  if (existing) {
    await q(
      `UPDATE robot_channels SET label = $1, secrets = $2, meta = $3, enabled = $4, updated_at = $5
       WHERE robot_id = $6 AND kind = $7`,
      [
        input.label !== undefined ? input.label : existing.label,
        secretsEnc,
        meta,
        (input.enabled ?? existing.enabled) ? 1 : 0,
        now,
        robotId,
        kind,
      ],
    );
  } else {
    await q(
      `INSERT INTO robot_channels(id, robot_id, org_id, kind, label, secrets, meta, state, enabled, verified_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [randomUUID(), robotId, orgId, kind, input.label ?? null, secretsEnc, meta, null, (input.enabled ?? true) ? 1 : 0, null, now, now],
    );
  }
  return (await getChannel(robotId, kind))!;
}

export async function deleteChannel(robotId: string, orgId: string, kind: RobotChannelKind): Promise<void> {
  await q('DELETE FROM robot_channels WHERE robot_id = $1 AND org_id = $2 AND kind = $3', [robotId, orgId, kind]);
}

export async function markChannelVerified(robotId: string, kind: RobotChannelKind): Promise<void> {
  await q('UPDATE robot_channels SET verified_at = $1 WHERE robot_id = $2 AND kind = $3', [Date.now(), robotId, kind]);
}

/** Adapter runtime state (e.g. the Telegram getUpdates offset) — small JSON, adapter-owned. */
export async function getChannelState(robotId: string, kind: RobotChannelKind): Promise<Record<string, any>> {
  const r = await qOne<{ state: string | null }>(
    'SELECT state FROM robot_channels WHERE robot_id = $1 AND kind = $2',
    [robotId, kind],
  );
  return parseJson<Record<string, any>>(r?.state, {});
}

export async function setChannelState(robotId: string, kind: RobotChannelKind, state: Record<string, any>): Promise<void> {
  await q('UPDATE robot_channels SET state = $1 WHERE robot_id = $2 AND kind = $3', [JSON.stringify(state), robotId, kind]);
}

/** All enabled channels of a kind across orgs — webhook routes match inbound to a robot. */
export async function listEnabledChannelsByKind(kind: RobotChannelKind): Promise<RobotChannel[]> {
  const rows = await q('SELECT * FROM robot_channels WHERE kind = $1 AND enabled = 1', [kind]);
  return rows.map(rowToChannel);
}
