import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { q, qOne } from '../db';

/**
 * Multi-org data layer: organizations ("spaces"), users, memberships, invite
 * links, and DB-backed auth sessions. Kept separate from sessions/store.ts (the
 * studio data) so the tenancy/identity concern is self-contained. All tokens are
 * stored only as SHA-256 hashes; passwords use Node's built-in scrypt. The
 * legacy single APP_PASSWORD login is preserved by auth.ts as a platform
 * "super-admin" that sits above all orgs — so existing deployments keep working.
 */

export type Role = 'admin' | 'member';
export interface Org {
  id: string;
  name: string;
  slug: string;
  createdAt: number;
}
export interface User {
  id: string;
  email: string;
  name: string | null;
  isSuperadmin: boolean;
  createdAt: number;
}
export interface Membership {
  id: string;
  userId: string;
  orgId: string;
  role: Role;
  createdAt: number;
}
export interface OrgMember extends Membership {
  email: string;
  name: string | null;
}
export interface Invite {
  id: string;
  orgId: string;
  email: string;
  role: Role;
  invitedBy: string | null;
  expiresAt: number;
  acceptedAt: number | null;
  createdAt: number;
}
/** Resolved per-request identity. `superadmin` = the platform operator (sees every org). */
export interface Identity {
  userId: string;
  email: string;
  orgId: string | null;
  role: Role | 'superadmin';
  isSuperadmin: boolean;
}

export const DEFAULT_ORG_ID = 'default';

