import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import * as store from '../sessions/store';
import { deploymentDir, deploymentRegistry } from '../deploy/registry';
import { publishSession, removeDeployment, restartDeployment, stopDeployment } from '../deploy/publish';
import { resolveInWorkspace } from '../agent/tools/common';
import { scopeOf } from '../auth';

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain',
};

/** Rewrite root-absolute asset URLs + inject <base> so an app served under a
 *  /apps/<slug>/ prefix loads its assets correctly. (Same idea as the preview proxy.) */
function rewriteHtml(html: string, prefix: string): string {
  let out = html.replace(/\b(src|href)=("|')\/(?!\/)/gi, `$1=$2${prefix}`);
  if (/<head[^>]*>/i.test(out)) out = out.replace(/<head([^>]*)>/i, `<head$1><base href="${prefix}">`);
  else out = `<base href="${prefix}">` + out;
  return out;
}

export function registerDeploymentRoutes(app: FastifyInstance) {
  // ---- management API (auth-protected, under /api) ----
  app.get('/api/deployments', async (req) => {
    const { sessionId } = (req.query ?? {}) as { sessionId?: string };
    return { deployments: await store.listDeployments(sessionId, scopeOf(req)) };
  });

  app.post('/api/sessions/:id/publish', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await store.getSession(id))) return reply.code(404).send({ error: 'Not found' });
    try {
      const dep = await publishSession(id, (req.body as any)?.name);
      return reply.code(201).send(dep);
    } catch (e: any) {
      return reply.code(500).send({ error: String(e?.message ?? e) });
    }
  });

  // Management ops are ORG-SCOPED: a cross-org slug resolves to null → 404, so one
  // org can never stop/restart/delete another org's app.
  app.post('/api/deployments/:slug/stop', async (req, reply) => {
    const { slug } = req.params as { slug: string };
    if (!(await store.getDeploymentBySlug(slug, scopeOf(req)))) return reply.code(404).send({ error: 'Not found' });
    await stopDeployment(slug);
    return store.getDeploymentBySlug(slug, scopeOf(req));
  });
  app.post('/api/deployments/:slug/restart', async (req, reply) => {
    const { slug } = req.params as { slug: string };
    if (!(await store.getDeploymentBySlug(slug, scopeOf(req)))) return reply.code(404).send({ error: 'Not found' });
    await restartDeployment(slug);
    return store.getDeploymentBySlug(slug, scopeOf(req));
  });
  app.delete('/api/deployments/:slug', async (req, reply) => {
    const { slug } = req.params as { slug: string };
    if (!(await store.getDeploymentBySlug(slug, scopeOf(req)))) return reply.code(404).send({ error: 'Not found' });
    await removeDeployment(slug);
    return { ok: true };
  });

  // ---- public serving at /apps/<slug>/* (NOT under /api → no auth) ----
  const serve = async (req: FastifyRequest, reply: FastifyReply) => {
    const { slug } = req.params as { slug: string; '*'?: string };
    const dep = await store.getDeploymentBySlug(slug);
    if (!dep) return reply.code(404).type('text/html').send('<h1>404 — no such app</h1>');
    // 24h preview expired → treat as gone (the janitor hard-deletes it shortly).
    if (dep.expiresAt != null && dep.expiresAt <= Date.now())
      return reply.code(404).type('text/html').send('<h1>404 — no such app</h1>');
    const rest = (req.params as Record<string, string>)['*'] ?? '';
    const prefix = `/apps/${slug}/`;

    if (dep.kind !== 'static') {
      // Proxy to the running server app.
      const port = deploymentRegistry.runningPort(slug) ?? dep.port;
      if (!port) {
        return reply.code(502).type('text/html').send(`<body style="font-family:sans-serif;padding:40px">This app isn't running. Restart it from ArksAI.</body>`);
      }
      const qs = req.url.includes('?') ? '?' + req.url.split('?').slice(1).join('?') : '';
      let res: Response;
      try {
        res = await fetch(`http://127.0.0.1:${port}/${rest}${qs}`, {
          method: req.method,
          headers: { 'accept-encoding': 'identity' },
          body: ['GET', 'HEAD'].includes(req.method) ? undefined : (req.body as any),
          redirect: 'manual',
        });
      } catch {
        return reply.code(502).type('text/html').send(`<body style="font-family:sans-serif;padding:40px">App not responding on port ${port}.</body>`);
      }
      const ct = res.headers.get('content-type') ?? '';
      reply.code(res.status);
      for (const h of ['content-type', 'cache-control']) {
        const v = res.headers.get(h);
        if (v) reply.header(h, v);
      }
      if (/text\/html/i.test(ct)) return reply.type('text/html').send(rewriteHtml(await res.text(), prefix));
      return reply.send(Buffer.from(await res.arrayBuffer()));
    }

    // Static: serve a file from the snapshot dir.
    const root = deploymentDir(slug);
    let relPath = rest || 'index.html';
    let abs: string;
    try {
      abs = resolveInWorkspace(root, relPath);
    } catch {
      return reply.code(403).send('Forbidden');
    }
    if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) abs = path.join(abs, 'index.html');
    if (!fs.existsSync(abs)) {
      // SPA fallback to index.html
      const idx = path.join(root, 'index.html');
      if (fs.existsSync(idx)) abs = idx;
      else return reply.code(404).type('text/html').send('<h1>404</h1>');
    }
    const ext = path.extname(abs).toLowerCase();
    const type = MIME[ext] ?? 'application/octet-stream';
    if (ext === '.html') {
      return reply.type('text/html').send(rewriteHtml(fs.readFileSync(abs, 'utf8'), prefix));
    }
    return reply.type(type).send(fs.createReadStream(abs));
  };

  for (const method of ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] as const) {
    app.route({ method, url: '/apps/:slug', handler: serve });
    app.route({ method, url: '/apps/:slug/*', handler: serve });
  }
}
