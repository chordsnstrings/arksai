import fs from 'node:fs';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import * as store from '../sessions/store';
import { scopeOf } from '../auth';
import {
  createBuild,
  getBuild,
  listBuildsForSession,
  updateBuild,
} from '../build/store';
import {
  startAndroidBuild,
  isBuildConfigured,
  sourceTarPath,
  apkPath,
} from '../build/androidBuild';

function tokenOk(want: string, got: unknown): boolean {
  if (typeof got !== 'string' || !got) return false;
  // Compare hashes so length differences don't leak + the compare is constant-time.
  const a = createHash('sha256').update(want).digest();
  const b = createHash('sha256').update(got).digest();
  return timingSafeEqual(a, b);
}

export function registerBuildRoutes(app: FastifyInstance) {
  // The build droplet uploads the raw APK (octet-stream) and a plain-text log tail.
  // Pass the binary body through untouched (we stream it to disk); buffer the log as text.
  if (!app.hasContentTypeParser('application/octet-stream')) {
    app.addContentTypeParser('application/octet-stream', (_req, payload, done) => done(null, payload));
  }
  if (!app.hasContentTypeParser('text/plain')) {
    app.addContentTypeParser('text/plain', { parseAs: 'string', bodyLimit: 64 * 1024 }, (_req, body, done) => done(null, body));
  }

  // ---- Authenticated (the app user): start a build, poll it, download the APK ----

  app.post('/api/sessions/:id/build-apk', async (req, reply) => {
    const { id } = req.params as { id: string };
    const session = await store.getSession(id, scopeOf(req));
    if (!session) return reply.code(404).send({ error: 'Not found' });
    if (!isBuildConfigured()) {
      return reply.code(503).send({
        error: 'Android APK builds are not configured on this server yet. The web/PWA build is available now; the native APK builder needs the one-time build-machine setup (see BUILD_BAKE.md).',
      });
    }
    const appName = String((req.body as any)?.name || session.title || 'ArksAI App').slice(0, 60);
    const build = await createBuild({ sessionId: id, orgId: session.orgId ?? null, appName });
    // Fire-and-forget; the client polls GET /api/builds/:id.
    void startAndroidBuild(build, id);
    return reply.code(201).send({ id: build.id, status: build.status });
  });

  app.get('/api/sessions/:id/builds', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await store.getSession(id, scopeOf(req)))) return reply.code(404).send({ error: 'Not found' });
    const builds = await listBuildsForSession(id);
    return { builds: builds.map(pub) };
  });

  app.get('/api/builds/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = await getBuild(id);
    if (!b || !b.session_id || !(await store.getSession(b.session_id, scopeOf(req)))) {
      return reply.code(404).send({ error: 'Not found' });
    }
    return pub(b);
  });

  app.get('/api/builds/:id/download', async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = await getBuild(id);
    if (!b || !b.session_id || !(await store.getSession(b.session_id, scopeOf(req)))) {
      return reply.code(404).send({ error: 'Not found' });
    }
    if (b.status !== 'success' || !b.artifact_path || !fs.existsSync(b.artifact_path)) {
      return reply.code(409).send({ error: 'APK not ready' });
    }
    const safe = b.app_name.replace(/[^a-zA-Z0-9._-]/g, '-') || 'app';
    reply.header('Content-Type', 'application/vnd.android.package-archive');
    reply.header('Content-Disposition', `attachment; filename="${safe}.apk"`);
    return reply.send(fs.createReadStream(b.artifact_path));
  });

  // ---- Open + token-gated (the ephemeral build droplet calls these over HTTPS) ----
  // These paths are allowlisted in auth.ts; each verifies the per-build one-time token.

  app.get('/api/builds/:id/source', async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = await getBuild(id);
    if (!b || !tokenOk(b.token, (req.query as any)?.token)) return reply.code(404).send('not found');
    const p = sourceTarPath(id);
    if (!fs.existsSync(p)) return reply.code(404).send('no source');
    reply.header('Content-Type', 'application/gzip');
    return reply.send(fs.createReadStream(p));
  });

  app.post('/api/builds/:id/artifact', { bodyLimit: 256 * 1024 * 1024 }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = await getBuild(id);
    if (!b || !tokenOk(b.token, (req.query as any)?.token)) return reply.code(404).send('not found');
    const dest = apkPath(id);
    const body = req.body as NodeJS.ReadableStream | undefined;
    await new Promise<void>((resolve, reject) => {
      const out = fs.createWriteStream(dest);
      const stream = (body && typeof (body as any).pipe === 'function' ? body : (req.raw as NodeJS.ReadableStream));
      stream.pipe(out);
      out.on('finish', () => resolve());
      out.on('error', reject);
      (stream as any).on('error', reject);
    });
    const size = fs.existsSync(dest) ? fs.statSync(dest).size : 0;
    if (size < 1024) {
      await updateBuild(id, { status: 'error', phase: 'upload failed', error: 'The uploaded APK was empty.' });
      return reply.code(400).send('empty');
    }
    await updateBuild(id, { status: 'success', phase: 'done', artifact_path: dest, size_bytes: size });
    return { ok: true };
  });

  app.post('/api/builds/:id/fail', async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = await getBuild(id);
    if (!b || !tokenOk(b.token, (req.query as any)?.token)) return reply.code(404).send('not found');
    let log = '';
    try {
      log = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? '');
    } catch { /* ignore */ }
    const tail = log.slice(-1500).trim();
    await updateBuild(id, { status: 'error', phase: 'build failed', error: tail || 'The build failed on the build machine.' });
    return { ok: true };
  });
}

/** Public view (never leak the one-time token or absolute filesystem path). */
function pub(b: Awaited<ReturnType<typeof getBuild>>) {
  if (!b) return null;
  return {
    id: b.id,
    platform: b.platform,
    appName: b.app_name,
    status: b.status,
    phase: b.phase,
    sizeBytes: b.size_bytes,
    cost: b.cost,
    error: b.error,
    createdAt: b.created_at,
    updatedAt: b.updated_at,
    downloadUrl: b.status === 'success' ? `/api/builds/${b.id}/download` : null,
  };
}
