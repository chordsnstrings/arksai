import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from './config';

export const COOKIE_NAME = 'arksai_auth';

/** Cookie-signing secret derived from the password so logins survive restarts. */
export function cookieSecret(): string {
  return createHash('sha256').update(`arksai-cookie:${config.appPassword}`).digest('hex');
}

function passwordMatches(supplied: string): boolean {
  const a = createHash('sha256').update(supplied).digest();
  const b = createHash('sha256').update(config.appPassword).digest();
  return timingSafeEqual(a, b);
}

// Simple per-IP login rate limit: 5 attempts/minute.
const attempts = new Map<string, { count: number; resetAt: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || now > entry.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  entry.count++;
  return entry.count > 5;
}

export function isAuthenticated(req: FastifyRequest): boolean {
  const raw = req.cookies?.[COOKIE_NAME];
  if (!raw) return false;
  const unsigned = req.unsignCookie(raw);
  return unsigned.valid && unsigned.value === 'ok';
}

export function registerAuth(app: FastifyInstance) {
  app.post('/api/auth/login', async (req, reply) => {
    if (rateLimited(req.ip)) {
      return reply.code(429).send({ error: 'Too many attempts. Wait a minute.' });
    }
    const body = (req.body ?? {}) as { password?: string };
    if (typeof body.password !== 'string' || !passwordMatches(body.password)) {
      return reply.code(401).send({ error: 'Invalid password' });
    }
    reply.setCookie(COOKIE_NAME, 'ok', {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      signed: true,
      secure: config.cookieSecure,
      maxAge: 30 * 24 * 3600,
    });
    return { ok: true };
  });

  app.post('/api/auth/logout', async (_req, reply) => {
    reply.clearCookie(COOKIE_NAME, { path: '/' });
    return { ok: true };
  });

  app.addHook('preHandler', (req: FastifyRequest, reply: FastifyReply, done) => {
    const url = req.url.split('?')[0];
    const open = url === '/api/auth/login' || url === '/healthz' || !url.startsWith('/api/');
    if (open || isAuthenticated(req)) return done();
    reply.code(401).send({ error: 'Unauthorized' });
    done();
  });
}
