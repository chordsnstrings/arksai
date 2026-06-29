import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { config } from '../config';
import { scopeOf } from '../auth';
import { exchangeCode, fetchUserInfo } from '../googleOauth';
import { googleConfigured, googleConnectCallbackUrl, googleConnectUrl } from '../googleConnect';
import { deleteConnectionForUser, getConnectionForUser, saveConnection, toPublic } from '../googleConnect/store';

/**
 * Google Workspace connector routes — per-user account connection for Gmail / Calendar / Drive·Sheets.
 * Every route resolves the connection by the AUTHENTICATED userId, so a user can only ever read/use
 * their own tokens; the tokens are never returned by any endpoint. CSRF via a signed state cookie.
 */
export function registerGoogleConnectRoutes(app: FastifyInstance) {
  // Is the feature configured, and is the caller connected? (token-free)
  app.get('/api/google/status', async (req) => {
    const s = scopeOf(req);
    const enabled = googleConfigured();
    if (!enabled || !s) return { enabled, ...toPublic(null) };
    return { enabled, ...toPublic(await getConnectionForUser(s.userId)) };
  });

  // Begin OAuth: redirect the user to Google's consent screen (offline → refresh token).
  app.get('/api/google/connect', async (req, reply) => {
    const s = scopeOf(req);
    if (!s) return reply.code(401).send({ error: 'Sign in first.' });
    if (!googleConfigured()) return reply.code(400).send({ error: 'Google is not configured on this server.' });
    const state = randomBytes(16).toString('hex');
    reply.setCookie('g_conn_state', state, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      signed: true,
      secure: config.cookieSecure,
      maxAge: 600,
    });
    return reply.redirect(googleConnectUrl(state));
  });

  // OAuth callback: verify the state cookie, exchange the code, store the encrypted tokens for THIS user.
  app.get('/api/google/callback', async (req, reply) => {
    const q = (req.query ?? {}) as { code?: string; state?: string; error?: string };
    const back = (msg: string) => reply.redirect(`/?google=${encodeURIComponent(msg)}`);
    if (q.error) return back('cancelled');
    const raw = req.cookies?.['g_conn_state'];
    const u = raw ? req.unsignCookie(raw) : { valid: false, value: null };
    reply.clearCookie('g_conn_state', { path: '/' });
    const s = scopeOf(req);
    if (!s) return back('signin'); // session expired during the round-trip
    if (!q.code || !q.state || !u.valid || u.value !== q.state) return back('invalid'); // CSRF / stale
    if (!googleConfigured()) return back('unavailable');
    try {
      const tokens = await exchangeCode(q.code, googleConnectCallbackUrl());
      let email: string | null = null;
      try {
        email = (await fetchUserInfo(tokens.accessToken)).email || null;
      } catch {
        /* email is best-effort — the connection still works without it */
      }
      await saveConnection(s.userId, s.orgId ?? null, email, {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken ?? null,
        scopes: tokens.scope ?? null,
        expiresAt: tokens.expiresAt ?? null,
      });
      return back('connected');
    } catch {
      return back('failed');
    }
  });

  // Disconnect (delete the caller's connection).
  app.delete('/api/google/connection', async (req, reply) => {
    const s = scopeOf(req);
    if (!s) return reply.code(401).send({ error: 'Sign in first.' });
    return { ok: await deleteConnectionForUser(s.userId) };
  });
}
