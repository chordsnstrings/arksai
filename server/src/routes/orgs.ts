import type { FastifyInstance, FastifyRequest } from 'fastify';
import { isFreeEmailDomain } from '../../../shared/types';
import { config } from '../config';
import { q } from '../db';
import { SESS_COOKIE } from '../auth';
import {
  acceptInvite,
  createAuthSession,
  createInvite,
  createOrg,
  getOrg,
  listInvitesForOrg,
  listOrgs,
  membersOfOrg,
  removeMembership,
  type Role,
  roleInOrg,
  setSessionOrg,
  updateOrgName,
} from '../orgs/store';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

async function canAdminOrg(req: FastifyRequest, orgId: string): Promise<boolean> {
  const id = req.identity;
  if (!id) return false;
  if (id.isSuperadmin) return true;
  return (await roleInOrg(id.userId, orgId)) === 'admin';
}

/** Best-effort absolute invite link for the operator to copy/share (no email infra). */
function inviteLink(req: FastifyRequest, token: string): string {
  const proto = (req.headers['x-forwarded-proto'] as string)?.split(',')[0] || (config.cookieSecure ? 'https' : 'http');
  const host = req.headers.host || 'localhost';
  return `${proto}://${host}/invite/${token}`;
}

function setSessCookie(reply: any, token: string) {
  reply.setCookie(SESS_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    signed: true,
    secure: config.cookieSecure,
    maxAge: 30 * 24 * 3600,
  });
}

export function registerOrgRoutes(app: FastifyInstance) {
  // Accept an invite (OPEN route — allowlisted in auth.ts) → creates/sets the user's
  // password, adds the membership, and logs them straight in.
  app.post('/api/invites/accept', async (req, reply) => {
    const b = (req.body ?? {}) as { token?: string; password?: string; name?: string };
    if (!b.token || !b.password) return reply.code(400).send({ error: 'A token and password are required.' });
    const res = await acceptInvite(String(b.token), String(b.password), b.name ? String(b.name) : null);
    if ('error' in res) return reply.code(400).send({ error: res.error });
    const token = await createAuthSession(res.user.id, res.orgId);
    setSessCookie(reply, token);
    return { ok: true, user: { id: res.user.id, email: res.user.email, name: res.user.name }, currentOrg: res.orgId };
  });

  // Switch the current org for this session. A company's workspace is its OWN and is
  // NOT swappable — ONLY the platform operator (super-admin), who provisions/supports
  // every org, may switch. Regular members/admins are fixed to their organization.
  app.post('/api/orgs/:id/switch', async (req, reply) => {
    const id = req.identity;
    const { id: orgId } = req.params as { id: string };
    if (!id) return reply.code(401).send({ error: 'Unauthorized' });
    if (!id.isSuperadmin) {
      return reply.code(403).send({ error: 'Your workspace is fixed to your organization and cannot be switched.' });
    }
    const sraw = req.cookies?.[SESS_COOKIE];
    if (sraw) {
      const u = req.unsignCookie(sraw);
      if (u.valid && u.value) await setSessionOrg(u.value, orgId);
    }
    return { ok: true, currentOrg: orgId };
  });

  // ---- per-org admin (admins of that org, or the super-admin) ----
  app.get('/api/orgs/:id/members', async (req, reply) => {
    const { id: orgId } = req.params as { id: string };
    if (!(await canAdminOrg(req, orgId))) return reply.code(403).send({ error: 'Admins only.' });
    return { members: await membersOfOrg(orgId) };
  });

  app.post('/api/orgs/:id/invites', async (req, reply) => {
    const { id: orgId } = req.params as { id: string };
    if (!(await canAdminOrg(req, orgId))) return reply.code(403).send({ error: 'Admins only.' });
    const b = (req.body ?? {}) as { email?: string; role?: string };
    const email = String(b.email ?? '').trim();
    if (!EMAIL_RE.test(email)) return reply.code(400).send({ error: 'A valid email is required.' });
    if (isFreeEmailDomain(email))
      return reply.code(400).send({ error: 'Use a company email address — free/personal email domains (gmail, outlook, etc.) are not allowed.' });
    const role: Role = b.role === 'admin' ? 'admin' : 'member';
    const { invite, token } = await createInvite({ orgId, email, role, invitedBy: req.identity?.userId ?? null });
    return reply.code(201).send({ invite, link: inviteLink(req, token) });
  });

  app.get('/api/orgs/:id/invites', async (req, reply) => {
    const { id: orgId } = req.params as { id: string };
    if (!(await canAdminOrg(req, orgId))) return reply.code(403).send({ error: 'Admins only.' });
    return { invites: await listInvitesForOrg(orgId) };
  });

  app.delete('/api/orgs/:id/members/:userId', async (req, reply) => {
    const { id: orgId, userId } = req.params as { id: string; userId: string };
    if (!(await canAdminOrg(req, orgId))) return reply.code(403).send({ error: 'Admins only.' });
    if (userId === req.identity?.userId) return reply.code(400).send({ error: 'You cannot remove yourself.' });
    await removeMembership(userId, orgId);
    return { ok: true };
  });

  app.patch('/api/orgs/:id', async (req, reply) => {
    const { id: orgId } = req.params as { id: string };
    if (!(await canAdminOrg(req, orgId))) return reply.code(403).send({ error: 'Admins only.' });
    const name = String((req.body as any)?.name ?? '').trim();
    if (name) await updateOrgName(orgId, name.slice(0, 80));
    return { ok: true, org: await getOrg(orgId) };
  });

  // ---- platform super-admin (the operator): provision orgs, review the waitlist ----
  app.get('/api/admin/orgs', async (req, reply) => {
    if (!req.identity?.isSuperadmin) return reply.code(403).send({ error: 'Super-admin only.' });
    return { orgs: await listOrgs() };
  });

  app.post('/api/admin/orgs', async (req, reply) => {
    if (!req.identity?.isSuperadmin) return reply.code(403).send({ error: 'Super-admin only.' });
    const b = (req.body ?? {}) as { name?: string; adminEmail?: string };
    const name = String(b.name ?? '').trim();
    if (!name) return reply.code(400).send({ error: 'An organization name is required.' });
    const org = await createOrg(name.slice(0, 80));
    let adminInviteLink: string | null = null;
    const adminEmail = String(b.adminEmail ?? '').trim();
    if (adminEmail && isFreeEmailDomain(adminEmail))
      return reply.code(400).send({ error: 'Use a company email for the org admin — free/personal email domains are not allowed.' });
    if (EMAIL_RE.test(adminEmail)) {
      const { token } = await createInvite({ orgId: org.id, email: adminEmail, role: 'admin', invitedBy: 'superadmin' });
      adminInviteLink = inviteLink(req, token);
    }
    return reply.code(201).send({ org, adminInviteLink });
  });

  // The waitlist (leads) — super-admin reviews it, then provisions an org + invite.
  app.get('/api/admin/leads', async (req, reply) => {
    if (!req.identity?.isSuperadmin) return reply.code(403).send({ error: 'Super-admin only.' });
    const rows = await q('SELECT id, email, company, role, team, note, created_at FROM leads ORDER BY created_at DESC LIMIT 500');
    return { leads: rows };
  });
}
