import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * ModelArk key precedence: an admin-set key (Admin → Keys, encrypted in app_settings) wins over
 * ARK_API_KEY; DELETE /api/admin/providers/byteplus drops it and falls back to the env key.
 * Hermetic: temp SQLite, no network.
 */
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-arkkey-'));
process.env.APP_PASSWORD = 'test-operator';
process.env.ENCRYPTION_KEY = 'test-key-arkkey';
process.env.ARK_API_KEY = 'ark-env-key';
delete process.env.DATABASE_URL;

let app: any;
let db: typeof import('../src/db');
let rt: typeof import('../src/agent/byteplusRuntime');
let config: typeof import('../src/config').config;
let opCookie = '';

before(async () => {
  db = await import('../src/db');
  rt = await import('../src/agent/byteplusRuntime');
  config = (await import('../src/config')).config;
  const orgs = await import('../src/orgs/store');
  await db.initDb();
  await orgs.bootstrapOrgs();
  app = await (await import('../src/app')).buildApp();
  await app.ready();
  const op = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'test-operator' } });
  const raw = op.headers['set-cookie'];
  const arr: string[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
  opCookie = (arr.find((c) => c.startsWith('arksai_auth=')) || '').split(';')[0];
  assert.ok(opCookie, 'operator login set a cookie');
});

const asOp = (method: string, url: string, payload?: any) =>
  app.inject({ method, url, payload, headers: { cookie: opCookie } });

test('env key only → source "env", envKey true', () => {
  assert.equal(rt.byteplusKey(), 'ark-env-key');
  assert.equal(rt.byteplusKeySource(), 'env');
  assert.equal(rt.byteplusEnvKeyAvailable(), true);
});

test('admin-set key wins over env, is persisted encrypted, and survives a reload', async () => {
  const r = await asOp('POST', '/api/admin/providers/byteplus', { key: 'ark-admin-key' });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().source, 'admin');
  assert.equal(rt.byteplusKey(), 'ark-admin-key');
  const stored = await db.getSetting('ark_api_key');
  assert.ok(stored && !stored.includes('ark-admin-key'), 'stored encrypted');
  await rt.loadByteplusRuntime();
  assert.equal(rt.byteplusKey(), 'ark-admin-key');
  assert.equal(rt.byteplusKeySource(), 'admin');
});

test('GET providers reports the source + whether an env key exists — never a key value', async () => {
  const r = await asOp('GET', '/api/admin/providers');
  assert.equal(r.statusCode, 200);
  const b = r.json().byteplus;
  assert.equal(b.source, 'admin');
  assert.equal(b.envKey, true);
  assert.equal(b.configured, true);
  assert.doesNotMatch(r.body, /ark-admin-key|ark-env-key/);
});

test('DELETE without operator auth is refused and keeps the admin key', async () => {
  const r = await app.inject({ method: 'DELETE', url: '/api/admin/providers/byteplus' });
  assert.ok(r.statusCode === 401 || r.statusCode === 403, `got ${r.statusCode}`);
  assert.equal(rt.byteplusKeySource(), 'admin');
  assert.ok(await db.getSetting('ark_api_key'));
});

test('DELETE is refused (409) when there is no env key to fall back to', async () => {
  const prev = config.byteplusApiKey;
  config.byteplusApiKey = '';
  try {
    assert.equal(rt.byteplusEnvKeyAvailable(), false);
    const r = await asOp('DELETE', '/api/admin/providers/byteplus');
    assert.equal(r.statusCode, 409);
    assert.match(r.json().error, /no server-environment model key/i);
    assert.equal(rt.byteplusKey(), 'ark-admin-key');
    assert.ok(await db.getSetting('ark_api_key'));
  } finally {
    config.byteplusApiKey = prev;
  }
});

