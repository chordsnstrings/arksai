import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import * as store from '../sessions/store';
import { scopeOf } from '../auth';
import { recordFeedback, listFeedback, setFeedbackStatus, feedbackSummary } from '../feedback/store';
import type { CreateFeedbackRequest, Feedback } from '../../../shared/types';

function requireSuperadmin(req: FastifyRequest, reply: FastifyReply): boolean {
  if (!req.identity?.isSuperadmin) {
    reply.code(403).send({ error: 'Super-admin only.' });
    return false;
  }
  return true;
}

export function registerFeedbackRoutes(app: FastifyInstance) {
  // A user rates the agent's output on their own session. Tagged with the caller's org, so a
  // complaint can never be attributed to (or read by) another org.
  app.post('/api/sessions/:id/feedback', async (req, reply) => {
    const { id } = req.params as { id: string };
    const scope = scopeOf(req);
    if (!scope) return reply.code(401).send({ error: 'Unauthorized' });
    if (!(await store.getSession(id))) return reply.code(404).send({ error: 'Not found' });
    const body = (req.body ?? {}) as CreateFeedbackRequest;
    const rating = body.rating === 'up' || body.rating === 'down' ? body.rating : null;
    const kind = ['deliverable', 'reply', 'app'].includes(body.kind as string) ? body.kind : 'reply';
    if (!rating) return reply.code(400).send({ error: 'rating must be "up" or "down".' });
    const fb = await recordFeedback(scope.orgId, id, { ...body, rating, kind: kind as Feedback['kind'] });
    return fb;
  });

  // Operator console: see what users said, platform-wide. Metadata + the user's own words; no
  // chat/document content is ever stored or returned (write-side allowlist in the store).
  app.get('/api/admin/feedback', async (req, reply) => {
    if (!requireSuperadmin(req, reply)) return;
    const qp = (req.query ?? {}) as { rating?: 'up' | 'down'; status?: Feedback['status'] };
    return {
      items: await listFeedback({ orgId: null }, { rating: qp.rating, status: qp.status, limit: 300 }),
      summary: await feedbackSummary({ orgId: null }),
    };
  });

  app.patch('/api/admin/feedback/:fid', async (req, reply) => {
    if (!requireSuperadmin(req, reply)) return;
    const { fid } = req.params as { fid: string };
    const status = (req.body as { status?: Feedback['status'] })?.status;
    if (!['new', 'reviewed', 'dismissed'].includes(status as string)) return reply.code(400).send({ error: 'bad status' });
    await setFeedbackStatus(fid, status as Feedback['status'], { orgId: null });
    return { ok: true };
  });
}
