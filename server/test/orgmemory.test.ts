import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Throwaway SQLite DB, set BEFORE any config read / dynamic import.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-orgmem-'));
delete process.env.DATABASE_URL;

let orgs: typeof import('../src/orgs/store');
let store: typeof import('../src/sessions/store');

before(async () => {
  const db = await import('../src/db');
  orgs = await import('../src/orgs/store');
  store = await import('../src/sessions/store');
  await db.initDb();
  await orgs.bootstrapOrgs();
});

test('orgScope: namespaced, derived from the org id', () => {
  assert.equal(orgs.orgScope('abc'), 'org:abc');
  assert.notEqual(orgs.orgScope('a'), orgs.orgScope('b'));
});

test('org profile: default is not-onboarded; set + partial-merge round-trips', async () => {
  const org = await orgs.createOrg('Profile Co');
  assert.deepEqual(await orgs.getOrgProfile(org.id), { onboardingComplete: false });

  await orgs.setOrgProfile(org.id, { about: 'We make widgets.', branding: { accent: '#0a7d55' } });
  let p = await orgs.getOrgProfile(org.id);
  assert.equal(p.about, 'We make widgets.');
  assert.equal(p.branding?.accent, '#0a7d55');
  assert.equal(p.onboardingComplete, false);

  // partial patch keeps existing fields, flips the flag
  await orgs.setOrgProfile(org.id, { onboardingComplete: true, websiteUrl: 'https://widgets.example' });
  p = await orgs.getOrgProfile(org.id);
  assert.equal(p.onboardingComplete, true);
  assert.equal(p.about, 'We make widgets.'); // preserved
  assert.equal(p.branding?.accent, '#0a7d55'); // preserved
  assert.equal(p.websiteUrl, 'https://widgets.example');
});

test('org memory is strictly isolated between orgs (no cross-org bleed)', async () => {
  const a = await orgs.createOrg('Org A');
  const b = await orgs.createOrg('Org B');
  await store.addMemory(orgs.orgScope(a.id), 'A: launch is in March');
  await store.addMemory(orgs.orgScope(b.id), 'B: budget is 2M');
  await store.addMemory('global', 'operator-only note');

  const aMem = await store.listMemory([orgs.orgScope(a.id)]);
  const bMem = await store.listMemory([orgs.orgScope(b.id)]);

  assert.ok(aMem.some((e) => e.text.includes('launch is in March')));
  assert.ok(!aMem.some((e) => e.text.includes('budget is 2M')), 'org A must NOT see org B memory');
  assert.ok(!aMem.some((e) => e.text.includes('operator-only')), 'org A must NOT see global memory');

  assert.ok(bMem.some((e) => e.text.includes('budget is 2M')));
  assert.ok(!bMem.some((e) => e.text.includes('launch is in March')), 'org B must NOT see org A memory');

  // global stays operator-only — it must not pull in any org memory
  const glob = await store.listMemory(['global']);
  assert.ok(glob.some((e) => e.text.includes('operator-only')));
  assert.ok(!glob.some((e) => e.text.includes('launch is in March') || e.text.includes('budget is 2M')));
});
