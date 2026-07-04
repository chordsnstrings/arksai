import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Design studio API — the directions catalog served read-only to the client picker,
// gated behind the normal auth (no anonymous reads of the design library).
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-design-'));
process.env.ENCRYPTION_KEY = 'test-key-design';
process.env.APP_PASSWORD = 'test-operator';
delete process.env.DATABASE_URL;

let app: any;
async function opCookie(): Promise<string> {
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'test-operator' } });
  return String(r.headers['set-cookie']).split(';')[0];
}

before(async () => {
  const db = await import('../src/db');
  await db.initDb();
  const orgs = await import('../src/orgs/store');
  await orgs.bootstrapOrgs();
  const appMod = await import('../src/app');
  app = await appMod.buildApp();
});

test('design directions: auth-gated (anonymous is rejected)', async () => {
  const r = await app.inject({ url: '/api/design/directions' });
  assert.equal(r.statusCode, 401);
});

test('design directions: serves the full library as picker summaries', async () => {
  const r = await app.inject({ url: '/api/design/directions', headers: { cookie: await opCookie() } });
  assert.equal(r.statusCode, 200);
  const { directions } = r.json();
  assert.ok(Array.isArray(directions) && directions.length >= 30, `expected the 40-recipe library, got ${directions?.length}`);
  for (const d of directions) {
    assert.match(d.id, /^[a-z0-9-]+$/);
    assert.ok(['modern', 'glass', 'structural', 'aesthetic'].includes(d.group), d.group);
    assert.match(d.accent, /^#[0-9a-fA-F]{6}$/, `accent for ${d.id}`);
    assert.equal(typeof d.dark, 'boolean');
    for (const k of ['name', 'mood', 'display', 'body', 'signature']) {
      assert.ok(typeof d[k] === 'string' && d[k].length > 0, `${d.id}.${k}`);
    }
  }
  const ids = new Set(directions.map((d: any) => d.id));
  assert.equal(ids.size, directions.length, 'direction ids are unique');
});

test('design studio sessions: a design.* task key is accepted and round-trips', async () => {
  const cookie = await opCookie();
  const r = await app.inject({
    method: 'POST',
    url: '/api/sessions',
    headers: { cookie },
    payload: { mode: 'chat', task: 'design.landing' },
  });
  assert.equal(r.statusCode, 201);
  const meta = r.json();
  assert.equal(meta.task, 'design.landing');
  // and an unknown design.* task must not break expertise resolution (returns null, no throw)
  const { expertiseFor } = await import('../src/agent/expertise');
  assert.equal(expertiseFor('design.landing'), null);
});

test('motion styles: catalog served with real preview frames, auth-gated', async () => {
  const anon = await app.inject({ url: '/api/motion/styles' });
  assert.equal(anon.statusCode, 401);
  const cookie = await opCookie();
  const r = await app.inject({ url: '/api/motion/styles', headers: { cookie } });
  assert.equal(r.statusCode, 200);
  const { styles } = r.json();
  assert.equal(styles.length, 4);
  assert.deepEqual(styles.map((s: any) => s.id).sort(), ['broadcast', 'clean', 'nutshell', 'vox']);
  for (const s of styles) {
    for (const k of ['name', 'vibe', 'bestFor', 'accent', 'previewUrl']) assert.ok(s[k], `${s.id}.${k}`);
    const img = await app.inject({ url: s.previewUrl, headers: { cookie } });
    assert.equal(img.statusCode, 200, `${s.id} preview exists`);
    assert.match(String(img.headers['content-type']), /image\/jpeg/);
    assert.ok(img.rawPayload.length > 5_000, `${s.id} preview is a real frame`);
  }
  // unknown id → 404, traversal-safe
  const bad = await app.inject({ url: '/api/motion/styles/..%2F..%2Fmotion/preview.jpg', headers: { cookie } });
  assert.notEqual(bad.statusCode, 200);
});
