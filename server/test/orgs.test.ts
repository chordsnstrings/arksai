import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Force a throwaway SQLite DB before anything reads config (set BEFORE the dynamic imports).
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-orgs-'));
delete process.env.DATABASE_URL;

let orgs: typeof import('../src/orgs/store');

before(async () => {
  const db = await import('../src/db');
  orgs = await import('../src/orgs/store');
  await db.initDb();
  await orgs.bootstrapOrgs();
});

test('password hashing verifies the right password and rejects others', () => {
  const h = orgs.hashPassword('correct horse battery');
  assert.match(h, /^scrypt\$[0-9a-f]+\$[0-9a-f]+$/);
  assert.ok(orgs.verifyPassword('correct horse battery', h));
  assert.equal(orgs.verifyPassword('wrong', h), false);
  assert.equal(orgs.verifyPassword('x', 'not-a-hash'), false);
});

test('bootstrap creates the Default org', async () => {
  const def = await orgs.getOrg(orgs.DEFAULT_ORG_ID);
  assert.ok(def);
  assert.equal(def!.slug, 'default');
});

test('orgs, users, memberships round-trip with roles', async () => {
  const org = await orgs.createOrg('Acme Inc');
  assert.match(org.slug, /^acme-inc/);
  const admin = await orgs.createUser({ email: 'boss@acme.com', password: 'password123', name: 'Boss' });
  await orgs.addMembership(admin.id, org.id, 'admin');
  assert.equal(await orgs.roleInOrg(admin.id, org.id), 'admin');
  const members = await orgs.membersOfOrg(org.id);
  assert.equal(members.length, 1);
  assert.equal(members[0].email, 'boss@acme.com');
  assert.equal(members[0].role, 'admin');
  assert.deepEqual((await orgs.orgsForUser(admin.id)).map((o) => o.id), [org.id]);
});

test('invite link is single-use, creates the user + membership, and expires', async () => {
  const org = await orgs.createOrg('Beta LLC');
  const { token } = await orgs.createInvite({ orgId: org.id, email: 'new@beta.com', role: 'member' });
  const res = await orgs.acceptInvite(token, 'password123', 'New Hire');
  assert.ok(!('error' in res), 'first accept should succeed');
  if ('error' in res) return;
  assert.equal(res.orgId, org.id);
  assert.equal(await orgs.roleInOrg(res.user.id, org.id), 'member');
  // single-use: a second accept of the same token fails
  assert.ok('error' in (await orgs.acceptInvite(token, 'password123')));
  // an already-expired invite is rejected
  const { token: t2 } = await orgs.createInvite({ orgId: org.id, email: 'late@beta.com', role: 'member', ttlMs: -1000 });
  assert.ok('error' in (await orgs.acceptInvite(t2, 'password123')));
  // too-short password is rejected
  const { token: t3 } = await orgs.createInvite({ orgId: org.id, email: 'weak@beta.com', role: 'member' });
  assert.ok('error' in (await orgs.acceptInvite(t3, 'short')));
});

test('granting access removes the person from the waitlist (on invite + on accept)', async () => {
  const db = await import('../src/db');
  const org = await orgs.createOrg('Waitlisted Co');
  const seedLead = (email: string) => db.q(`INSERT INTO leads(id,email,company,created_at) VALUES($1,$2,$3,$4)`, [`lead-${email}`, email, 'Co', Date.now()]);
  const leadCount = async (email: string) => (await db.q(`SELECT COUNT(*) c FROM leads WHERE LOWER(email)=LOWER($1)`, [email]))[0].c;

  // Issuing an invite removes the matching lead (case-insensitive).
  await seedLead('Hire@waitlisted.co');
  assert.equal(Number(await leadCount('hire@waitlisted.co')), 1);
  await orgs.createInvite({ orgId: org.id, email: 'hire@waitlisted.co', role: 'member' });
  assert.equal(Number(await leadCount('hire@waitlisted.co')), 0, 'lead should be removed when invited');

  // And accepting an invite also clears it (defensive, e.g. a re-submitted lead).
  const { token } = await orgs.createInvite({ orgId: org.id, email: 'second@waitlisted.co', role: 'member' });
  await seedLead('second@waitlisted.co'); // re-added after the invite
  await orgs.acceptInvite(token, 'password123');
  assert.equal(Number(await leadCount('second@waitlisted.co')), 0, 'lead should be gone after accept');
});

test('auth sessions create → resolve → revoke; removing a membership kills the session', async () => {
  const org = await orgs.createOrg('Gamma');
  const u = await orgs.createUser({ email: 'g@gamma.com', password: 'password123' });
  await orgs.addMembership(u.id, org.id, 'member');
  const token = await orgs.createAuthSession(u.id, org.id);
  const r = await orgs.resolveAuthSession(token);
  assert.equal(r?.userId, u.id);
  assert.equal(r?.currentOrgId, org.id);
  await orgs.revokeAuthSession(token);
  assert.equal(await orgs.resolveAuthSession(token), null);
  // instant revoke: removing the membership kills any org-scoped session
  const token2 = await orgs.createAuthSession(u.id, org.id);
  await orgs.removeMembership(u.id, org.id);
  assert.equal(await orgs.resolveAuthSession(token2), null);
});

