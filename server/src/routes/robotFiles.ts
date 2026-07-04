import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * Token-gated PUBLIC deliverable serving for robot channel delivery. WhatsApp documents go
 * by LINK (the Cloud API fetches the URL), and SMS deliveries are a link by nature — so the
 * task executor mints a short-lived token for exactly one produced file and hands out
 * `https://arksai.studio/api/robot-file/<token>`.
 *
 * Same security model as videoSrc (red-team pattern):
 *  - a token maps to ONE absolute file path, minted server-side only;
 *  - 60-minute TTL (WhatsApp fetches promptly; a human tapping an SMS link gets an hour);
 *  - only files inside a session workspace (data/) are mintable;
 *  - unknown/expired token → 404, no detail.
 */

const TTL_MS = 60 * 60_000;
const tokens = new Map<string, { abs: string; name: string; expiresAt: number }>();

const MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.zip': 'application/zip',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.mp4': 'video/mp4',
  '.html': 'text/html; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function sweep(): void {
  const now = Date.now();
  for (const [t, v] of tokens) if (v.expiresAt < now) tokens.delete(t);
}

/** Mint a public token for one produced file (must live under the app's data/ tree). */
export function mintRobotFileToken(abs: string): string {
  const norm = path.resolve(abs);
  if (!/[/\\]data[/\\]/.test(norm)) throw new Error('only workspace files can be published for delivery');
  if (!fs.existsSync(norm)) throw new Error('file not found for delivery');
  sweep();
  const token = crypto.randomBytes(24).toString('base64url');
  tokens.set(token, { abs: norm, name: path.basename(norm), expiresAt: Date.now() + TTL_MS });
  return token;
}

/** Test seam. */
export const liveRobotFileTokens = (): number => {
  sweep();
  return tokens.size;
};

export function registerRobotFileRoutes(app: FastifyInstance): void {
  app.get('/api/robot-file/:token', async (req, reply) => {
    const { token } = req.params as { token: string };
    sweep();
    const entry = tokens.get(String(token || ''));
    if (!entry || !fs.existsSync(entry.abs)) return reply.code(404).send({ error: 'Not found' });
    const stat = fs.statSync(entry.abs);
    const type = MIME[path.extname(entry.abs).toLowerCase()] || 'application/octet-stream';
    reply.header('Content-Type', type);
    reply.header('Content-Length', String(stat.size));
    reply.header('Content-Disposition', `attachment; filename="${entry.name.replace(/[^\w.\- ]+/g, '_')}"`);
    return reply.send(fs.createReadStream(entry.abs));
  });
}
