import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { CreateRobotRequest, RobotRole } from '../../../shared/types';
import { roleInOrg } from '../orgs/store';
import {
  addForwardTarget,
  createRobot,
  createRule,
  deleteForwardTarget,
  deleteRobot,
  deleteRule,
  getDraft,
  getRobot,
  isAllowedForwardTarget,
  listDrafts,
  listForwardTargets,
  listRobots,
  listRules,
  markDraftStatus,
  setDraftText,
  snoozeDraft,
  updateRobot,
} from '../robots/store';
import { draftReply, regenerateDraft } from '../robots/reply';
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

  // ---- learned rules (the learning loop) ----
  app.get('/api/orgs/:id/robots/:rid/rules', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    return { rules: await listRules(orgId(req), (req.params as any).rid) };
  });
  app.post('/api/orgs/:id/robots/:rid/rules', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    const rid = (req.params as any).rid;
    const robot = await getRobot(rid, orgId(req));
    if (!robot) return reply.code(404).send({ error: 'Unknown robot.' });
    const pattern = String((req.body as any)?.pattern ?? '').trim();
    const instruction = String((req.body as any)?.instruction ?? '').trim();
    if (!pattern || !instruction) return reply.code(400).send({ error: 'A rule needs a pattern and an instruction.' });
    return { rule: await createRule(orgId(req), rid, pattern, instruction) };
  });
  app.delete('/api/orgs/:id/robots/:rid/rules/:ruleId', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    await deleteRule(orgId(req), (req.params as any).ruleId);
    return { ok: true };
  });

  // Snooze a draft → it leaves "needs you" and returns at `until` (poller wakes it).
  app.post('/api/orgs/:id/drafts/:did/snooze', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    const draft = await getDraft((req.params as any).did, orgId(req));
    if (!draft) return reply.code(404).send({ error: 'Unknown draft.' });
    const until = Number((req.body as any)?.until);
    if (!Number.isFinite(until) || until <= Date.now()) return reply.code(400).send({ error: 'Pick a future time.' });
    await snoozeDraft(draft.id, orgId(req), until);
    return { ok: true };
  });

  // Archive a draft → acknowledged, no reply.
  app.post('/api/orgs/:id/drafts/:did/archive', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    const draft = await getDraft((req.params as any).did, orgId(req));
    if (!draft) return reply.code(404).send({ error: 'Unknown draft.' });
    await markDraftStatus(draft.id, orgId(req), 'archived');
    return { ok: true };
  });

  // Forward the inbound to an ADMIN-ALLOWLISTED teammate (the one case the recipient-lock is
  // broken — gated to the allowlist, never a free-form address).
  app.post('/api/orgs/:id/drafts/:did/forward', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    const draft = await getDraft((req.params as any).did, orgId(req));
    if (!draft) return reply.code(404).send({ error: 'Unknown draft.' });
    const to = String((req.body as any)?.to ?? '').trim();
    const note = String((req.body as any)?.note ?? '').trim();
    if (!to || !(await isAllowedForwardTarget(orgId(req), to))) {
      return reply.code(403).send({ error: 'That address is not on the forward allowlist.' });
    }
    try {
      const body =
        `${note ? note + '\n\n' : ''}--- Forwarded by ${draft.robotId ? 'your robot' : 'ArksAI'} ---\n` +
        `From: ${draft.inboundName ? `${draft.inboundName} <${draft.inboundFrom}>` : draft.inboundFrom}\n` +
        `Subject: ${draft.inboundSubject || '(no subject)'}\n\n${draft.inboundBody || draft.inboundSnippet || ''}`;
      await sendEmailForRobot(draft.robotId, { to, subject: `Fwd: ${draft.inboundSubject || '(no subject)'}`, text: body });
      await markDraftStatus(draft.id, orgId(req), 'dismissed');
      return { ok: true };
    } catch (e: any) {
      return reply.code(502).send({ error: `Forward failed: ${e?.message ?? e}` });
    }
  });

  // Forward allowlist (org-level; admin-managed).
  app.get('/api/orgs/:id/robot-forward-targets', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    return { targets: await listForwardTargets(orgId(req)) };
  });
  app.post('/api/orgs/:id/robot-forward-targets', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    const email = String((req.body as any)?.email ?? '').trim();
    const label = String((req.body as any)?.label ?? '').trim() || null;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return reply.code(400).send({ error: 'Enter a valid email address.' });
    return { target: await addForwardTarget(orgId(req), email, label) };
  });
  app.delete('/api/orgs/:id/robot-forward-targets/:tid', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    await deleteForwardTarget(orgId(req), (req.params as any).tid);
    return { ok: true };
  });

  // Re-draft a reply from the human's one-line direction (the responder's intent box / chips).
  // Returns the new text + saves it on the draft; the recipient stays locked.
  app.post('/api/orgs/:id/drafts/:did/regenerate', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    const instruction = String((req.body as any)?.instruction ?? '').trim();
    if (!instruction) return reply.code(400).send({ error: 'Tell me how to respond.' });
    const draft = await getDraft((req.params as any).did, orgId(req));
    if (!draft) return reply.code(404).send({ error: 'Unknown draft.' });
    const robot = await getRobot(draft.robotId, orgId(req));
    if (!robot) return reply.code(404).send({ error: 'Unknown robot.' });
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 90_000);
    try {
      const out = await regenerateDraft(robot, draft, instruction, ac.signal);
      if (!out.text) return reply.code(502).send({ error: out.reason || 'Could not draft a reply.' });
      await setDraftText(draft.id, orgId(req), out.text);
      return { text: out.text, model: out.model };
    } catch (e: any) {
      return reply.code(502).send({ error: `Draft failed: ${e?.message ?? e}` });
    } finally {
      clearTimeout(timer);
    }
  });
}
