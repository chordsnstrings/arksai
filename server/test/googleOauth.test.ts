import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAuthUrl, GOOGLE_SCOPES } from '../src/googleOauth';

test('buildAuthUrl: valid Google consent URL with the expected params', () => {
  const url = buildAuthUrl({
    clientId: 'cid.apps.googleusercontent.com',
    redirectUri: 'https://arksai.studio/api/auth/google/callback',
    scope: GOOGLE_SCOPES.login,
    state: 'abc123',
  });
  const u = new URL(url);
  assert.equal(u.origin + u.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(u.searchParams.get('client_id'), 'cid.apps.googleusercontent.com');
  assert.equal(u.searchParams.get('redirect_uri'), 'https://arksai.studio/api/auth/google/callback');
  assert.equal(u.searchParams.get('response_type'), 'code');
  assert.equal(u.searchParams.get('scope'), 'openid email profile');
  assert.equal(u.searchParams.get('state'), 'abc123');
  assert.equal(u.searchParams.get('access_type'), 'online'); // login default
});

test('buildAuthUrl: offline + consent for the data connectors (needs a refresh token)', () => {
  const url = buildAuthUrl({
    clientId: 'cid',
    redirectUri: 'https://arksai.studio/api/connectors/google-mail/callback',
    scope: GOOGLE_SCOPES.gmail,
    state: 's',
    accessType: 'offline',
    prompt: 'consent',
  });
  const u = new URL(url);
  assert.equal(u.searchParams.get('access_type'), 'offline');
  assert.equal(u.searchParams.get('prompt'), 'consent');
  assert.match(u.searchParams.get('scope') || '', /gmail\.send/);
});
