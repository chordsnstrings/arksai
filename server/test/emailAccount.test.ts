import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Throwaway SQLite DB + a fixed encryption key, set BEFORE any config read / import.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-email-'));
process.env.ENCRYPTION_KEY = 'test-encryption-key-1234567890';
delete process.env.DATABASE_URL;

let db: typeof import('../src/db');
let crypto: typeof import('../src/lib/crypto');
let accounts: typeof import('../src/email/accounts');

before(async () => {
  db = await import('../src/db');
  crypto = await import('../src/lib/crypto');
  accounts = await import('../src/email/accounts');
  await db.initDb();
  const orgs = await import('../src/orgs/store');
  await orgs.bootstrapOrgs();
  await db.q(`INSERT INTO orgs(id,name,slug,created_at) VALUES($1,$2,$3,$4)`, ['o1', 'Acme', 'acme', Date.now()]);
});

test('encryptSecret/decryptSecret round-trips and is opaque', () => {
  const secret = 'super-secret-mailbox-pw!';
  const enc = crypto.encryptSecret(secret);
  assert.ok(crypto.isEncrypted(enc), 'should be flagged encrypted');
  assert.ok(!enc.includes(secret), 'ciphertext must not contain the plaintext');
  assert.equal(crypto.decryptSecret(enc), secret);
});

test('decryptSecret rejects a tampered ciphertext (GCM auth)', () => {
  const enc = crypto.encryptSecret('abc');
  const tampered = enc.slice(0, -2) + (enc.endsWith('00') ? '11' : '00');
  assert.throws(() => crypto.decryptSecret(tampered));
});

test('upsert stores an account; passwords are encrypted and never exposed', async () => {
  const acct = await accounts.upsertEmailAccount('o1', {
    fromName: 'Acme Support',
    fromEmail: 'support@acme.com',
    smtpHost: 'smtp.acme.com',
    smtpPort: 587,
    smtpUser: 'support@acme.com',
    smtpPass: 'smtp-pw',
    imapHost: 'imap.acme.com',
    imapUser: 'support@acme.com',
    imapPass: 'imap-pw',
    autoReply: true,
  });
  // Public shape carries flags, not secrets.
  assert.equal(acct.fromEmail, 'support@acme.com');
  assert.equal(acct.hasSmtpPass, true);
  assert.equal(acct.hasImapPass, true);
  assert.equal((acct as any).smtpPass, undefined);

  // Raw column is ciphertext, not the plaintext.
  const raw = await db.qOne<{ smtp_pass: string }>('SELECT smtp_pass FROM org_email_accounts WHERE org_id = $1', ['o1']);
  assert.ok(crypto.isEncrypted(raw!.smtp_pass));

  // Server-internal decryption recovers the originals.
  const secrets = await accounts.accountSecrets('o1');
  assert.equal(secrets.smtpPass, 'smtp-pw');
  assert.equal(secrets.imapPass, 'imap-pw');
});

test('a blank password on re-save keeps the existing stored password', async () => {
  await accounts.upsertEmailAccount('o1', {
    fromEmail: 'support@acme.com',
    smtpHost: 'smtp.acme.com',
    smtpUser: 'support@acme.com',
    smtpPass: '', // blank → keep
    imapHost: 'imap.acme.com',
    imapPass: '', // blank → keep
    autoReply: true,
  });
  const secrets = await accounts.accountSecrets('o1');
  assert.equal(secrets.smtpPass, 'smtp-pw', 'smtp password preserved');
  assert.equal(secrets.imapPass, 'imap-pw', 'imap password preserved');
});

test('listAutoReplyAccounts returns only enabled+auto_reply+imap orgs', async () => {
  const list = await accounts.listAutoReplyAccounts();
  assert.equal(list.length, 1);
  assert.equal(list[0].orgId, 'o1');

  // Turning auto-reply off removes it from the list.
  await accounts.upsertEmailAccount('o1', {
    fromEmail: 'support@acme.com',
    smtpHost: 'smtp.acme.com',
    imapHost: 'imap.acme.com',
    autoReply: false,
  });
  assert.equal((await accounts.listAutoReplyAccounts()).length, 0);
});

test('deleteEmailAccount removes the row', async () => {
  await accounts.deleteEmailAccount('o1');
  assert.equal(await accounts.getEmailAccount('o1'), null);
});

test('per-robot mailbox: each robot has its own encrypted account, scoped + isolated', async () => {
  // Two robots in the same org connect different mailboxes.
  const a = await accounts.upsertRobotEmailAccount('robot-a', 'o1', {
    fromEmail: 'a@acme.com', smtpHost: 'smtp.acme.com', smtpUser: 'a@acme.com', smtpPass: 'pw-a',
    imapHost: 'imap.acme.com', imapPass: 'imap-a', autoReply: true,
  });
  await accounts.upsertRobotEmailAccount('robot-b', 'o1', {
    fromEmail: 'b@acme.com', smtpHost: 'smtp.acme.com', smtpPass: 'pw-b',
  });
  assert.equal(a.robotId, 'robot-a');
  assert.equal(a.fromEmail, 'a@acme.com');

  // Secrets are per-robot and recover correctly (and don't bleed across robots).
  assert.equal((await accounts.robotAccountSecrets('robot-a')).smtpPass, 'pw-a');
  assert.equal((await accounts.robotAccountSecrets('robot-b')).smtpPass, 'pw-b');

  // Stored encrypted, not plaintext.
  const raw = await db.qOne<{ smtp_pass: string }>('SELECT smtp_pass FROM robot_email_accounts WHERE robot_id = $1', ['robot-a']);
  assert.ok(crypto.isEncrypted(raw!.smtp_pass));

  // Blank password on re-save keeps the existing one.
  await accounts.upsertRobotEmailAccount('robot-a', 'o1', { fromEmail: 'a@acme.com', smtpHost: 'smtp.acme.com', smtpPass: '' });
  assert.equal((await accounts.robotAccountSecrets('robot-a')).smtpPass, 'pw-a');

  await accounts.deleteRobotEmailAccount('robot-a');
  assert.equal(await accounts.getRobotEmailAccount('robot-a'), null);
  assert.ok(await accounts.getRobotEmailAccount('robot-b')); // unaffected
});