// ---- password hashing (scrypt; format "scrypt$<saltHex>$<hashHex>") ----
export function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pw, salt, 32);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}
export function verifyPassword(pw: string, stored: string | null | undefined): boolean {
  const parts = String(stored || '').split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  try {
    const salt = Buffer.from(parts[1], 'hex');
    const expected = Buffer.from(parts[2], 'hex');
    const actual = scryptSync(pw, salt, expected.length);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const slugify = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40) || 'org';

// ---- orgs ----
const rowToOrg = (r: any): Org => ({ id: r.id, name: r.name, slug: r.slug, createdAt: Number(r.created_at) });

export async function createOrg(name: string): Promise<Org> {
  const id = randomUUID();
  const now = Date.now();
  let slug = slugify(name);
  if (await qOne('SELECT id FROM orgs WHERE slug = $1', [slug])) slug = `${slug}-${id.slice(0, 4)}`;
  await q('INSERT INTO orgs(id, name, slug, created_at) VALUES ($1,$2,$3,$4)', [id, name, slug, now]);
  return { id, name, slug, createdAt: now };
}
export async function getOrg(id: string): Promise<Org | null> {
  const r = await qOne('SELECT * FROM orgs WHERE id = $1', [id]);
  return r ? rowToOrg(r) : null;
}
export async function listOrgs(): Promise<Org[]> {
  return (await q('SELECT * FROM orgs ORDER BY created_at ASC')).map(rowToOrg);
}
export async function updateOrgName(id: string, name: string): Promise<void> {
  await q('UPDATE orgs SET name = $1 WHERE id = $2', [name, id]);
}

// ---- users ----
const rowToUser = (r: any): User => ({
  id: r.id,
  email: r.email,
  name: r.name ?? null,
  isSuperadmin: !!Number(r.is_superadmin),
  createdAt: Number(r.created_at),
});
export async function getUser(id: string): Promise<User | null> {
  const r = await qOne('SELECT * FROM users WHERE id = $1', [id]);
  return r ? rowToUser(r) : null;
}
export async function getUserByEmail(email: string): Promise<(User & { passwordHash: string | null }) | null> {
  const r = await qOne('SELECT * FROM users WHERE lower(email) = lower($1)', [email]);
  return r ? { ...rowToUser(r), passwordHash: r.password_hash ?? null } : null;
}
export async function createUser(opts: {
  email: string;
  password?: string | null;
  name?: string | null;
  isSuperadmin?: boolean;
}): Promise<User> {
  const id = randomUUID();
  const now = Date.now();
  await q('INSERT INTO users(id, email, password_hash, name, is_superadmin, created_at) VALUES ($1,$2,$3,$4,$5,$6)', [
    id,
    opts.email,
    opts.password ? hashPassword(opts.password) : null,
    opts.name ?? null,
    opts.isSuperadmin ? 1 : 0,
    now,
  ]);
  return { id, email: opts.email, name: opts.name ?? null, isSuperadmin: !!opts.isSuperadmin, createdAt: now };
}
export async function setPassword(userId: string, password: string): Promise<void> {
  await q('UPDATE users SET password_hash = $1 WHERE id = $2', [hashPassword(password), userId]);
}

// ---- memberships ----
const rowToMembership = (r: any): Membership => ({
  id: r.id,
  userId: r.user_id,
  orgId: r.org_id,
  role: r.role as Role,
  createdAt: Number(r.created_at),
});
export async function addMembership(userId: string, orgId: string, role: Role): Promise<Membership> {
  const existing = await qOne('SELECT * FROM memberships WHERE user_id = $1 AND org_id = $2', [userId, orgId]);
  if (existing) {
    await q('UPDATE memberships SET role = $1 WHERE id = $2', [role, existing.id]);
    return rowToMembership({ ...existing, role });
  }
  const id = randomUUID();
  const now = Date.now();
  await q('INSERT INTO memberships(id, user_id, org_id, role, created_at) VALUES ($1,$2,$3,$4,$5)', [id, userId, orgId, role, now]);
  return { id, userId, orgId, role, createdAt: now };
}
export async function removeMembership(userId: string, orgId: string): Promise<void> {
  await q('DELETE FROM memberships WHERE user_id = $1 AND org_id = $2', [userId, orgId]);
  // Instant revoke: kill any live session that was scoped to this org.
  await q('DELETE FROM auth_sessions WHERE user_id = $1 AND current_org_id = $2', [userId, orgId]);
}
export async function membershipsForUser(userId: string): Promise<Membership[]> {
  return (await q('SELECT * FROM memberships WHERE user_id = $1 ORDER BY created_at ASC', [userId])).map(rowToMembership);
}
export async function roleInOrg(userId: string, orgId: string): Promise<Role | null> {
  const r = await qOne('SELECT role FROM memberships WHERE user_id = $1 AND org_id = $2', [userId, orgId]);
  return r ? (r.role as Role) : null;
}
export async function orgsForUser(userId: string): Promise<Org[]> {
  const rows = await q(
    'SELECT o.* FROM orgs o JOIN memberships m ON m.org_id = o.id WHERE m.user_id = $1 ORDER BY o.created_at ASC',
    [userId],
  );
  return rows.map(rowToOrg);
}
export async function membersOfOrg(orgId: string): Promise<OrgMember[]> {
  const rows = await q(
    'SELECT m.*, u.email AS email, u.name AS name FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.org_id = $1 ORDER BY m.created_at ASC',
    [orgId],
  );
  return rows.map((r: any) => ({ ...rowToMembership(r), email: r.email, name: r.name ?? null }));
}

// ---- invites (a one-time link; only the token hash is stored) ----
const rowToInvite = (r: any): Invite => ({
  id: r.id,
  orgId: r.org_id,
  email: r.email,
  role: r.role as Role,
  invitedBy: r.invited_by ?? null,
  expiresAt: Number(r.expires_at),
  acceptedAt: r.accepted_at != null ? Number(r.accepted_at) : null,
  createdAt: Number(r.created_at),
});
export async function createInvite(opts: {
  orgId: string;
  email: string;
  role: Role;
  invitedBy?: string | null;
  ttlMs?: number;
}): Promise<{ invite: Invite; token: string }> {
  const id = randomUUID();
  const now = Date.now();
  const token = randomBytes(24).toString('base64url');
  const expiresAt = now + (opts.ttlMs ?? 7 * 24 * 3600_000);
  await q(
    'INSERT INTO invites(id, org_id, email, role, token_hash, invited_by, expires_at, accepted_at, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,NULL,$8)',
    [id, opts.orgId, opts.email, opts.role, sha256(token), opts.invitedBy ?? null, expiresAt, now],
  );
  return {
    invite: { id, orgId: opts.orgId, email: opts.email, role: opts.role, invitedBy: opts.invitedBy ?? null, expiresAt, acceptedAt: null, createdAt: now },
    token,
  };
}
export async function listInvitesForOrg(orgId: string): Promise<Invite[]> {
  return (await q('SELECT * FROM invites WHERE org_id = $1 ORDER BY created_at DESC', [orgId])).map(rowToInvite);
}
export async function acceptInvite(
  token: string,
  password: string,
  name?: string | null,
): Promise<{ user: User; orgId: string } | { error: string }> {
  const r = await qOne('SELECT * FROM invites WHERE token_hash = $1', [sha256(token)]);
  if (!r) return { error: 'Invalid invite link.' };
  if (r.accepted_at) return { error: 'This invite has already been used.' };
  if (Number(r.expires_at) < Date.now()) return { error: 'This invite has expired.' };
  if (!password || password.length < 8) return { error: 'Choose a password of at least 8 characters.' };
  const existing = await getUserByEmail(r.email);
  let userId: string;
  if (existing) {
    await setPassword(existing.id, password);
    userId = existing.id;
  } else {
    userId = (await createUser({ email: r.email, password, name })).id;
  }
  await addMembership(userId, r.org_id, r.role as Role);
  await q('UPDATE invites SET accepted_at = $1 WHERE id = $2', [Date.now(), r.id]);
  return { user: (await getUser(userId))!, orgId: r.org_id };
}

// ---- DB-backed auth sessions (opaque token in a cookie; instant-revocable) ----
export async function createAuthSession(userId: string, currentOrgId: string | null, ttlMs = 30 * 24 * 3600_000): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  await q(
    'INSERT INTO auth_sessions(id, user_id, token_hash, current_org_id, created_at, expires_at, last_seen_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [randomUUID(), userId, sha256(token), currentOrgId, now, now + ttlMs, now],
  );
  return token;
}
export async function resolveAuthSession(token: string): Promise<{ userId: string; currentOrgId: string | null } | null> {
  const r = await qOne('SELECT * FROM auth_sessions WHERE token_hash = $1', [sha256(token)]);
  if (!r) return null;
  if (Number(r.expires_at) < Date.now()) {
    await q('DELETE FROM auth_sessions WHERE id = $1', [r.id]);
    return null;
  }
  return { userId: r.user_id, currentOrgId: r.current_org_id ?? null };
}
export async function revokeAuthSession(token: string): Promise<void> {
  await q('DELETE FROM auth_sessions WHERE token_hash = $1', [sha256(token)]);
}
export async function setSessionOrg(token: string, orgId: string): Promise<void> {
  await q('UPDATE auth_sessions SET current_org_id = $1 WHERE token_hash = $2', [orgId, sha256(token)]);
}

/**
 * Boot-time bootstrap: ensure a "Default" org exists and that every legacy row
 * (created before multi-org) is stamped into it, so nothing is orphaned and the
 * existing operator keeps seeing all of their data. Idempotent.
 */
export async function bootstrapOrgs(): Promise<void> {
  if (!(await qOne('SELECT id FROM orgs WHERE id = $1', [DEFAULT_ORG_ID]))) {
    await q('INSERT INTO orgs(id, name, slug, created_at) VALUES ($1,$2,$3,$4)', [DEFAULT_ORG_ID, 'Default', 'default', Date.now()]);
  }
  for (const t of ['sessions', 'projects', 'deployments', 'schedules']) {
    await q(`UPDATE ${t} SET org_id = $1 WHERE org_id IS NULL`, [DEFAULT_ORG_ID]).catch(() => {});
  }
}
