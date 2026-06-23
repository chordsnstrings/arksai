import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { roleInOrg } from '../orgs/store';
import {
  PLAY_TRACKS,
  type PlayTrack,
  deletePlayAccount,
  getPlayAccount,
  parseServiceAccount,
  upsertPlayAccount,
} from '../build/playAccounts';

/**
 * Per-org Google Play Developer connection API. MULTI-TENANT: each company connects its
 * OWN Play account (service-account JSON), encrypted at rest. Connecting a developer
 * identity is a privileged action, so these routes require org ADMIN (or the operator) —
 * a plain member can build/sideload APKs but not bind the company's Play account.
 *
 * The service-account JSON is write-only: GET never returns it, only `hasCredentials` +
 * non-secret metadata (developer name, the service-account email, the default track).
 */

const orgId = (req: FastifyRequest) => (req.params as { id: string }).id;

async function isOrgAdmin(req: FastifyRequest, oid: string): Promise<boolean> {
  const id = req.identity;
  if (!id) return false;
  if (id.isSuperadmin) return true;
  return (await roleInOrg(id.userId, oid)) === 'admin';
}

export function registerPlayRoutes(app: FastifyInstance) {
  const guard = async (req: FastifyRequest, reply: FastifyReply): Promise<boolean> => {
    const ok = await isOrgAdmin(req, orgId(req));
    if (!ok) reply.code(403).send({ error: 'Only an organization admin can connect a Google Play account.' });
    return ok;
  };

  // Connection status (public, non-secret).
  app.get('/api/orgs/:id/play', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    return { account: await getPlayAccount(orgId(req)) };
  });

  // Connect / update. Body: { serviceAccountJson?, developerName?, developerId?, packagePrefix?, defaultTrack? }
  app.post('/api/orgs/:id/play', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    const b = (req.body || {}) as Record<string, any>;
    const track: PlayTrack | undefined =
      b.defaultTrack && PLAY_TRACKS.includes(b.defaultTrack) ? b.defaultTrack : undefined;
    try {
      const account = await upsertPlayAccount(orgId(req), {
        serviceAccountJson: typeof b.serviceAccountJson === 'string' ? b.serviceAccountJson : undefined,
        developerName: typeof b.developerName === 'string' ? b.developerName : undefined,
        developerId: typeof b.developerId === 'string' ? b.developerId : undefined,
        packagePrefix: typeof b.packagePrefix === 'string' ? b.packagePrefix : undefined,
        defaultTrack: track,
      });
      return { account };
    } catch (e: any) {
      reply.code(400).send({ error: e?.message || 'Could not save the Google Play connection.' });
      return undefined;
    }
  });

  // Validate a pasted service-account JSON without storing it (structural check only —
  // a live Play API probe is added with the upload pipeline).
  app.post('/api/orgs/:id/play/validate', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    const raw = String((req.body as any)?.serviceAccountJson || '');
    if (!raw.trim()) {
      reply.code(400).send({ error: 'Paste the service-account JSON to validate.' });
      return undefined;
    }
    const parsed = parseServiceAccount(raw.trim());
    if (!parsed.ok) {
      reply.code(400).send({ error: parsed.error });
      return undefined;
    }
    return { ok: true, clientEmail: parsed.clientEmail, projectId: parsed.projectId };
  });

  // Disconnect.
  app.delete('/api/orgs/:id/play', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    await deletePlayAccount(orgId(req));
    return { ok: true };
  });
}
