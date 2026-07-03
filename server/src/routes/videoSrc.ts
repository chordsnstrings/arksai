import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * Token-gated PUBLIC clip serving (STORY_PLAN Phase 0). Seedance 2.0's reference_video role
 * only accepts WEB urls (data URLs rejected — probed 2026-07-03), so when a story scene
 * EXTENDS the previous clip, the executor mints a short-lived token for exactly that file and
 * hands the provider `https://arksai.studio/api/video-src/<token>`.
 *
 * Security model (red-team tested):
 *  - a token maps to ONE absolute file path, minted server-side only (never from user input);
 *  - 15-minute TTL, then 404 (NOT single-use: the provider may range/retry the fetch);
 *  - only files inside a session's videos/ dir are mintable;
 *  - unknown/expired token → 404 with no detail; no directory access of any kind.
 */

const TTL_MS = 15 * 60_000;
const tokens = new Map<string, { abs: string; expiresAt: number }>();

function sweep(): void {
  const now = Date.now();
  for (const [t, v] of tokens) if (v.expiresAt < now) tokens.delete(t);
}

/** Mint a public token for one clip. `abs` must live under a `videos/` directory. */
export function mintVideoToken(abs: string): string {
  const norm = path.resolve(abs);
  if (!/[/\\]videos[/\\]/.test(norm)) throw new Error('only files under a videos/ directory can be published for extension');
  if (!fs.existsSync(norm)) throw new Error('clip not found for publishing');
  sweep();
  const token = crypto.randomBytes(24).toString('base64url');
  tokens.set(token, { abs: norm, expiresAt: Date.now() + TTL_MS });
  return token;
}

/** Test seam: how many live tokens exist. */
export const liveVideoTokens = (): number => {
  sweep();
  return tokens.size;
};

export function registerVideoSrcRoutes(app: FastifyInstance): void {
  app.get('/api/video-src/:token', async (req, reply) => {
    const { token } = req.params as { token: string };
    sweep();
    const entry = tokens.get(String(token || ''));
    if (!entry || !fs.existsSync(entry.abs)) return reply.code(404).send({ error: 'Not found' });
    const stat = fs.statSync(entry.abs);
    // Range support: the provider may fetch with ranges; a plain full-body reply also works.
    const range = String(req.headers.range || '');
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    reply.header('Content-Type', 'video/mp4');
    reply.header('Accept-Ranges', 'bytes');
    if (m && (m[1] || m[2])) {
      const start = m[1] ? parseInt(m[1], 10) : Math.max(0, stat.size - parseInt(m[2], 10));
      const end = m[1] && m[2] ? Math.min(parseInt(m[2], 10), stat.size - 1) : stat.size - 1;
      if (!(start >= 0 && start <= end && end < stat.size)) return reply.code(416).send();
      reply.code(206);
      reply.header('Content-Range', `bytes ${start}-${end}/${stat.size}`);
      reply.header('Content-Length', String(end - start + 1));
      return reply.send(fs.createReadStream(entry.abs, { start, end }));
    }
    reply.header('Content-Length', String(stat.size));
    return reply.send(fs.createReadStream(entry.abs));
  });
}
