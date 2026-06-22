import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { CreateRobotRequest, RobotRole } from '../../../shared/types';
import { roleInOrg } from '../orgs/store';
import {
  createRobot,
  deleteRobot,
  getDraft,
  getRobot,
  listDrafts,
  listRobots,
  markDraftStatus,
  setDraftText,
  updateRobot,
} from '../robots/store';
import { draftReply } from '../robots/reply';
import { pollRobotOnce } from '../robots/poller';
import { sendEmailForRobot, verifyAccount } from '../email/client';
import { detectEmailConfig } from '../email/autoconfig';
import type { InboxMessage } from '../email/client';
import {
  deleteRobotEmailAccount,
  getRobotEmailAccount,
  markRobotVerified,
  robotAccountSecrets,
  upsertRobotEmailAccount,
  type EmailAccount,
} from '../email/accounts';

/**
 * Robots + drafts API, org-scoped. Any member of the org (or the operator) can manage
 * their org's robots. A draft's recipient is LOCKED at creation to the inbound sender —
 * the send endpoint ignores any client-supplied address and uses the stored to_addr.
 */

const ROLES: RobotRole[] = ['customer_service', 'personal_assistant', 'custom'];
const orgId = (req: FastifyRequest) => (req.params as { id: string }).id;

async function canAccess(req: FastifyRequest, oid: string): Promise<boolean> {
  const id = req.identity;
  if (!id) return false;
  if (id.isSuperadmin) return true;
  return (await roleInOrg(id.userId, oid)) != null;
}

