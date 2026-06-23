import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Throwaway SQLite DB + a fixed encryption key, set BEFORE any config read / import.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-play-'));
process.env.ENCRYPTION_KEY = 'test-encryption-key-play-0987654321';
delete process.env.DATABASE_URL;

let db: typeof import('../src/db');
let play: typeof import('../src/build/playAccounts');

// A structurally valid (fake) service-account key.
const fakeSa = JSON.stringify({
  type: 'service_account',
  project_id: 'acme-play-123',
  private_key_id: 'abc',
  private_key: '-----BEGIN PRIVATE KEY-----\nMIIfake\n-----END PRIVATE KEY-----\n',
  client_email: 'publisher@acme-play-123.iam.gserviceaccount.com',
  client_id: '1',
  token_uri: 'https://oauth2.googleapis.com/token',
});

before(async () => {
  db = await import('../src/db');
  play = await import('../src/build/playAccounts');
  await db.initDb();
  const orgs = await import('../src/orgs/store');
  await orgs.bootstrapOrgs();
  await db.q(`INSERT INTO orgs(id,name,slug,created_at) VALUES($1,$2,$3,$4)`, ['po1', 'Acme', 'acme-play', Date.now()]);
});

test('parseServiceAccount accepts a valid service-account key', () => {
  const r = play.parseServiceAccount(fakeSa);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.clientEmail, 'publisher@acme-play-123.iam.gserviceaccount.com');
    assert.equal(r.projectId, 'acme-play-123');
  }
});

test('parseServiceAccount rejects non-JSON, OAuth-client, and key-less files', () => {
  assert.equal(play.parseServiceAccount('not json').ok, false);
  assert.equal(play.parseServiceAccount(JSON.stringify({ type: 'authorized_user' })).ok, false);
  assert.equal(
    play.parseServiceAccount(JSON.stringify({ type: 'service_account', client_email: 'x@y.iam' })).ok,
    false,
    'missing private_key must be rejected',
  );
});

test('connect stores the account; the service-account JSON is encrypted and never exposed', async () => {
  const acct = await play.upsertPlayAccount('po1', {
    serviceAccountJson: fakeSa,
    developerName: 'Acme Mobile Ltd',
    defaultTrack: 'internal',
  });
  assert.equal(acct.developerName, 'Acme Mobile Ltd');
  assert.equal(acct.saEmail, 'publisher@acme-play-123.iam.gserviceaccount.com');
  assert.equal(acct.hasCredentials, true);
  // The public shape must not carry the secret JSON.
  assert.equal((acct as any).saJson, undefined);
  assert.equal((acct as any).serviceAccountJson, undefined);

  // The raw stored column is ciphertext (no plaintext private key).
  const row = await db.qOne('SELECT sa_json FROM org_play_accounts WHERE org_id=$1', ['po1']);
  assert.ok(row?.sa_json && !String(row.sa_json).includes('BEGIN PRIVATE KEY'), 'stored JSON must be encrypted');

  // Server-internal decryption returns the usable credentials for the upload pipeline.
  const creds = await play.accountCredentials('po1');
  assert.equal(creds?.client_email, 'publisher@acme-play-123.iam.gserviceaccount.com');
});

test('metadata-only update keeps existing credentials intact', async () => {
  const before = await play.getPlayAccount('po1');
  assert.ok(before?.hasCredentials);
  const acct = await play.upsertPlayAccount('po1', { defaultTrack: 'production' });
  assert.equal(acct.defaultTrack, 'production');
  assert.equal(acct.hasCredentials, true, 'credentials must survive a metadata-only update');
  assert.equal(acct.saEmail, 'publisher@acme-play-123.iam.gserviceaccount.com');
});

test('connect rejects an invalid key and requires a key on first connect', async () => {
  await assert.rejects(() => play.upsertPlayAccount('po-new', { developerName: 'No Creds' }));
  await assert.rejects(() => play.upsertPlayAccount('po-new', { serviceAccountJson: '{bad}' }));
});

test('disconnect removes the account', async () => {
  await play.deletePlayAccount('po1');
  assert.equal(await play.getPlayAccount('po1'), null);
  assert.equal(await play.accountCredentials('po1'), null);
});
