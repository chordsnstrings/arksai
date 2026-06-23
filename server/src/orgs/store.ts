import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import type { OrgProfile } from '../../../shared/types';
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
  currency?: string | null;
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
const rowToOrg = (r: any): Org => ({ id: r.id, name: r.name, slug: r.slug, currency: r.currency ?? null, createdAt: Number(r.created_at) });

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
export async function updateOrgCurrency(id: string, currency: string): Promise<void> {
  await q('UPDATE orgs SET currency = $1 WHERE id = $2', [currency, id]);
}

/**
 * Hard-delete an org and ALL its data (cascade): sessions (+timeline), projects (+members/files),
 * deployments, schedules, custom_commands, invites, org_profile, analytics, memberships — and any
 * USER left with no remaining org (orphan), EXCEPT the superadmin. Returns the ids needing
 * filesystem/registry cleanup so the caller finishes the job. Refuses the default workspace.
 */
export async function deleteOrg(orgId: string): Promise<{
  sessionIds: string[];
  projectIds: string[];
  deploymentSlugs: string[];
  deletedUsers: { id: string; email: string }[];
}> {
  if (orgId === DEFAULT_ORG_ID) throw new Error('The default workspace cannot be deleted.');
  const ids = async (sql: string, col: string) => (await q(sql, [orgId])).map((r: any) => r[col]);
  const sessionIds = await ids('SELECT id FROM sessions WHERE org_id = $1', 'id');
  const projectIds = await ids('SELECT id FROM projects WHERE org_id = $1', 'id');
  const deploymentSlugs = await ids('SELECT slug FROM deployments WHERE org_id = $1', 'slug');
  const memberIds = [...new Set(await ids('SELECT user_id FROM memberships WHERE org_id = $1', 'user_id'))];

  for (const sid of sessionIds) await q('DELETE FROM timeline WHERE session_id = $1', [sid]).catch(() => {});
  for (const pid of projectIds) {
    await q('DELETE FROM project_members WHERE project_id = $1', [pid]).catch(() => {});
    await q('DELETE FROM project_files WHERE project_id = $1', [pid]).catch(() => {});
  }
  for (const tbl of ['sessions', 'projects', 'deployments', 'schedules', 'custom_commands', 'invites', 'analytics_events', 'analytics_digests', 'connectors']) {
    await q(`DELETE FROM ${tbl} WHERE org_id = $1`, [orgId]).catch(() => {});
  }
  await q('DELETE FROM org_profiles WHERE org_id = $1', [orgId]).catch(() => {});
  await q('DELETE FROM memberships WHERE org_id = $1', [orgId]);

  // Orphan users: a member with no remaining org membership (and not the operator) is deleted.
  const deletedUsers: { id: string; email: string }[] = [];
  for (const uid of memberIds) {
    const still = await q('SELECT 1 FROM memberships WHERE user_id = $1 LIMIT 1', [uid]);
    const u = await getUser(uid);
    if (still.length === 0 && u && !u.isSuperadmin) {
      await q('DELETE FROM auth_sessions WHERE user_id = $1', [uid]).catch(() => {});
      await q('DELETE FROM users WHERE id = $1', [uid]);
      deletedUsers.push({ id: u.id, email: u.email });
    }
  }
  await q('DELETE FROM orgs WHERE id = $1', [orgId]);
  return { sessionIds, projectIds, deploymentSlugs, deletedUsers };
}

// ---- per-org shared profile + memory scope (strictly per-tenant) ----

/**
 * The shared-memory scope key for an org. The org id MUST come from the
 * authenticated session/identity — NEVER from client input — so one org can never
 * address another org's memory.
 */
export function orgScope(orgId: string): string {
  return `org:${orgId}`;
}

export async function getOrgProfile(orgId: string): Promise<OrgProfile> {
  const r = await qOne('SELECT profile, onboarding_complete FROM org_profiles WHERE org_id = $1', [orgId]);
  if (!r) return { onboardingComplete: false };
  let data: any = {};
  try {
    data = JSON.parse(r.profile || '{}');
  } catch {
    /* corrupt JSON → ignore */
  }
  return { ...data, onboardingComplete: !!Number(r.onboarding_complete) };
}

export async function setOrgProfile(orgId: string, patch: Partial<OrgProfile>): Promise<OrgProfile> {
  const cur = await getOrgProfile(orgId);
  const next: OrgProfile = {
    branding: patch.branding ?? cur.branding,
    about: patch.about ?? cur.about,
    websiteUrl: patch.websiteUrl ?? cur.websiteUrl,
    answers: patch.answers ?? cur.answers,
    onboardingComplete: patch.onboardingComplete ?? cur.onboardingComplete,
  };
  const { onboardingComplete, ...data } = next;
  const now = Date.now();
  const exists = await qOne('SELECT org_id FROM org_profiles WHERE org_id = $1', [orgId]);
  if (exists) {
    await q('UPDATE org_profiles SET profile = $1, onboarding_complete = $2, updated_at = $3 WHERE org_id = $4', [
      JSON.stringify(data),
      onboardingComplete ? 1 : 0,
      now,
      orgId,
    ]);
  } else {
    await q('INSERT INTO org_profiles(org_id, profile, onboarding_complete, created_at, updated_at) VALUES ($1,$2,$3,$4,$5)', [
      orgId,
      JSON.stringify(data),
      onboardingComplete ? 1 : 0,
      now,
      now,
    ]);
  }
  return next;
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
export async function updateUserName(userId: string, name: string | null): Promise<void> {
  await q('UPDATE users SET name = $1 WHERE id = $2', [name, userId]);
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
/** Remove a waitlist lead once that person has been granted access (an invite issued /
 *  accepted). Case-insensitive on email; best-effort so it never blocks the flow. */
export async function removeLeadByEmail(email: string): Promise<void> {
  const e = (email ?? '').trim();
  if (!e) return;
  await q('DELETE FROM leads WHERE LOWER(email) = LOWER($1)', [e]).catch(() => {});
}

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
  // Being invited = being given access → drop them from the waitlist so the operator's
  // review list only ever shows people not yet actioned.
  await removeLeadByEmail(opts.email);
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
  await removeLeadByEmail(r.email); // defensive: ensure they're off the waitlist on join
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
