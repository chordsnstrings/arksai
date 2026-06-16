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