export function registerRobotRoutes(app: FastifyInstance) {
  const guard = async (req: FastifyRequest, reply: FastifyReply): Promise<boolean> => {
    const ok = await canAccess(req, orgId(req));
    if (!ok) reply.code(403).send({ error: 'Not a member of this organization.' });
    return ok;
  };

  // ---- robots ----
  app.get('/api/orgs/:id/robots', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    return { robots: await listRobots(orgId(req)) };
  });

  app.post('/api/orgs/:id/robots', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    const b = (req.body as Partial<CreateRobotRequest>) || {};
    if (!b.name || !b.role || !ROLES.includes(b.role)) {
      return reply.code(400).send({ error: 'A name and a valid role are required.' });
    }
    const robot = await createRobot(orgId(req), {
      name: String(b.name).slice(0, 80),
      role: b.role,
      model: b.model,
      autonomy: b.autonomy,
      config: b.config,
    });
    return { robot };
  });

  app.get('/api/orgs/:id/robots/:rid', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    const robot = await getRobot((req.params as any).rid, orgId(req));
    if (!robot) return reply.code(404).send({ error: 'Unknown robot.' });
    return { robot };
  });

  app.put('/api/orgs/:id/robots/:rid', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    const b = (req.body as any) || {};
    const robot = await updateRobot((req.params as any).rid, orgId(req), {
      name: b.name,
      role: b.role,
      status: b.status,
      autonomy: b.autonomy,
      model: b.model,
      config: b.config,
    });
    if (!robot) return reply.code(404).send({ error: 'Unknown robot.' });
    return { robot };
  });

  app.delete('/api/orgs/:id/robots/:rid', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    await deleteRobot((req.params as any).rid, orgId(req));
    return { ok: true };
  });

  // ---- per-robot mailbox (each robot is its own email identity) ----
  app.get('/api/orgs/:id/robots/:rid/email', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    const robot = await getRobot((req.params as any).rid, orgId(req));
    if (!robot) return reply.code(404).send({ error: 'Unknown robot.' });
    return { account: await getRobotEmailAccount(robot.id) };
  });

  app.put('/api/orgs/:id/robots/:rid/email', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    const robot = await getRobot((req.params as any).rid, orgId(req));
    if (!robot) return reply.code(404).send({ error: 'Unknown robot.' });
    const b = (req.body as any) || {};
    if (!b.fromEmail || !b.smtpHost) {
      return reply.code(400).send({ error: 'A from address and an SMTP host are required.' });
    }
    const account = await upsertRobotEmailAccount(robot.id, orgId(req), {
      fromName: b.fromName ?? null,
      fromEmail: String(b.fromEmail).trim(),
      smtpHost: String(b.smtpHost).trim(),
      smtpPort: Number(b.smtpPort) || 587,
      smtpSecure: !!b.smtpSecure,
      smtpUser: b.smtpUser ?? null,
      smtpPass: b.smtpPass ?? null,
      imapHost: b.imapHost ? String(b.imapHost).trim() : null,
      imapPort: Number(b.imapPort) || 993,
      imapSecure: b.imapSecure !== false,
      imapUser: b.imapUser ?? null,
      imapPass: b.imapPass ?? null,
      enabled: b.enabled !== false,
      autoReply: !!b.autoReply,
    });
    return { account };
  });

  app.post('/api/orgs/:id/robots/:rid/email/autoconfig', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    const robot = await getRobot((req.params as any).rid, orgId(req));
    if (!robot) return reply.code(404).send({ error: 'Unknown robot.' });
    const email = String(((req.body as any) || {}).email || '').trim();
    if (!email.includes('@')) return reply.code(400).send({ error: 'A valid email address is required.' });
    return { config: await detectEmailConfig(email) };
  });

  app.post('/api/orgs/:id/robots/:rid/email/test', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    const robot = await getRobot((req.params as any).rid, orgId(req));
    if (!robot) return reply.code(404).send({ error: 'Unknown robot.' });
    const b = (req.body as any) || {};
    if (!b.smtpHost || !b.fromEmail) {
      return reply.code(400).send({ error: 'A from address and an SMTP host are required to test.' });
    }
    const stored = await robotAccountSecrets(robot.id);
    const account: EmailAccount = {
      orgId: orgId(req), robotId: robot.id,
      fromName: b.fromName ?? null, fromEmail: String(b.fromEmail).trim(),
      smtpHost: String(b.smtpHost).trim(), smtpPort: Number(b.smtpPort) || 587, smtpSecure: !!b.smtpSecure,
      smtpUser: b.smtpUser ?? null,
      imapHost: b.imapHost ? String(b.imapHost).trim() : null, imapPort: Number(b.imapPort) || 993,
      imapSecure: b.imapSecure !== false, imapUser: b.imapUser ?? null,
      enabled: true, autoReply: !!b.autoReply, verifiedAt: null,
      hasSmtpPass: !!(b.smtpPass || stored.smtpPass), hasImapPass: !!(b.imapPass || stored.imapPass),
      updatedAt: Date.now(),
    };
    const secrets = { smtpPass: b.smtpPass || stored.smtpPass, imapPass: b.imapPass || stored.imapPass };
    const result = await verifyAccount(account, secrets);
    if (result.smtp.ok && (result.imap.ok || result.imap.skipped)) await markRobotVerified(robot.id).catch(() => {});
    return { result };
  });

  app.delete('/api/orgs/:id/robots/:rid/email', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    const robot = await getRobot((req.params as any).rid, orgId(req));
    if (!robot) return reply.code(404).send({ error: 'Unknown robot.' });
    await deleteRobotEmailAccount(robot.id);
    return { ok: true };
  });

  // Generate a draft from a SAMPLE inbound message — onboarding preview + the
  // M3-vs-DeepSeek bake-off, without waiting for real mail to arrive.
  app.post('/api/orgs/:id/robots/:rid/preview', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    const robot = await getRobot((req.params as any).rid, orgId(req));
    if (!robot) return reply.code(404).send({ error: 'Unknown robot.' });
    const b = (req.body as any) || {};
    const sample: InboxMessage = {
      uid: 0, seq: 0,
      from: String(b.from || 'sample@customer.com'),
      fromName: String(b.fromName || 'Sample Sender'),
      to: '', messageId: '', date: new Date().toISOString(),
      subject: String(b.subject || 'A question'),
      snippet: '', text: String(b.body || b.text || ''),
    };
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 90_000);
    try {
      const outcome = await draftReply(robot, sample, ac.signal);
      return { outcome };
    } catch (e: any) {
      return reply.code(502).send({ error: `Draft failed: ${e?.message ?? e}` });
    } finally {
      clearTimeout(timer);
    }
  });

  // Check the inbox NOW (don't wait for the 60s tick). Runs one poll pass and reports
  // exactly what happened — read N, drafted N, sent N, or the real error — so a robot
  // that "watches" but stays quiet is diagnosable and the user has manual control.
  app.post('/api/orgs/:id/robots/:rid/poll', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    const robot = await getRobot((req.params as any).rid, orgId(req));
    if (!robot) return reply.code(404).send({ error: 'Unknown robot.' });
    if (robot.status !== 'active') return reply.code(400).send({ error: 'Activate the robot first — only active robots check their inbox.' });
    return { summary: await pollRobotOnce(robot) };
  });

  // ---- drafts ----
  app.get('/api/orgs/:id/drafts', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    const status = (req.query as any)?.status;
    const robotId = (req.query as any)?.robotId;
    return { drafts: await listDrafts(orgId(req), robotId, status) };
  });

  app.put('/api/orgs/:id/drafts/:did', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    const text = String((req.body as any)?.text ?? '');
    const draft = await getDraft((req.params as any).did, orgId(req));
    if (!draft) return reply.code(404).send({ error: 'Unknown draft.' });
    await setDraftText(draft.id, orgId(req), text);
    return { ok: true };
  });

  // Approve & send. Recipient + subject come from the STORED draft (locked), never
  // from the request body — only the (optionally edited) text is taken from the client.
  app.post('/api/orgs/:id/drafts/:did/send', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    const draft = await getDraft((req.params as any).did, orgId(req));
    if (!draft) return reply.code(404).send({ error: 'Unknown draft.' });
    if (draft.status === 'sent') return reply.code(409).send({ error: 'Already sent.' });
    const text = String((req.body as any)?.text ?? draft.draftText);
    try {
      await sendEmailForRobot(draft.robotId, {
        to: draft.toAddr, // LOCKED
        subject: draft.subject,
        text,
        inReplyTo: draft.inboundMessageId || undefined,
        references: draft.inboundMessageId || undefined,
      });
      await markDraftStatus(draft.id, orgId(req), 'sent', Date.now());
      return { ok: true };
    } catch (e: any) {
      return reply.code(502).send({ error: `Send failed: ${e?.message ?? e}` });
    }
  });

  app.post('/api/orgs/:id/drafts/:did/dismiss', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    const draft = await getDraft((req.params as any).did, orgId(req));
    if (!draft) return reply.code(404).send({ error: 'Unknown draft.' });
    await markDraftStatus(draft.id, orgId(req), 'dismissed');
    return { ok: true };
  });
}
