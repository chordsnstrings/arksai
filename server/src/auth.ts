import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from './config';
import {
  DEFAULT_ORG_ID,
  type Identity,
  createAuthSession,
  getUser,
  getUserByEmail,
  listOrgs,
  orgsForUser,
  resolveAuthSession,
  revokeAuthSession,
  roleInOrg,
  verifyPassword,
} from './orgs/store';

export const COOKIE_NAME = 'arksai_auth'; // legacy super-admin marker (value "ok")
export const SESS_COOKIE = 'arksai_sess'; // per-user opaque session token

declare module 'fastify' {
  interface FastifyRequest {
    identity?: Identity | null;
  }
}

/** Cookie-signing secret derived from the password so logins survive restarts. */
export function cookieSecret(): string {
  return createHash('sha256').update(`arksai-cookie:${config.appPassword}`).digest('hex');
}

function passwordMatches(supplied: string): boolean {
  const a = createHash('sha256').update(supplied).digest();
  const b = createHash('sha256').update(config.appPassword).digest();
  return timingSafeEqual(a, b);
}

// Simple per-IP login rate limit.
const attempts = new Map<string, { count: number; resetAt: number }>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || now > entry.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  entry.count++;
  return entry.count > 8;
}

/** The platform operator: logging in with the shared APP_PASSWORD = sees every org. */
const SUPERADMIN: Identity = {
  userId: 'superadmin',
  email: 'operator',
  orgId: DEFAULT_ORG_ID,
  role: 'superadmin',
  isSuperadmin: true,
};

/** Legacy yes/no check (the operator's APP_PASSWORD cookie). Kept for back-compat callers. */
export function isAuthenticated(req: FastifyRequest): boolean {
  const raw = req.cookies?.[COOKIE_NAME];
  if (!raw) return false;
  const unsigned = req.unsignCookie(raw);
  return unsigned.valid && unsigned.value === 'ok';
}

/** Resolve the per-request identity: a per-user session wins, else the legacy super-admin cookie, else null. */
export async function resolveIdentity(req: FastifyRequest): Promise<Identity | null> {
  const sraw = req.cookies?.[SESS_COOKIE];
  if (sraw) {
    const u = req.unsignCookie(sraw);
    if (u.valid && u.value) {
      const sess = await resolveAuthSession(u.value);
      if (sess) {
        const user = await getUser(sess.userId);
        if (user) {
          const orgRole = user.isSuperadmin
            ? 'superadmin'
            : sess.currentOrgId
              ? await roleInOrg(user.id, sess.currentOrgId)
              : null;
          return {
            userId: user.id,
            email: user.email,
            orgId: sess.currentOrgId,
            role: (orgRole ?? (user.isSuperadmin ? 'superadmin' : 'member')) as Identity['role'],
            isSuperadmin: user.isSuperadmin,
          };
        }
      }
    }
  }
  if (isAuthenticated(req)) return SUPERADMIN;
  return null;
}

const pubUser = (u: { id: string; email: string; name: string | null; isSuperadmin: boolean }) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  isSuperadmin: u.isSuperadmin,
});

function setSessCookie(reply: FastifyReply, token: string) {
  reply.setCookie(SESS_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    signed: true,
    secure: config.cookieSecure,
    maxAge: 30 * 24 * 3600,
  });
}

export function registerAuth(app: FastifyInstance) {
  app.post('/api/auth/login', async (req, reply) => {
    if (rateLimited(req.ip)) return reply.code(429).send({ error: 'Too many attempts. Wait a minute.' });
    const body = (req.body ?? {}) as { email?: string; password?: string };
    const password = typeof body.password === 'string' ? body.password : '';

    // Per-user login (email + password)
    if (typeof body.email === 'string' && body.email.trim()) {
      const user = await getUserByEmail(body.email.trim());
      if (!user || !user.passwordHash || !verifyPassword(password, user.passwordHash)) {
        return reply.code(401).send({ error: 'Invalid email or password.' });
      }
      const orgs = user.isSuperadmin ? await listOrgs() : await orgsForUser(user.id);
      const currentOrg = orgs[0]?.id ?? null;
      const token = await createAuthSession(user.id, currentOrg);
      setSessCookie(reply, token);
      return {
        ok: true,
        user: pubUser(user),
        orgs,
        currentOrg,
        role: user.isSuperadmin ? 'superadmin' : currentOrg ? await roleInOrg(user.id, currentOrg) : null,
      };
    }

    // Legacy platform-operator login (shared APP_PASSWORD → super-admin)
    if (!passwordMatches(password)) return reply.code(401).send({ error: 'Invalid password' });
    reply.setCookie(COOKIE_NAME, 'ok', {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      signed: true,
      secure: config.cookieSecure,
      maxAge: 30 * 24 * 3600,
    });
    return { ok: true, superadmin: true };
  });

  app.get('/api/auth/me', async (req, reply) => {
    const id = req.identity ?? (await resolveIdentity(req));
    if (!id) return reply.code(401).send({ error: 'Unauthorized' });
    if (id.userId === 'superadmin') {
      return {
        user: { id: 'superadmin', email: 'operator', name: 'Operator', isSuperadmin: true },
        orgs: await listOrgs(),
        currentOrg: id.orgId,
        role: 'superadmin',
        isSuperadmin: true,
      };
    }
    const user = await getUser(id.userId);
    const orgs = id.isSuperadmin ? await listOrgs() : await orgsForUser(id.userId);
    return { user: user ? pubUser(user) : null, orgs, currentOrg: id.orgId, role: id.role, isSuperadmin: id.isSuperadmin };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const sraw = req.cookies?.[SESS_COOKIE];
    if (sraw) {
      const u = req.unsignCookie(sraw);
      if (u.valid && u.value) await revokeAuthSession(u.value);
    }
    reply.clearCookie(SESS_COOKIE, { path: '/' });
    reply.clearCookie(COOKIE_NAME, { path: '/' });
    return { ok: true };
  });

  app.addHook('preHandler', async (req: FastifyRequest, reply: FastifyReply) => {
    const url = req.url.split('?')[0];
    const isApi = url.startsWith('/api/');
    req.identity = isApi ? await resolveIdentity(req) : null;
    const open =
      url === '/api/auth/login' ||
      url === '/api/invites/accept' ||
      url === '/healthz' ||
      // Public B2B lead capture from the landing page (POST only; GET is admin).
      (url === '/api/leads' && req.method === 'POST') ||
      !isApi;
    if (open || req.identity) return;
    return reply.code(401).send({ error: 'Unauthorized' });
  });
}
