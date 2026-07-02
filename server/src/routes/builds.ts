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
  latestBuildByPlatform,
} from '../build/store';
import {
  startAndroidBuild,
  isBuildConfigured,
  sourceTarPath,
  apkPath,
} from '../build/androidBuild';
import { setBuildToken, setSnapshotId, doToken, snapshotId } from '../build/runtime';
import { setByteplusKey, byteplusConfigured } from '../agent/byteplusRuntime';
import { startBake } from '../build/bake';
import { config } from '../config';

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

  // ---- Operator only: configure the DO token, bake the build machine, check status ----

  app.post('/api/admin/build/configure', async (req, reply) => {
    if (!req.identity?.isSuperadmin) return reply.code(403).send({ error: 'Forbidden' });
    const body = (req.body as any) || {};
    const token = String(body.doToken || '').trim();
    const snap = String(body.snapshotId || '').trim();
    if (token) {
      if (!token.startsWith('dop_v1_')) return reply.code(400).send({ error: 'Provide a DigitalOcean API token (dop_v1_…).' });
      await setBuildToken(token);
    }
    // Set/recover the baked snapshot id directly (e.g. activate with an existing snapshot).
    if (snap) {
      if (!/^\d+$/.test(snap)) return reply.code(400).send({ error: 'snapshotId must be a numeric DO image id.' });
      await setSnapshotId(snap);
    }
    if (!token && !snap) return reply.code(400).send({ error: 'Provide doToken and/or snapshotId.' });
    return { ok: true, hasToken: !!doToken(), snapshotId: snapshotId() || null, configured: isBuildConfigured() };
  });

  // Operator only: activate the BytePlus/Dola fast lane ("ArksAI Swift") by storing the ark key
  // (encrypted at rest, no SSH/redeploy). Once set, light-tier code builds route to Swift.
  app.post('/api/admin/providers/byteplus', async (req, reply) => {
    if (!req.identity?.isSuperadmin) return reply.code(403).send({ error: 'Forbidden' });
    const key = String((req.body as any)?.key || '').trim();
    if (!key.startsWith('ark-')) return reply.code(400).send({ error: 'Provide a BytePlus ark key (ark-…).' });
    await setByteplusKey(key);
    return { ok: true, configured: byteplusConfigured() };
  });

  // Operator only: rotate the DigitalOcean API token (encrypted at rest, no SSH/redeploy). Used by
  // the build orchestrator; the master ArksAI droplet is hard-protected from any destructive op.
  app.post('/api/admin/providers/do', async (req, reply) => {
    if (!req.identity?.isSuperadmin) return reply.code(403).send({ error: 'Forbidden' });
    const t = String((req.body as any)?.token || '').trim();
    if (!t.startsWith('dop_v1_')) return reply.code(400).send({ error: 'Provide a DigitalOcean API token (dop_v1_…).' });
    await setBuildToken(t);
    return { ok: true, configured: !!doToken() };
  });

  // Operator only: read the configured-status of platform provider keys (NO secret values) +
  // the protected master droplet, so the admin UI can show what's set and what's locked.
  app.get('/api/admin/providers', async (req, reply) => {
    if (!req.identity?.isSuperadmin) return reply.code(403).send({ error: 'Forbidden' });
    return {
      byteplus: { label: 'ArksAI Swift (BytePlus/Dola)', configured: byteplusConfigured() },
      digitalocean: { label: 'DigitalOcean API', configured: !!doToken() },
      protected: { masterDropletId: config.masterDropletId, masterDropletName: config.masterDropletName },
    };
  });

  app.post('/api/admin/build/bake', async (req, reply) => {
    if (!req.identity?.isSuperadmin) return reply.code(403).send({ error: 'Forbidden' });
    if (!doToken()) return reply.code(400).send({ error: 'Configure the DO token first (POST /api/admin/build/configure).' });
    const { id } = await startBake();
    return reply.code(201).send({ id });
  });

  app.get('/api/admin/build/state', async (req, reply) => {
    if (!req.identity?.isSuperadmin) return reply.code(403).send({ error: 'Forbidden' });
    const bake = await latestBuildByPlatform('bake');
    return {
      configured: isBuildConfigured(),
      hasToken: !!doToken(),
      snapshotId: snapshotId() || null,
      bake: bake ? { id: bake.id, status: bake.status, phase: bake.phase, error: bake.error, updatedAt: bake.updated_at } : null,
    };
  });

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

  // Neutral log sink for the bake droplet (does NOT change status — runBake owns that;
  // it polls this log for the RESULT=OK/FAIL marker). Distinct from /fail, which is for
  // an APK build that genuinely failed.
  app.post('/api/builds/:id/bakelog', async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = await getBuild(id);
    if (!b || !tokenOk(b.token, (req.query as any)?.token)) return reply.code(404).send('not found');
    let log = '';
    try {
      log = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? '');
    } catch { /* ignore */ }
    await updateBuild(id, { error: log.slice(-6000).trim() }); // store log only; keep status
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
    const tail = log.slice(-6000).trim();
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
