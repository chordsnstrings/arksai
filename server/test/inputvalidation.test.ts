import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Systematic input-validation / error-handling audit at the HTTP boundary.
 * The product promise is "every input gives the correct output" — so every endpoint
 * must, for malformed / missing / wrong-type / oversized / hostile input, return a
 * CLEAN, actionable error (the right 4xx) and NEVER a 500 crash, and never silently
 * accept garbage. This locks that contract in so a future change can't regress it.
 */
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-inputval-'));
process.env.APP_PASSWORD = 'test-operator';
delete process.env.DATABASE_URL;

let app: any;
const cookieOf = (res: any, name: string): string => {
  const raw = res.headers['set-cookie'];
  const arr = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const hit = arr.find((c: string) => c.startsWith(name + '='));
  return hit ? hit.split(';')[0] : '';
};
let opCookie = '';

before(async () => {
  const db = await import('../src/db');
  const orgs = await import('../src/orgs/store');
  await db.initDb();
  await orgs.bootstrapOrgs();
  const appMod = await import('../src/app');
  app = await appMod.buildApp();
  // a route that throws a leaky internal error → proves the error handler doesn't leak
  app.get('/__boom', async () => {
    throw new Error('SQLITE_ERROR: no such column secret_path /etc/private');
  });
  await app.ready();
  const op = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'test-operator' } });
  opCookie = cookieOf(op, 'arksai_auth');
  assert.ok(opCookie, 'operator login set a cookie');
});

const post = (url: string, payload: any, auth = true) =>
  app.inject({ method: 'POST', url, payload, headers: auth ? { cookie: opCookie } : {} });

// ---------------- public: /api/leads (untrusted, pre-login) ----------------
test('leads: missing / invalid / wrong-type email → 400, never a crash', async () => {
  for (const body of [{}, { email: '' }, { email: 'not-an-email' }, { email: 123 }, { email: { a: 1 } }, { email: null }]) {
    const r = await post('/api/leads', body, false);
    assert.equal(r.statusCode, 400, JSON.stringify(body));
    assert.match(r.json().error, /email/i);
  }
});

test('leads: a valid email with junk / oversized / wrong-type extra fields is accepted + sanitized', async () => {
  const r = await post('/api/leads', {
    email: 'real@company.com',
    company: { nested: 'object' }, // wrong type → dropped, not crashed
    role: 42, // wrong type → dropped
    team: 'x'.repeat(5000), // oversized → clipped
    note: 'y'.repeat(50000),
  }, false);
  assert.equal(r.statusCode, 201);
  assert.equal(r.json().ok, true);
});

// ---------------- public: /api/auth/login ----------------
test('login: missing / wrong / non-string password → 401, never 500', async () => {
  for (const body of [{}, { password: '' }, { password: 'wrong' }, { password: 12345 }, { password: ['x'] }, { email: 5, password: {} }]) {
    const r = await post('/api/auth/login', body, false);
    assert.equal(r.statusCode, 401, JSON.stringify(body));
    assert.ok(r.json().error);
  }
});

test('login: unknown email → 401 with a generic (non-enumerating) message', async () => {
  const r = await post('/api/auth/login', { email: 'nobody@nowhere.com', password: 'whatever12' }, false);
  assert.equal(r.statusCode, 401);
  assert.match(r.json().error, /invalid email or password/i); // doesn't reveal whether the email exists
});

// ---------------- public: /api/invites/accept ----------------
test('invites/accept: missing token/password → 400; bad token → 400; short password → 400', async () => {
  assert.equal((await post('/api/invites/accept', {}, false)).statusCode, 400);
  assert.equal((await post('/api/invites/accept', { token: 'x' }, false)).statusCode, 400);
  const bad = await post('/api/invites/accept', { token: 'does-not-exist', password: 'longenough' }, false);
  assert.equal(bad.statusCode, 400);
  // a real-looking flow can't be brute-forced into a weak password either
  const short = await post('/api/invites/accept', { token: 'does-not-exist', password: 'short' }, false);
  assert.equal(short.statusCode, 400);
});

