import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { q } from '../db';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Light per-IP rate limit so the public endpoint can't be flooded.
const hits = new Map<string, { count: number; resetAt: number }>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const e = hits.get(ip);
  if (!e || now > e.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  e.count++;
  return e.count > 8;
}

const clip = (v: unknown, n: number): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s ? s.slice(0, n) : null;
};

export function registerLeadRoutes(app: FastifyInstance) {
  // PUBLIC — the landing page posts here pre-login (allowlisted in auth.ts).
  app.post('/api/leads', async (req, reply) => {
    if (rateLimited(req.ip)) return reply.code(429).send({ error: 'Too many requests — try again shortly.' });
    const b = (req.body ?? {}) as Record<string, unknown>;
    const email = clip(b.email, 200);
    if (!email || !EMAIL_RE.test(email)) return reply.code(400).send({ error: 'A valid email is required.' });
    await q(
      `INSERT INTO leads(id, email, company, role, team, note, created_at) VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [randomUUID(), email, clip(b.company, 160), clip(b.role, 120), clip(b.team, 80), clip(b.note, 1000), Date.now()],
    );
    return reply.code(201).send({ ok: true });
  });

  // OPERATOR ONLY — the waitlist is platform data. (The auth preHandler only proves
  // authenticated; this endpoint must additionally require super-admin so a normal
  // tenant can't dump every lead. The client uses the gated /api/admin/leads.)
  app.get('/api/leads', async (req, reply) => {
    if (!req.identity?.isSuperadmin) return reply.code(403).send({ error: 'Super-admin only.' });
    const rows = await q(`SELECT id, email, company, role, team, note, created_at FROM leads ORDER BY created_at DESC LIMIT 500`);
    return { leads: rows };
  });
}
