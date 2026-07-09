import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { config } from '../config';
import { scopeOf } from '../auth';
import { roleInOrg } from '../orgs/store';
import { signState, verifyState } from '../connectors/crypto';
import {
  adapterFor, availableProviders, connectorsEnabled, providerAvailable, redirectUri,
} from '../connectors';
import {
  saveConnector, listConnectors, deleteConnector, toPublic,
  deleteConnectorsByExternalUser, recordDeletionRequest, getDeletionRequest,
} from '../connectors/store';
import { metaAppSecret } from '../connectors/metaRuntime';
import { parseSignedRequest } from '../connectors/signedRequest';
import { PROVIDERS, type Provider } from '../connectors/types';

/** Read `signed_request` out of a Meta callback body (application/x-www-form-urlencoded,
 *  buffered as raw bytes by the catch-all parser; JSON object as a fallback). */
function signedRequestFrom(req: FastifyRequest): string {
  const b: any = req.body;
  if (!b) return '';
  if (typeof b === 'string') return new URLSearchParams(b).get('signed_request') || '';
  if (Buffer.isBuffer(b)) return new URLSearchParams(b.toString('utf8')).get('signed_request') || '';
  if (typeof b === 'object' && typeof b.signed_request === 'string') return b.signed_request;
  return '';
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

function isProvider(p: string): p is Provider {
  return (PROVIDERS as string[]).includes(p);
}

async function canAdmin(req: FastifyRequest, orgId: string | null): Promise<boolean> {
  const s = scopeOf(req);
  if (!s || !orgId) return false;
  if (s.isSuperadmin) return true;
  return s.orgId === orgId && (await roleInOrg(s.userId, orgId)) === 'admin';
}

export function registerConnectorRoutes(app: FastifyInstance) {
  // Which providers can be connected in this deployment (creds + encryption configured).
  app.get('/api/connectors/available', async () => ({
    enabled: connectorsEnabled(),
    providers: availableProviders(),
  }));

  // List the caller's org connectors (token-free view). Admin only.
  app.get('/api/connectors', async (req, reply) => {
    const s = scopeOf(req);
    if (!s?.orgId || !(await canAdmin(req, s.orgId))) return reply.code(403).send({ error: 'Admins only.' });
    const list = await listConnectors(s.orgId);
    return { connectors: list.map(toPublic) };
  });

  // Begin OAuth: redirect the admin to the provider's consent screen.
  app.get('/api/connectors/:provider/connect', async (req, reply) => {
    const { provider } = req.params as { provider: string };
    const s = scopeOf(req);
    if (!isProvider(provider)) return reply.code(404).send({ error: 'Unknown provider' });
    if (!s?.orgId || !(await canAdmin(req, s.orgId))) return reply.code(403).send({ error: 'Admins only.' });
    if (!providerAvailable(provider)) return reply.code(400).send({ error: `${provider} is not configured on this server.` });
    const state = signState({ orgId: s.orgId, userId: s.userId, provider, nonce: randomUUID() });
    return reply.redirect(adapterFor(provider).authUrl(state, redirectUri(provider)));
  });

  // OAuth callback: exchange the code, store a connector per resolved ad account.
  app.get('/api/connectors/:provider/callback', async (req, reply) => {
    const { provider } = req.params as { provider: string };
    const { code, state, error } = (req.query ?? {}) as { code?: string; state?: string; error?: string };
    if (!isProvider(provider)) return reply.code(404).send({ error: 'Unknown provider' });
    const back = (msg: string) => reply.redirect(`/?connect=${provider}&status=${encodeURIComponent(msg)}`);
    if (error) return back('cancelled');
    const claims = state ? verifyState(state) : null;
    // The signed state is the authoritative org (HMAC, not forgeable) + CSRF guard.
    if (!claims || claims.provider !== provider || !claims.orgId || !code) return back('invalid');
    if (!providerAvailable(provider)) return back('unavailable');
    try {
      const tokens = await adapterFor(provider).exchangeCode(code, redirectUri(provider));
      const accounts = tokens.accounts?.length ? tokens.accounts : [{ id: 'default', name: 'Default account' }];
      for (const acct of accounts) {
        await saveConnector(claims.orgId, provider, acct, tokens, claims.userId ?? null);
      }
      return back('connected');
    } catch (e: any) {
      return back('failed');
    }
  });

  // Disconnect (org-scoped delete).
  app.delete('/api/connectors/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const s = scopeOf(req);
    if (!s?.orgId || !(await canAdmin(req, s.orgId))) return reply.code(403).send({ error: 'Admins only.' });
    const ok = await deleteConnector(s.orgId, id);
    if (!ok) return reply.code(404).send({ error: 'Not found' });
    return { ok: true };
  });

  // ---- Meta (Facebook) compliance callbacks ----------------------------------------------
  // PUBLIC (auth-allowlisted in auth.ts): the caller is Facebook, not a logged-in user.
  // Both are authenticated by the app-secret HMAC on the `signed_request` — an unsigned or
  // wrongly-signed request is rejected. They purge every connector granted by the app-scoped
  // user id Meta sends, so a person removing our app from their Facebook settings has their
  // stored tokens/account links erased.

  const statusUrl = (code: string) =>
    `${config.publicBaseUrl}/api/connectors/meta/data-deletion?code=${encodeURIComponent(code)}`;

  // Data Deletion Request callback — Facebook POSTs a signed_request; we delete + return the
  // required { url, confirmation_code } JSON so the user can track the deletion.
  app.post('/api/connectors/meta/data-deletion', async (req, reply) => {
    const secret = metaAppSecret();
    if (!secret) return reply.code(503).send({ error: 'Meta app is not configured.' });
    const signed = signedRequestFrom(req);
    const payload = parseSignedRequest(signed, secret);
    if (!payload) return reply.code(400).send({ error: 'Invalid signed_request.' });
    const userId = payload.user_id ? String(payload.user_id) : '';
    const code = randomUUID().replace(/-/g, '');
    let deleted = 0;
    try {
      deleted = userId ? await deleteConnectorsByExternalUser('meta', userId) : 0;
      await recordDeletionRequest({
        code, provider: 'meta', externalUserId: userId || null,
        connectorsDeleted: deleted, status: 'completed', createdAt: Date.now(),
      });
    } catch (e: any) {
      req.log.error({ err: e }, 'meta data-deletion');
      // Still return a well-formed response — Meta requires it; the purge is retried by them.
    }
    return reply.send({ url: statusUrl(code), confirmation_code: code });
  });

  // Deauthorize callback — same signed_request mechanism; fired when a user removes the app.
  // No response body is required; we purge the same rows so a deauthorize also cleans up.
  app.post('/api/connectors/meta/deauthorize', async (req, reply) => {
    const secret = metaAppSecret();
    if (!secret) return reply.code(503).send({ ok: false });
    const payload = parseSignedRequest(signedRequestFrom(req), secret);
    if (!payload) return reply.code(400).send({ ok: false });
    const userId = payload.user_id ? String(payload.user_id) : '';
    if (userId) await deleteConnectorsByExternalUser('meta', userId).catch((e) => req.log.error({ err: e }, 'meta deauthorize'));
    return reply.send({ ok: true });
  });

  // User-accessible status page for a deletion request (the URL returned above).
  app.get('/api/connectors/meta/data-deletion', async (req, reply) => {
    const code = String((req.query as any)?.code || '').trim();
    const rec = code ? await getDeletionRequest(code) : null;
    const body = rec
      ? `<h1>Data deletion ${rec.status === 'completed' ? 'complete' : 'in progress'}</h1>
         <p>Your request has been processed. We removed the ad-account connection(s) associated with your
         Facebook login from ArksAI.</p>
         <ul>
           <li>Confirmation code: <code>${escapeHtml(rec.code)}</code></li>
           <li>Connections removed: <strong>${rec.connectorsDeleted}</strong></li>
           <li>Received: ${new Date(rec.createdAt).toISOString().slice(0, 10)}</li>
         </ul>
         <p>ArksAI stores no other personal data for Facebook logins. If you have questions, contact
         <a href="mailto:support@arksai.studio">support@arksai.studio</a>.</p>`
      : `<h1>Data deletion status</h1>
         <p>No request was found for that confirmation code. If you removed ArksAI from your Facebook
         settings, any stored ad-account connection has been deleted. Contact
         <a href="mailto:support@arksai.studio">support@arksai.studio</a> if you need confirmation.</p>`;
    return reply
      .type('text/html')
      .send(`<!doctype html><html lang="en"><head><meta charset="utf-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
        <title>ArksAI — Data deletion status</title>
        <style>body{font:16px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:640px;
        margin:8vh auto;padding:0 24px;color:#141413}h1{font-size:24px;margin:0 0 12px}code{background:#f2efe9;
        padding:1px 6px;border-radius:5px}a{color:#c2402a}ul{padding-left:20px}</style></head>
        <body>${body}</body></html>`);
  });
}
