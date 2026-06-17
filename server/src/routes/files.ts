import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import * as store from '../sessions/store';
import { repoDir } from '../sessions/workspace';
import { resolveInWorkspace, ToolError } from '../agent/tools/common';

const MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.csv': 'text/csv',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.zip': 'application/zip',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.json': 'application/json',
};

/**
 * RFC 6266 Content-Disposition. A filename can contain non-ASCII (an Arabic legal
 * deliverable) or even CR/LF — putting it raw into `filename="…"` mangles the name in
 * browsers and a CR/LF would make Node throw on the header (a 500 on download). So we
 * emit an ASCII-safe `filename="…"` fallback AND a `filename*=UTF-8''…` with the real
 * UTF-8 name percent-encoded, which modern browsers prefer.
 */
export function contentDisposition(name: string, inline: boolean): string {
  const clean = name.replace(/[\r\n"\\]/g, '_');
  const ascii = clean.replace(/[^\x20-\x7e]/g, '_') || 'download';
  const utf8 = encodeURIComponent(clean).replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

/** Authenticated download of any file inside a session's workspace. */
export function registerFileRoutes(app: FastifyInstance) {
  app.get('/api/sessions/:id/files/*', async (req, reply) => {
    const { id } = req.params as { id: string };
    const rel = (req.params as Record<string, string>)['*'] ?? '';
    if (!(await store.getSession(id))) return reply.code(404).send({ error: 'Not found' });

    let abs: string;
    try {
      abs = resolveInWorkspace(repoDir(id), rel);
    } catch (err) {
      if (err instanceof ToolError) return reply.code(403).send({ error: 'Path outside workspace' });
      throw err;
    }
    if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
      return reply.code(404).send({ error: 'File not found' });
    }
    const name = path.basename(abs);
    // ?inline=1 renders in the browser (canvas viewer); default forces download.
    const inline = (req.query as any)?.inline === '1';
    reply
      .header('Content-Type', MIME[path.extname(abs).toLowerCase()] ?? 'application/octet-stream')
      .header('Content-Disposition', contentDisposition(name, inline))
      .header('Content-Length', fs.statSync(abs).size);
    return reply.send(fs.createReadStream(abs));
  });
}
