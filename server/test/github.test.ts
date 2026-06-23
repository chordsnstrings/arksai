import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Configure BEFORE importing config-dependent modules (env read at import time).
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-github-'));
delete process.env.DATABASE_URL;
process.env.CONNECTOR_ENC_KEY = 'github-test-key-rotate-me';
process.env.GITHUB_OAUTH_CLIENT_ID = 'Iv1.testclientid';
process.env.GITHUB_OAUTH_CLIENT_SECRET = 'shhh-secret-value';
process.env.PUBLIC_BASE_URL = 'https://arksai.studio';

const oauth = () => import('../src/agent/../github/oauth');

test('githubConfigured true only with both creds + enc key', async () => {
  const { githubConfigured, callbackUrl } = await oauth();
  assert.equal(githubConfigured(), true);
  assert.equal(callbackUrl(), 'https://arksai.studio/api/github/callback');
});

test('buildAuthorizeUrl carries client_id, redirect, scope, state', async () => {
  const { buildAuthorizeUrl, GITHUB_SCOPES } = await oauth();
  const url = buildAuthorizeUrl('signed-state-123');
  assert.match(url, /github\.com\/login\/oauth\/authorize/);
  assert.match(url, /client_id=Iv1\.testclientid/);
  assert.match(url, /redirect_uri=https%3A%2F%2Farksai\.studio%2Fapi%2Fgithub%2Fcallback/);
  assert.match(url, /state=signed-state-123/);
  assert.ok(GITHUB_SCOPES.includes('repo'));
  assert.match(url, /scope=repo\+read%3Auser|scope=repo\+read:user/);
});

test('parseTokenResponse: success vs error payloads', async () => {
  const { parseTokenResponse } = await oauth();
  assert.deepEqual(parseTokenResponse({ access_token: 'gho_abc', scope: 'repo,read:user' }), {
    accessToken: 'gho_abc',
    scopes: 'repo,read:user',
  });
  assert.equal(parseTokenResponse({ error: 'bad_verification_code' }), null);
  assert.equal(parseTokenResponse({}), null);
});

test('parseIdentity + normalizeRepos (drops no-push repos, keeps fields)', async () => {
  const { parseIdentity, normalizeRepos } = await oauth();
  assert.deepEqual(parseIdentity({ login: 'octocat', id: 42, avatar_url: 'http://x/a.png' }), {
    login: 'octocat',
    id: '42',
    avatarUrl: 'http://x/a.png',
  });
  assert.equal(parseIdentity({}), null);
  const repos = normalizeRepos([
    { full_name: 'octocat/app', private: true, default_branch: 'main', pushed_at: '2026-01-01', clone_url: 'https://github.com/octocat/app.git', permissions: { push: true } },
    { full_name: 'octocat/readonly', permissions: { push: false } }, // dropped — can't push
    { full_name: 'octocat/site', default_branch: 'trunk', permissions: { push: true } },
  ]);
  assert.equal(repos.length, 2);
  assert.equal(repos[0].fullName, 'octocat/app');
  assert.equal(repos[0].private, true);
  assert.equal(repos[1].defaultBranch, 'trunk');
});

test('store: save → getForUser round-trips an ENCRYPTED token; isolation by user', async () => {
  const db = await import('../src/db');
  await db.initDb();
  const store = await import('../src/github/store');
  await store.saveConnection('userA', 'org1', { login: 'aaa', id: '1', avatarUrl: null }, { accessToken: 'gho_tokenA', scopes: 'repo' });
  await store.saveConnection('userB', 'org1', { login: 'bbb', id: '2', avatarUrl: null }, { accessToken: 'gho_tokenB', scopes: 'repo' });

  const a = await store.getConnectionForUser('userA');
  assert.equal(a?.accessToken, 'gho_tokenA');
  assert.equal(a?.login, 'aaa');

  // user B can't fetch user A's connection by id (cross-user → null)
  const aById = await store.getConnectionByIdForUser(a!.id, 'userB');
  assert.equal(aById, null);
  // but A can
  assert.equal((await store.getConnectionByIdForUser(a!.id, 'userA'))?.accessToken, 'gho_tokenA');

  // reconnect replaces (still one row per user)
  await store.saveConnection('userA', 'org1', { login: 'aaa', id: '1', avatarUrl: null }, { accessToken: 'gho_tokenA2', scopes: 'repo' });
  assert.equal((await store.getConnectionForUser('userA'))?.accessToken, 'gho_tokenA2');

  // the token is stored ciphered, not in plaintext
  const raw = await db.q<{ access_token_enc: string }>('SELECT access_token_enc FROM github_connections WHERE user_id = $1', ['userA']);
  assert.ok(!raw[0].access_token_enc.includes('gho_tokenA2'));

  assert.equal(await store.deleteConnectionForUser('userA'), true);
  assert.equal(await store.getConnectionForUser('userA'), null);
});

test('execBash redact scrubs a per-call token from output', async () => {
  const { execBash } = await import('../src/lib/exec');
  const res = await execBash('echo "url=https://x-access-token:gho_SECRET123456@github.com/o/r"', {
    cwd: process.cwd(),
    redact: ['gho_SECRET123456'],
  });
  assert.ok(!res.output.includes('gho_SECRET123456'));
  assert.match(res.output, /\[redacted\]/);
});