test('store scoping isolates orgs; only the unscoped/no-org path sees all', async () => {
  const store = await import('../src/sessions/store');
  const a = await orgs.createOrg('OrgA-scope');
  const b = await orgs.createOrg('OrgB-scope');
  const base = { repoUrl: null, repoName: null, branch: null, mode: 'code' as const, model: 'arksai-auto' as any };
  const sA = await store.createSession({ ...base, orgId: a.id, createdBy: 'uA' });
  const sB = await store.createSession({ ...base, orgId: b.id, createdBy: 'uB' });
  const scopeA = { orgId: a.id, userId: 'uA', isSuperadmin: false };

  const listA = await store.listSessions(scopeA);
  assert.ok(listA.some((s) => s.id === sA.id), 'org A sees its own session');
  assert.ok(!listA.some((s) => s.id === sB.id), 'org A does NOT see org B');
  assert.equal(await store.getSession(sB.id, scopeA), null, 'cross-org get → not found');
  assert.ok(await store.getSession(sA.id, scopeA), 'same-org get works');

  // The unscoped internal path (and a super-admin with NO current org) see everything…
  const all = await store.listSessions({ orgId: null, userId: 'superadmin', isSuperadmin: true });
  assert.ok(all.some((s) => s.id === sA.id) && all.some((s) => s.id === sB.id));
  assert.ok((await store.listSessions(undefined)).some((s) => s.id === sB.id), 'internal/unscoped sees all');
  // …but the operator is scoped to its CURRENT workspace, like everyone else: bound to
  // org A it can no longer reach org B (the cross-org operator leak, now closed).
  const opOnA = { orgId: a.id, userId: 'superadmin', isSuperadmin: true };
  assert.ok((await store.listSessions(opOnA)).some((s) => s.id === sA.id), 'operator on A sees A');
  assert.ok(!(await store.listSessions(opOnA)).some((s) => s.id === sB.id), 'operator on A must NOT see B');
  assert.equal(await store.getSession(sB.id, opOnA), null, 'operator bound to A cannot read B');
  assert.ok(await store.getSession(sA.id, opOnA), 'operator bound to A reads A');
});

test('project visibility: a private project is hidden from non-invited members', async () => {
  const store = await import('../src/sessions/store');
  const org = await orgs.createOrg('OrgVis');
  const [owner, other, invited] = ['owner-1', 'other-1', 'invited-1'];
  const sc = (u: string) => ({ orgId: org.id, userId: u, isSuperadmin: false });

  const proj = await store.createProject({ name: 'Secret Plan', orgId: org.id, ownerUserId: owner });
  await store.setProjectVisibility(proj.id, 'private');
  assert.ok(await store.getProject(proj.id, sc(owner)), 'owner sees their private project');
  assert.equal(await store.getProject(proj.id, sc(other)), null, 'non-invited member cannot see it');
  assert.ok(!(await store.listProjects(sc(other))).some((p) => p.id === proj.id), 'private project not listed for others');

  await store.addProjectMember(proj.id, invited);
  assert.ok(await store.getProject(proj.id, sc(invited)), 'invited member sees it');
  assert.ok((await store.listProjects(sc(invited))).some((p) => p.id === proj.id));
  assert.ok(await store.getProject(proj.id, { orgId: org.id, userId: 'x', isSuperadmin: true }), 'super-admin always sees it');

  // a default ('org') project is visible to any member of the org
  const pub = await store.createProject({ name: 'Team Wiki', orgId: org.id, ownerUserId: owner });
  assert.ok(await store.getProject(pub.id, sc(other)), 'org-wide project visible to all members');
});

test('deleteOrg cascades: removes the org + data + orphan users, keeps shared users + superadmin, refuses default', async () => {
  const store = await import('../src/sessions/store');
  const org = await orgs.createOrg('DeleteMe Inc');
  const other = await orgs.createOrg('Keepers LLC');
  const orphan = await orgs.createUser({ email: 'orphan@deleteme.com', password: 'password123' });
  const shared = await orgs.createUser({ email: 'shared@keep.com', password: 'password123' });
  const op = await orgs.createUser({ email: 'op@platform.com', password: 'password123', isSuperadmin: true });
  await orgs.addMembership(orphan.id, org.id, 'member');
  await orgs.addMembership(shared.id, org.id, 'member');
  await orgs.addMembership(shared.id, other.id, 'member'); // shared also belongs to another org
  await orgs.addMembership(op.id, org.id, 'admin');
  await orgs.setOrgProfile(org.id, { accent: '#123456' });
  const sess = await store.createSession({ title: 'x', mode: 'code', model: 'm', orgId: org.id } as any);

  const res = await orgs.deleteOrg(org.id);

  assert.equal(await orgs.getOrg(org.id), null, 'org row gone');
  assert.equal(await orgs.getUser(orphan.id), null, 'orphan user deleted');
  assert.ok(await orgs.getUser(shared.id), 'user shared with another org is kept');
  assert.ok(await orgs.getUser(op.id), 'superadmin is never deleted');
  assert.ok(await orgs.getOrg(other.id), 'other org untouched');
  assert.equal(await store.getSession(sess.id), null, 'org sessions cascade-deleted');
  assert.ok(res.deletedUsers.some((u) => u.email === 'orphan@deleteme.com'));
  await assert.rejects(() => orgs.deleteOrg(orgs.DEFAULT_ORG_ID), /default workspace cannot be deleted/i);
});
