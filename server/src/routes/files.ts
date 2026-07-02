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
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
};
const RANGEABLE = new Set(['.mp4', '.webm', '.mov', '.mp3', '.wav']);

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
    const ext = path.extname(abs).toLowerCase();
    const size = fs.statSync(abs).size;
    const mime = MIME[ext] ?? 'application/octet-stream';
    // ?inline=1 renders in the browser (canvas viewer); media (video/audio) is inline by default
    // so a <video>/<audio> tag can play it. Default for docs stays "attachment" (download).
    const inline = (req.query as any)?.inline === '1' || RANGEABLE.has(ext);

    // HTTP range support — required for a <video> to seek/scrub and for Safari to play at all.
    const range = (req.headers['range'] as string | undefined) || '';
    const m = RANGEABLE.has(ext) && /^bytes=(\d*)-(\d*)$/.exec(range);
    if (m) {
      let start = m[1] ? parseInt(m[1], 10) : 0;
      let end = m[2] ? parseInt(m[2], 10) : size - 1;
      if (isNaN(start) || start < 0) start = 0;
      if (isNaN(end) || end >= size) end = size - 1;
      if (start > end) return reply.code(416).header('Content-Range', `bytes */${size}`).send();
      reply
        .code(206)
        .header('Content-Type', mime)
        .header('Accept-Ranges', 'bytes')
        .header('Content-Range', `bytes ${start}-${end}/${size}`)
        .header('Content-Length', end - start + 1)
        .header('Content-Disposition', contentDisposition(name, true));
      return reply.send(fs.createReadStream(abs, { start, end }));
    }

    reply
      .header('Content-Type', mime)
      .header('Content-Disposition', contentDisposition(name, inline))
      .header('Content-Length', size);
    if (RANGEABLE.has(ext)) reply.header('Accept-Ranges', 'bytes');
    return reply.send(fs.createReadStream(abs));
  });

  /** List the videos produced in a session (newest first) — powers the Video studio library. */
  app.get('/api/sessions/:id/videos', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await store.getSession(id))) return reply.code(404).send({ error: 'Not found' });
    const dir = path.join(repoDir(id), 'videos');
    let out: Array<{ name: string; path: string; url: string; bytes: number; ts: number; draft: boolean }> = [];
    try {
      out = fs
        .readdirSync(dir)
        .filter((f) => /\.(mp4|webm|mov)$/i.test(f))
        .map((f) => {
          const st = fs.statSync(path.join(dir, f));
          return {
            name: f,
            path: `videos/${f}`,
            url: `/api/sessions/${id}/files/videos/${encodeURIComponent(f)}?inline=1`,
            bytes: st.size,
            ts: st.mtimeMs,
            draft: /-draft\.[a-z0-9]+$/i.test(f),
          };
        })
        .sort((a, b) => b.ts - a.ts);
    } catch {
      /* no videos dir yet → empty */
    }
    return { videos: out };
  });
}
