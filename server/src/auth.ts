import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from './config';
import { googleConfigured } from './googleOauth';
import { setGoogleCreds } from './googleRuntime';
import { track } from './analytics/track';
import { getSetting, setSetting } from './db';
import { getRate } from './lib/fx';
import { walletBalanceUsd } from './wallet/store';
import { currencyOf } from '../../shared/currency';
import {
  DEFAULT_ORG_ID,
  type Identity,
  createAuthSession,
  getOrgProfile,
  getUser,
  getUserByEmail,
  listOrgs,
  orgsForUser,
  resolveAuthSession,
  revokeAuthSession,
  roleInOrg,
  updateUserName,
  verifyPassword,
} from './orgs/store';

const OPERATOR_NAME_KEY = 'operator.display_name';

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
          if (user.isSuperadmin) {
            return { userId: user.id, email: user.email, orgId: sess.currentOrgId, role: 'superadmin', isSuperadmin: true };
          }
          // A non-superadmin MUST have a current org AND still be a member of it. A
          // null-org (or removed-from-org) identity gets NO access — never fall through
          // to an unscoped "internal" scope (that was the cross-tenant escalation).
          const role = sess.currentOrgId ? await roleInOrg(user.id, sess.currentOrgId) : null;
          if (!sess.currentOrgId || !role) return null;
          return { userId: user.id, email: user.email, orgId: sess.currentOrgId, role, isSuperadmin: false };
        }
      }
    }
  }
  if (isAuthenticated(req)) return SUPERADMIN;
  return null;
}

/** Convert the resolved identity into a store scope (undefined / super-admin = no org filter). */
export function scopeOf(req: FastifyRequest): { orgId: string | null; userId: string; isSuperadmin: boolean } | undefined {
  const id = req.identity;
  return id ? { orgId: id.orgId, userId: id.userId, isSuperadmin: id.isSuperadmin } : undefined;
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
      // A non-superadmin with no organization has no access — don't mint a null-org
      // session (that path bypassed org scoping). They need an invite.
      if (!user.isSuperadmin && orgs.length === 0) {
        return reply.code(403).send({ error: 'Your account isn’t part of an organization yet — ask your admin for an invite link.' });
      }
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

  // Operator sets the Google OAuth client (id + secret) WITHOUT editing .env — stored in app_settings
  // (secret encrypted via lib/crypto). Powers the Google Workspace + Ads CONNECTORS (not login).
  app.post('/api/admin/google-oauth/configure', async (req, reply) => {
    if (!req.identity?.isSuperadmin) return reply.code(403).send({ error: 'Super-admin only.' });
    const b = (req.body ?? {}) as { clientId?: string; clientSecret?: string };
    const clientId = String(b.clientId ?? '').trim();
    const clientSecret = String(b.clientSecret ?? '').trim();
    if (!clientId || !clientSecret) return reply.code(400).send({ error: 'clientId and clientSecret are required.' });
    await setGoogleCreds(clientId, clientSecret);
    return { ok: true, enabled: googleConfigured(), callbackUrl: `${config.publicBaseUrl}/api/google/callback` };
  });

  app.get('/api/auth/me', async (req, reply) => {
    const id = req.identity ?? (await resolveIdentity(req));
    if (!id) return reply.code(401).send({ error: 'Unauthorized' });
    track('app_open', { userId: id.userId, orgId: id.orgId }); // login/activity signal (fire-and-forget)
    if (id.userId === 'superadmin') {
      const opName = (await getSetting(OPERATOR_NAME_KEY).catch(() => null)) || 'Operator';
      return {
        user: { id: 'superadmin', email: 'operator', name: opName, isSuperadmin: true },
        orgs: await listOrgs(),
        currentOrg: id.orgId,
        role: 'superadmin',
        isSuperadmin: true,
      };
    }
    const user = await getUser(id.userId);
    const orgs = id.isSuperadmin ? await listOrgs() : await orgsForUser(id.userId);
    // Onboarding status for the current org → the client gates the first-run wizard on it.
    const prof = id.orgId ? await getOrgProfile(id.orgId).catch(() => null) : null;
    // Current org's display-currency rate (for honest BDT formatting) + a tiny wallet summary
    // (balance + low-balance flag) so the client can format costs + show a top-up banner.
    const meCur = currencyOf(orgs.find((o) => o.id === id.orgId)?.currency).code;
    const fx = await getRate(meCur).catch(() => null);
    let wallet: { balanceUsd: number; lowBalance: boolean; enforced: boolean } | null = null;
    if (id.orgId && id.orgId !== DEFAULT_ORG_ID) {
      try {
        const balanceUsd = await walletBalanceUsd(id.orgId);
        wallet = { balanceUsd, lowBalance: balanceUsd <= config.walletLowUsd, enforced: config.walletEnforce };
      } catch {
        /* wallet optional */
      }
    }
    return {
      user: user ? pubUser(user) : null,
      orgs,
      currentOrg: id.orgId,
      currentOrgOnboarded: prof ? prof.onboardingComplete : true,
      role: id.role,
      isSuperadmin: id.isSuperadmin,
      fx: fx ? { code: fx.code, rate: fx.rate, asOf: fx.asOf, pegged: fx.pegged } : null,
      wallet,
    };
  });

  // Persist the user's chosen display name so the greeting follows them across devices
  // (the operator has no users row → it lives in app_settings; members → their user row).
  app.post('/api/auth/name', async (req, reply) => {
    const id = req.identity ?? (await resolveIdentity(req));
    if (!id) return reply.code(401).send({ error: 'Unauthorized' });
    const raw = String((req.body as any)?.name ?? '').trim().slice(0, 60);
    const name = raw || null;
    if (id.userId === 'superadmin') await setSetting(OPERATOR_NAME_KEY, name ?? 'Operator');
    else await updateUserName(id.userId, name);
    return { ok: true, name };
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
      // Ephemeral Android build droplet → source/artifact/fail. Token-gated INSIDE the
      // route (per-build one-time token); the droplet has no app session cookie.
      /^\/api\/builds\/[^/]+\/(source|artifact|fail|bakelog)$/.test(url) ||
      // Story-video extension inputs: the video provider fetches a clip via a short-lived,
      // path-locked token minted server-side (routes/videoSrc.ts). Token IS the gate.
      /^\/api\/video-src\/[A-Za-z0-9_-]+$/.test(url) ||
      // Robot channel webhooks: Meta (verify handshake + signed inbound) and SMSALA
      // (per-channel random hookKey in the URL is the gate). Validated inside the routes.
      url === '/api/hooks/whatsapp' ||
      /^\/api\/hooks\/sms\/[A-Za-z0-9_-]+$/.test(url) ||
      // Robot deliverable fetch (WhatsApp document-by-link): short-lived minted token.
      /^\/api\/robot-file\/[A-Za-z0-9_-]+$/.test(url) ||
      !isApi;
    if (open || req.identity) return;
    return reply.code(401).send({ error: 'Unauthorized' });
  });
}
