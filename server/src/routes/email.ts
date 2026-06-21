import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { roleInOrg } from '../orgs/store';
import {
  accountSecrets,
  deleteEmailAccount,
  getEmailAccount,
  markVerified,
  upsertEmailAccount,
  type EmailAccount,
} from '../email/accounts';
import { verifyAccount } from '../email/client';

/**
 * Per-org email connection management. An org admin (or the operator) connects the
 * org's mailbox (SMTP + IMAP). Passwords are write-only over the API — they're
 * stored encrypted and never returned (the response carries only hasSmtpPass /
 * hasImapPass flags).
 */

async function canManage(req: FastifyRequest, orgId: string): Promise<boolean> {
  const id = req.identity;
  if (!id) return false;
  if (id.isSuperadmin) return true;
  return (await roleInOrg(id.userId, orgId)) === 'admin';
}

const orgId = (req: FastifyRequest) => (req.params as { id: string }).id;

export function registerEmailRoutes(app: FastifyInstance) {
  const guard = async (req: FastifyRequest, reply: FastifyReply): Promise<boolean> => {
    const ok = await canManage(req, orgId(req));
    if (!ok) reply.code(403).send({ error: 'Admins only.' });
    return ok;
  };

  app.get('/api/orgs/:id/email', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    return { account: await getEmailAccount(orgId(req)) };
  });

  app.put('/api/orgs/:id/email', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    const b = (req.body as any) || {};
    if (!b.fromEmail || !b.smtpHost) {
      return reply.code(400).send({ error: 'A from address and an SMTP host are required.' });
    }
    const account = await upsertEmailAccount(orgId(req), {
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

  // Test the connection. Uses the submitted credentials, falling back to the stored
  // (encrypted) password when the form leaves the field blank — so an admin can
  // re-test an existing account without re-typing the password.
  app.post('/api/orgs/:id/email/test', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    const id = orgId(req);
    const b = (req.body as any) || {};
    if (!b.smtpHost || !b.fromEmail) {
      return reply.code(400).send({ error: 'A from address and an SMTP host are required to test.' });
    }
    const stored = await accountSecrets(id);
    const account: EmailAccount = {
      orgId: id,
      fromName: b.fromName ?? null,
      fromEmail: String(b.fromEmail).trim(),
      smtpHost: String(b.smtpHost).trim(),
      smtpPort: Number(b.smtpPort) || 587,
      smtpSecure: !!b.smtpSecure,
      smtpUser: b.smtpUser ?? null,
      imapHost: b.imapHost ? String(b.imapHost).trim() : null,
      imapPort: Number(b.imapPort) || 993,
      imapSecure: b.imapSecure !== false,
      imapUser: b.imapUser ?? null,
      enabled: true,
      autoReply: !!b.autoReply,
      verifiedAt: null,
      hasSmtpPass: !!(b.smtpPass || stored.smtpPass),
      hasImapPass: !!(b.imapPass || stored.imapPass),
      updatedAt: Date.now(),
    };
    const secrets = { smtpPass: b.smtpPass || stored.smtpPass, imapPass: b.imapPass || stored.imapPass };
    const result = await verifyAccount(account, secrets);
    if (result.smtp.ok && (result.imap.ok || result.imap.skipped)) {
      await markVerified(id).catch(() => {});
    }
    return { result };
  });

  app.delete('/api/orgs/:id/email', async (req, reply) => {
    if (!(await guard(req, reply))) return undefined;
    await deleteEmailAccount(orgId(req));
    return { ok: true };
  });
}
