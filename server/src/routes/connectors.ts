import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { scopeOf } from '../auth';
import { roleInOrg } from '../orgs/store';
import { signState, verifyState } from '../connectors/crypto';
import {
  adapterFor, availableProviders, connectorsEnabled, providerAvailable, redirectUri,
} from '../connectors';
import { saveConnector, listConnectors, deleteConnector, toPublic } from '../connectors/store';
import { PROVIDERS, type Provider } from '../connectors/types';

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
}
