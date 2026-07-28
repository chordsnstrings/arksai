import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { roleInOrg } from '../orgs/store';
import * as A from '../analytics/queries';
import { listDigests } from '../analytics/digest';
import { listIssueDigests, generateIssueDigest } from '../selfheal/issueDigest';

/**
 * Analytics endpoints. Operator (`/api/admin/analytics/*`) = superadmin-only, whole
 * platform. Per-org (`/api/orgs/:id/analytics/*`) = that org's admin (or the operator),
 * scoped to the org. Everything returned is aggregate METADATA — never content.
 */

const OP: A.Scope = { orgId: null };
const days = (req: FastifyRequest) => Math.min(365, Math.max(1, Number((req.query as any)?.days) || 30));

function operator(req: FastifyRequest, reply: FastifyReply): boolean {
  if (!req.identity?.isSuperadmin) {
    reply.code(403).send({ error: 'Super-admin only.' });
    return false;
  }
  return true;
}
async function canSeeOrg(req: FastifyRequest, orgId: string): Promise<boolean> {
  const id = req.identity;
  if (!id) return false;
  if (id.isSuperadmin) return true;
  return (await roleInOrg(id.userId, orgId)) === 'admin';
}

export function registerAnalyticsRoutes(app: FastifyInstance) {
  // ---- Operator: cross-org platform analytics ----
  app.get('/api/admin/analytics/overview', async (req, reply) => (operator(req, reply) ? { analytics: await A.overview(OP) } : undefined));
  app.get('/api/admin/analytics/timeseries', async (req, reply) => (operator(req, reply) ? { timeseries: await A.timeseries(OP, days(req)) } : undefined));
  app.get('/api/admin/analytics/usage', async (req, reply) => (operator(req, reply) ? { usage: await A.usage(OP, days(req)) } : undefined));
  app.get('/api/admin/analytics/quality', async (req, reply) => (operator(req, reply) ? { quality: await A.quality(OP, days(req)) } : undefined));
  app.get('/api/admin/analytics/cost', async (req, reply) => (operator(req, reply) ? { cost: await A.cost(OP, days(req)) } : undefined));
  app.get('/api/admin/analytics/retention', async (req, reply) => (operator(req, reply) ? { retention: await A.retention(OP) } : undefined));
  app.get('/api/admin/analytics/funnel', async (req, reply) => (operator(req, reply) ? { funnel: await A.funnelData(OP) } : undefined));
  app.get('/api/admin/analytics/orgs', async (req, reply) => (operator(req, reply) ? { orgs: await A.orgsTable() } : undefined));
  app.get('/api/admin/analytics/users', async (req, reply) => (operator(req, reply) ? { users: await A.usersTable(OP) } : undefined));
  app.get('/api/admin/analytics/alerts', async (req, reply) => (operator(req, reply) ? { alerts: await A.alerts(OP) } : undefined));
  app.get('/api/admin/analytics/digests', async (req, reply) => (operator(req, reply) ? { digests: await listDigests() } : undefined));
  // Self-healing Phase 1 — nightly issue digests (ranked, redacted issue clusters across tenants).
  app.get('/api/admin/analytics/issues', async (req, reply) => (operator(req, reply) ? { digests: await listIssueDigests() } : undefined));
  // Operator-triggered on-demand run (e.g. a "refresh now" button); superadmin-only like the rest.
  app.post('/api/admin/analytics/issues/run', async (req, reply) => {
    if (!operator(req, reply)) return undefined;
    const summary = await generateIssueDigest();
    return { summary, digests: await listIssueDigests() };
  });
  app.get('/api/admin/analytics/users/:uid', async (req, reply) => {
    if (!operator(req, reply)) return undefined;
    const user = await A.userDetail(OP, (req.params as { uid: string }).uid);
    if (!user) return reply.code(404).send({ error: 'Unknown user.' });
    return { user };
  });

  // ---- Per-org: an org admin (or the operator) sees their own org ----
  const org = (req: FastifyRequest) => ({ orgId: (req.params as { id: string }).id });
  const guard = async (req: FastifyRequest, reply: FastifyReply): Promise<boolean> => {
    const ok = await canSeeOrg(req, (req.params as { id: string }).id);
    if (!ok) reply.code(403).send({ error: 'Admins only.' });
    return ok;
  };
  app.get('/api/orgs/:id/analytics/overview', async (req, reply) => ((await guard(req, reply)) ? { analytics: await A.overview(org(req)) } : undefined));
  app.get('/api/orgs/:id/analytics/timeseries', async (req, reply) => ((await guard(req, reply)) ? { timeseries: await A.timeseries(org(req), days(req)) } : undefined));
  app.get('/api/orgs/:id/analytics/usage', async (req, reply) => ((await guard(req, reply)) ? { usage: await A.usage(org(req), days(req)) } : undefined));
  app.get('/api/orgs/:id/analytics/quality', async (req, reply) => ((await guard(req, reply)) ? { quality: await A.quality(org(req), days(req)) } : undefined));
  app.get('/api/orgs/:id/analytics/retention', async (req, reply) => ((await guard(req, reply)) ? { retention: await A.retention(org(req)) } : undefined));
  app.get('/api/orgs/:id/analytics/funnel', async (req, reply) => ((await guard(req, reply)) ? { funnel: await A.funnelData(org(req)) } : undefined));
  app.get('/api/orgs/:id/analytics/members', async (req, reply) => ((await guard(req, reply)) ? { members: await A.usersTable(org(req)) } : undefined));
  app.get('/api/orgs/:id/analytics/alerts', async (req, reply) => ((await guard(req, reply)) ? { alerts: await A.alerts(org(req)) } : undefined));
  app.get('/api/orgs/:id/analytics/members/:uid', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    const user = await A.userDetail(org(req), (req.params as { uid: string }).uid);
    if (!user) return reply.code(404).send({ error: 'Unknown user.' });
    return { user };
  });
}