test('DELETE drops the stored key and falls back to ARK_API_KEY (also after a reload)', async () => {
  const r = await asOp('DELETE', '/api/admin/providers/byteplus');
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.json(), { ok: true, configured: true, source: 'env' });
  assert.equal(rt.byteplusKey(), 'ark-env-key');
  assert.equal(rt.byteplusKeySource(), 'env');
  assert.equal(await db.getSetting('ark_api_key'), null);
  await rt.loadByteplusRuntime(); // a restart must not resurrect the admin key
  assert.equal(rt.byteplusKey(), 'ark-env-key');
  const g = (await asOp('GET', '/api/admin/providers')).json().byteplus;
  assert.equal(g.source, 'env');
});

test('clearByteplusKey with no env key → unconfigured ("none")', async () => {
  const prev = config.byteplusApiKey;
  await rt.setByteplusKey('ark-admin-2');
  config.byteplusApiKey = '';
  try {
    await rt.clearByteplusKey();
    assert.equal(rt.byteplusKey(), '');
    assert.equal(rt.byteplusKeySource(), 'none');
    assert.equal(rt.byteplusConfigured(), false);
  } finally {
    config.byteplusApiKey = prev;
    await rt.clearByteplusKey();
  }
  assert.equal(rt.byteplusKeySource(), 'env');
});

// ---- a key with invalid characters must never be stored, and a key must never leak in an error ----

test('POST rejects a key with CR/LF/NUL/zero-width/space chars (400) and keeps the current key', async () => {
  const before = rt.byteplusKey();
  for (const bad of ['ark-abc\ndef', 'ark-abc\r\ndef', 'ark-abc\u0000def', 'ark-abc​def', 'ark-abc​', 'ark-abc def', 'ark-']) {
    const r = await asOp('POST', '/api/admin/providers/byteplus', { key: bad });
    assert.equal(r.statusCode, 400, JSON.stringify(bad));
    assert.match(r.json().error, /invalid characters|ark-…/);
    assert.equal(rt.byteplusKey(), before, `${JSON.stringify(bad)} must not be stored`);
  }
  assert.equal(await db.getSetting('ark_api_key'), null, 'nothing persisted');
  const zw = await asOp('POST', '/api/admin/providers/byteplus', { key: 'ark-abc​def' });
  assert.equal(zw.json().error, 'That key contains invalid characters — paste it again.');
});

test('an engine transport error that quotes the key comes back scrubbed (arkChat, generateText, embedText, draftReply)', async () => {
  const ark = await import('../src/engines/modelark');
  const reply = await import('../src/robots/reply');
  // Unregistered (test-only setter) key with a LF: real undici rejects the header and quotes it.
  const key = 'ark-leak\nsecret-tail-9f3e';
  const prev = rt.byteplusKey();
  rt.__setByteplusKeyForTest(key);
  try {
    const sig = new AbortController().signal;
    for (const r of [
      await ark.arkChat('hi', sig),
      await ark.generateText('hi', sig),
      await ark.embedText('hi', sig),
    ]) {
      assert.equal(r.ok, false);
      assert.ok(r.error, 'an error came back');
      assert.ok(!r.error!.includes('secret-tail-9f3e'), `key leaked: ${r.error}`);
      assert.match(r.error!, /\[redacted\]/);
    }
    const robot: any = {
      id: 'r', orgId: 'o', name: 'CS', role: 'customer_service', status: 'active', autonomy: 'ask',
      model: 'arksai-max', lastPolledAt: null, createdAt: 0, updatedAt: 0, config: {},
    };
    const msg: any = { uid: 1, seq: 1, from: 'a@x.test', fromName: 'A', to: 'b@x.test', subject: 's', date: '', messageId: '<m>', snippet: 'hi', text: 'hi' };
    const out = await reply.draftReply(robot, msg, sig);
    assert.equal(out.primary.escalate, true);
    assert.ok(!out.primary.reason.includes('secret-tail-9f3e'), `key leaked into the draft: ${out.primary.reason}`);
    // scrubKey (voiceChat's error path) redacts the current key even when it was never registered.
    assert.equal(ark.scrubKey(`boom "Bearer ${key}"`), 'boom "Bearer [redacted]"');
  } finally {
    rt.__setByteplusKeyForTest(prev);
  }
});