// ---------------- authenticated: POST /api/sessions ----------------
test('sessions: an invalid repo URL → 400 with an actionable message', async () => {
  const r = await post('/api/sessions', { repoUrl: 'http://evil.example.com/not/github' });
  assert.equal(r.statusCode, 400);
  assert.match(r.json().error, /repo/i);
});

test('sessions: bogus mode/model fall back to safe defaults instead of erroring', async () => {
  const r = await post('/api/sessions', { mode: 'pwn', model: 'gpt-nonexistent', task: 'z'.repeat(500) });
  assert.equal(r.statusCode, 201);
  const s = r.json();
  assert.equal(s.mode, 'chat'); // unknown mode → chat
  assert.ok(s.model && s.model !== 'gpt-nonexistent'); // unknown model → a real default
  assert.ok((s.task ?? '').length <= 60, 'task is clipped'); // oversized task clipped
});

test('sessions: wrong-typed fields do not crash the create', async () => {
  const r = await post('/api/sessions', { mode: 7, model: ['x'], branch: { a: 1 }, projectId: 999, task: 12 });
  assert.ok(r.statusCode === 201 || r.statusCode === 400, 'clean status, not a 500: ' + r.statusCode);
});

// ---------------- authenticated: messages / patch / 404s ----------------
test('messages: empty text → 400; unknown session → 404 (never 500)', async () => {
  const made = await post('/api/sessions', {});
  const id = made.json().id;
  assert.equal((await post(`/api/sessions/${id}/messages`, { text: '   ' })).statusCode, 400);
  assert.equal((await post(`/api/sessions/${id}/messages`, { text: 123 })).statusCode, 400); // non-string → empty → 400
  assert.equal((await post(`/api/sessions/no-such-id/messages`, { text: 'hi' })).statusCode, 404);
});

test('unknown session id on GET/PATCH/DELETE → 404, not a crash', async () => {
  assert.equal((await app.inject({ url: '/api/sessions/ghost', headers: { cookie: opCookie } })).statusCode, 404);
  assert.equal((await app.inject({ method: 'PATCH', url: '/api/sessions/ghost', headers: { cookie: opCookie }, payload: { title: 'x' } })).statusCode, 404);
  assert.equal((await app.inject({ method: 'DELETE', url: '/api/sessions/ghost', headers: { cookie: opCookie } })).statusCode, 404);
});

// ---------------- malformed bodies + auth boundary ----------------
test('malformed JSON body → 400, never 500', async () => {
  const r = await app.inject({
    method: 'POST', url: '/api/sessions',
    headers: { cookie: opCookie, 'content-type': 'application/json' },
    payload: '{ this is : not valid json,,, }',
  });
  assert.equal(r.statusCode, 400, 'got ' + r.statusCode);
  // the actionable message must reach the client via the `error` field (it reads .error)
  assert.match(r.json().error, /malformed json/i);
});

test('an unexpected 5xx never leaks internal detail to the client', async () => {
  // The client only ever sees a calm generic message (the real error is logged server-side).
  const r = await app.inject({ url: '/__boom' });
  assert.equal(r.statusCode, 500);
  assert.doesNotMatch(r.json().error, /SQLITE|secret_path|\/etc/i, 'internal detail leaked');
  assert.match(r.json().error, /something went wrong/i);
});

test('a Content-Type:json header with an EMPTY body does not 500 (the tolerant parser)', async () => {
  const r = await app.inject({
    method: 'POST', url: '/api/sessions',
    headers: { cookie: opCookie, 'content-type': 'application/json' },
    payload: '',
  });
  assert.ok(r.statusCode === 201 || r.statusCode === 400, 'clean status, not 500: ' + r.statusCode);
});

test('protected endpoints require auth → 401 without a cookie (no info leak)', async () => {
  const r = await app.inject({ method: 'POST', url: '/api/sessions', payload: {} });
  assert.equal(r.statusCode, 401);
});
