import type { FastifyInstance } from 'fastify';
import type { HomeSnapshot } from '../../../shared/types';
import * as store from '../sessions/store';
import { listSchedules } from '../schedule/scheduler';
import { listRobots, listNeedsYouDrafts } from '../robots/store';
import { scopeOf } from '../auth';

/**
 * One read-only, ORG-SCOPED aggregation for the Home/Workspace + Activity surfaces:
 * "what's running for you" (deployments / schedules / robots) and "what needs you"
 * (pending robot drafts). The org is resolved from the authenticated identity via
 * `scopeOf` (never the client), so a tenant only ever sees its own org's snapshot.
 * Sessions stay client-side (already loaded) and the wallet stays on `/api/auth/me`.
 */
export function registerHomeRoutes(app: FastifyInstance) {
  app.get('/api/home', async (req): Promise<HomeSnapshot> => {
    const scope = scopeOf(req);
    const orgId = scope?.orgId ?? null;
    // Deployments + schedules are scope-aware. Robots/drafts are keyed by a concrete
    // orgId — when there's no org (shouldn't happen for an authed tenant) return empty
    // rather than leaking another org's rows.
    const [deployments, schedules, robots, pendingDrafts] = await Promise.all([
      store.listDeployments(undefined, scope).catch(() => []),
      listSchedules(scope).catch(() => []),
      orgId ? listRobots(orgId).catch(() => []) : Promise.resolve([]),
      orgId ? listNeedsYouDrafts(orgId).catch(() => []) : Promise.resolve([]),
    ]);
    return { deployments, schedules, robots, pendingDrafts };
  });
}
