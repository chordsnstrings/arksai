import { randomUUID, randomBytes } from 'node:crypto';
import { q, qOne } from '../db';

export type BuildStatus = 'queued' | 'provisioning' | 'building' | 'success' | 'error';

export interface Build {
  id: string;
  session_id: string | null;
  org_id: string | null;
  platform: string; // 'android'
  app_name: string;
  status: BuildStatus;
  phase: string | null;
  droplet_id: string | null;
  token: string; // one-time bearer the build droplet uses to POST the artifact back
  artifact_path: string | null;
  size_bytes: number | null;
  cost: number | null;
  error: string | null;
  created_at: number;
  updated_at: number;
}

export async function createBuild(input: {
  sessionId: string | null;
  orgId: string | null;
  appName: string;
  platform?: string;
}): Promise<Build> {
  const now = Date.now();
  const b: Build = {
    id: randomUUID(),
    session_id: input.sessionId,
    org_id: input.orgId,
    platform: input.platform || 'android',
    app_name: input.appName,
    status: 'queued',
    phase: 'queued',
    droplet_id: null,
    token: randomBytes(24).toString('hex'),
    artifact_path: null,
    size_bytes: null,
    cost: null,
    error: null,
    created_at: now,
    updated_at: now,
  };
  await q(
    `INSERT INTO builds(id, session_id, org_id, platform, app_name, status, phase, droplet_id, token, artifact_path, size_bytes, cost, error, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [b.id, b.session_id, b.org_id, b.platform, b.app_name, b.status, b.phase, b.droplet_id, b.token, b.artifact_path, b.size_bytes, b.cost, b.error, b.created_at, b.updated_at],
  );
  return b;
}

export async function getBuild(id: string): Promise<Build | null> {
  return qOne<Build>('SELECT * FROM builds WHERE id = $1', [id]);
}

export async function updateBuild(id: string, patch: Partial<Build>): Promise<void> {
  const cols = Object.keys(patch);
  if (!cols.length) return;
  // NOTE: SQLite rewrites every $N→? POSITIONALLY (by appearance order), so params must
  // be ordered exactly as the placeholders appear in the SQL — set-cols, then updated_at,
  // then the id in the WHERE. (Numbering them sequentially keeps PG correct too.)
  const sets = cols.map((c, i) => `${c} = $${i + 1}`).join(', ');
  await q(`UPDATE builds SET ${sets}, updated_at = $${cols.length + 1} WHERE id = $${cols.length + 2}`, [
    ...cols.map((c) => (patch as any)[c]),
    Date.now(),
    id,
  ]);
}

export async function listBuildsForSession(sessionId: string): Promise<Build[]> {
  return q<Build>('SELECT * FROM builds WHERE session_id = $1 ORDER BY created_at DESC', [sessionId]);
}

/** Builds still in flight (for the orphan reaper / timeout sweep). */
export async function listActiveBuilds(): Promise<Build[]> {
  return q<Build>("SELECT * FROM builds WHERE status IN ('queued','provisioning','building')", []);
}
