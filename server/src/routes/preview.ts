import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import * as store from '../sessions/store';
import { proxyFetch } from '../lib/proxy';

/**
 * Reverse-proxy to a dev server the agent started inside the workspace
 * container (e.g. on port 4000), so it can be previewed in the canvas iframe.
 * Only forwards to 127.0.0.1 on a sane port range.
 */
export function registerPreviewRoutes(app: FastifyInstance) {
  const handler = async (req: FastifyRequest, reply: FastifyReply) => {
    const { id, port } = req.params as { id: string; port: string; '*'?: string };
    if (!(await store.getSession(id))) return reply.code(404).send({ error: 'Not found' });
    const p = Number(port);
    if (!Number.isInteger(p) || p < 1 || p > 65535) return reply.code(400).send({ error: 'Bad port' });

    const rest = (req.params as Record<string, string>)['*'] ?? '';
    const qs = req.url.includes('?') ? '?' + req.url.split('?').slice(1).join('?') : '';
    const upstream = `http://127.0.0.1:${p}/${rest}${qs}`;
    const prefix = `/api/sessions/${id}/preview/${p}/`;

    const res = await proxyFetch(upstream, req);
    if (!res) {
      return reply
        .code(502)
        .type('text/html')
        .send(
          `<body style="font-family:sans-serif;background:#0a0b0d;color:#888;padding:40px">` +
            `No server responding on port ${p}. Start one with the agent (e.g. "run the dev server"), then refresh.</body>`,
        );
    }

    reply.code(res.status);
    for (const [h, v] of Object.entries(res.headers)) reply.header(h, v);

    if (/text\/html/i.test(res.contentType)) {
      let html = res.body.toString('utf8');
      // Rewrite root-relative asset URLs and inject <base> so the app loads
      // through the proxy prefix instead of the ArksAI app root.
      html = html.replace(/\b(src|href)=("|')\/(?!\/)/gi, `$1=$2${prefix}`);
      if (/<head[^>]*>/i.test(html)) html = html.replace(/<head([^>]*)>/i, `<head$1><base href="${prefix}">`);
      else html = `<base href="${prefix}">` + html;
      return reply.type('text/html').send(html);
    }
    return reply.send(res.body);
  };

  for (const method of ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] as const) {
    app.route({ method, url: '/api/sessions/:id/preview/:port/*', handler });
    app.route({ method, url: '/api/sessions/:id/preview/:port', handler });
  }
}
