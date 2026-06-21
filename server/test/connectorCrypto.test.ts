import { test } from 'node:test';
import assert from 'node:assert/strict';

// Set a key BEFORE config/crypto are first imported (config reads env at import time).
// The import happens inside the tests (dynamic) so this runs first.
process.env.CONNECTOR_ENC_KEY = 'test-key-for-connectors-please-rotate';
const crypto = () => import('../src/connectors/crypto');

test('encrypt → decrypt round-trips a token', async () => {
  const { encryptSecret, decryptSecret, encryptionReady } = await crypto();
  assert.equal(encryptionReady(), true);
  const secret = 'EAAB-super-secret-oauth-token-xyz';
  const enc = encryptSecret(secret);
  assert.notEqual(enc, secret); // actually encrypted
  assert.match(enc, /\..+\./); // iv.tag.data
  assert.equal(decryptSecret(enc), secret);
});

test('two encryptions of the same value differ (random IV) but both decrypt', async () => {
  const { encryptSecret, decryptSecret } = await crypto();
  const a = encryptSecret('same');
  const b = encryptSecret('same');
  assert.notEqual(a, b);
  assert.equal(decryptSecret(a), 'same');
  assert.equal(decryptSecret(b), 'same');
});

test('signed state round-trips and rejects tampering', async () => {
  const { signState, verifyState } = await crypto();
  const s = signState({ orgId: 'org_1', userId: 'u_1', provider: 'meta', nonce: 'n' });
  const claims = verifyState(s);
  assert.equal(claims?.orgId, 'org_1');
  assert.equal(claims?.provider, 'meta');
  // tamper the payload → verification fails
  const [, sig] = s.split('.');
  const forged = Buffer.from(JSON.stringify({ orgId: 'org_2', provider: 'meta' })).toString('base64url') + '.' + sig;
  assert.equal(verifyState(forged), null);
  assert.equal(verifyState('garbage'), null);
});
