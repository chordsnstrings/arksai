import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { scopeOf } from '../auth';
import { signState, verifyState } from '../connectors/crypto';
import {
  buildAuthorizeUrl, callbackUrl, createRepo, exchangeCode, getIdentity, githubConfigured, listRepos,
} from '../github/oauth';
import {
  deleteConnectionForUser, getConnectionForUser, saveConnection, toPublic,
} from '../github/store';

/**
 * GitHub OAuth routes — per-user account connection + repo selection. Every route resolves the
 * connection by the AUTHENTICATED userId, so a user can only ever read/use their own token.
 * The token is never returned by any endpoint.
 */
export function registerGithubRoutes(app: FastifyInstance) {
  // Operator configures the OAuth app (client id + secret) WITHOUT editing .env — stored in
  // app_settings (secret encrypted). Flips the feature on for everyone immediately.
  app.post('/api/admin/github/configure', async (req, reply) => {
    if (!req.identity?.isSuperadmin) return reply.code(403).send({ error: 'Super-admin only.' });
    const b = (req.body ?? {}) as { clientId?: string; clientSecret?: string };
    const clientId = String(b.clientId ?? '').trim();
    const clientSecret = String(b.clientSecret ?? '').trim();
    if (!clientId || !clientSecret) return reply.code(400).send({ error: 'clientId and clientSecret are required.' });
    const { setGithubCreds } = await import('../github/runtime');
    await setGithubCreds(clientId, clientSecret);
    return { ok: true, enabled: githubConfigured(), callbackUrl: callbackUrl() };
  });

  // Is the feature configured, and is the caller connected? (token-free)
  app.get('/api/github/status', async (req) => {
    const s = scopeOf(req);
    const enabled = githubConfigured();
    if (!enabled || !s) return { enabled, connected: false };
    const c = await getConnectionForUser(s.userId);
    return { enabled, connected: !!c && c.status === 'active', login: c?.login ?? null, avatarUrl: c?.avatarUrl ?? null, connectionId: c?.id ?? null };
  });

  // Begin OAuth: redirect the user to GitHub's consent screen.
  app.get('/api/github/connect', async (req, reply) => {
    const s = scopeOf(req);
    if (!s) return reply.code(401).send({ error: 'Sign in first.' });
    if (!githubConfigured()) return reply.code(400).send({ error: 'GitHub is not configured on this server.' });
    const state = signState({ kind: 'github', userId: s.userId, orgId: s.orgId ?? '', nonce: randomUUID() });
    return reply.redirect(buildAuthorizeUrl(state));
  });

  // OAuth callback: exchange the code, store the encrypted token for THIS user.
  app.get('/api/github/callback', async (req, reply) => {
    const { code, state, error } = (req.query ?? {}) as { code?: string; state?: string; error?: string };
    const back = (msg: string) => reply.redirect(`/?github=${encodeURIComponent(msg)}`);
    if (error) return back('cancelled');
    const claims = state ? verifyState(state) : null;
    const s = scopeOf(req);
    // The signed state is the CSRF guard; the live session must match the user who started it.
    if (!claims || claims.kind !== 'github' || !claims.userId || !code) return back('invalid');
    if (!s || s.userId !== claims.userId) return back('invalid');
    if (!githubConfigured()) return back('unavailable');
    try {
      const token = await exchangeCode(code);
      const identity = await getIdentity(token.accessToken);
      await saveConnection(s.userId, s.orgId ?? null, identity, token);
      return back('connected');
    } catch {
      return back('failed');
    }
  });

  // List repos the caller can push to (their token), optionally name-filtered.
  app.get('/api/github/repos', async (req, reply) => {
    const s = scopeOf(req);
    if (!s) return reply.code(401).send({ error: 'Sign in first.' });
    const c = await getConnectionForUser(s.userId);
    if (!c) return reply.code(400).send({ error: 'Connect your GitHub account first.' });
    const query = String((req.query as any)?.query ?? '');
    try {
      return { repos: await listRepos(c.accessToken, query, (req as any).raw?.signal) };
    } catch (e: any) {
      return reply.code(502).send({ error: String(e?.message ?? e) });
    }
  });

  // Create a new repo under the caller (or one of their orgs).
  app.post('/api/github/repos', async (req, reply) => {
    const s = scopeOf(req);
    if (!s) return reply.code(401).send({ error: 'Sign in first.' });
    const c = await getConnectionForUser(s.userId);
    if (!c) return reply.code(400).send({ error: 'Connect your GitHub account first.' });
    const b = (req.body ?? {}) as { name?: string; private?: boolean; org?: string };
    const name = String(b.name ?? '').trim();
    if (!/^[\w.-]{1,100}$/.test(name)) return reply.code(400).send({ error: 'Enter a valid repo name (letters, numbers, - _ .).' });
    try {
      const repo = await createRepo(c.accessToken, { name, private: b.private, org: b.org });
      return { repo };
    } catch (e: any) {
      return reply.code(502).send({ error: String(e?.message ?? e) });
    }
  });

  // Disconnect (delete the caller's connection).
  app.delete('/api/github/connection', async (req, reply) => {
    const s = scopeOf(req);
    if (!s) return reply.code(401).send({ error: 'Sign in first.' });
    const ok = await deleteConnectionForUser(s.userId);
    return { ok };
  });
}

export { toPublic };
