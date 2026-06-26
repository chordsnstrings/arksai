import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execBash } from '../lib/exec';
import { listeningPorts } from '../lib/ports';
import { detectStartCommand } from '../agent/verify';
import { detectDbKind, provisionAppDatabase } from './dbProvision';
import { browserSmokeTest } from '../agent/uiCheck';
import { config } from '../config';
import { repoDir } from '../sessions/workspace';
import * as store from '../sessions/store';
import { deploymentRegistry, deploymentDir, deploymentsRoot } from './registry';
import type { Deployment, DeploymentKind } from '../../../shared/types';

/** A published deployment plus the result of smoke-testing its live public URL. */
export type PublishResult = Deployment & { verifyDetail?: string; verifyOk?: boolean };

// 24-HOUR PREVIEW MODEL: every publish is an ephemeral preview that auto-deletes
// after 24h (the single-Droplet constraint; lifted later on a bigger server).
export const PREVIEW_TTL_MS = 24 * 60 * 60 * 1000;
const JANITOR_MS = 5 * 60 * 1000; // sweep cadence

function slugify(name: string): string {
  let s = (name || 'app')
    .toLowerCase()
    // strip leading instruction filler so a title like "Code task: create a … app" → "app"
    .replace(/^\s*code task:?\s*/, '')
    .replace(/^\s*(please\s+)?(create|build|make|design|generate|write)\s+(me\s+)?(a|an|the)?\s*/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  // cap to the first few words so the public URL stays short and readable
  s = s.split('-').filter(Boolean).slice(0, 5).join('-').slice(0, 40);
  return s || 'app';
}

/**
 * A built single-page-app framework (Vite/CRA/Vue-CLI/Parcel/Angular) → we BUILD it and
 * static-serve the output, NEVER run its dev server (Vite ignores PORT and binds 5173, so
 * `npm run dev` under our port allocator 502s). Returns null for a real runtime server
 * (Express/Next/Nuxt/Nest/etc.) — those keep the run-a-process path.
 */
export function detectSpaBuild(dir: string): { build: string } | null {
  const pkgPath = path.join(dir, 'package.json');
  if (!fs.existsSync(pkgPath)) return null;
  let pkg: any;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  } catch {
    return null;
  }
  if (!pkg?.scripts?.build) return null;
  const names = Object.keys({ ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) });
  // A runtime server must keep running — never static-build it.
  if (names.some((n) => /^(next|nuxt|@nestjs\/|express|fastify|koa|@remix-run\/|@sveltejs\/kit|h3|hono)/.test(n))) return null;
  const isSpaDep = names.some((n) =>
    /^(vite|react-scripts|@vue\/cli-service|parcel|@angular\/cli|@craco\/craco|@parcel\/core)$/.test(n),
  );
  // Also catch a Vite/CRA/Parcel app by its config file or build-script command, since the
  // dep can land in either deps/devDeps under varied names — so SPAs reliably build→static
  // instead of slipping to the dev-server path.
  const hasViteConfig = ['vite.config.js', 'vite.config.ts', 'vite.config.mjs'].some((f) => fs.existsSync(path.join(dir, f)));
  const scriptsBlob = JSON.stringify(pkg.scripts ?? {});
  const isSpaScript = /\b(vite build|react-scripts build|parcel build|vue-cli-service build|ng build)\b/.test(scriptsBlob);
  return isSpaDep || hasViteConfig || isSpaScript ? { build: 'npm run build' } : null;
}

/**
 * Make a database-backed app's DB actually exist at deploy time. For a SELF-CONTAINED SQLite app
 * SQLite ships as a file with the app (zero infra). A real server DB (Postgres) is PROVISIONED —
 * `provisionAppDatabase` creates an isolated per-app database and we inject its connection string —
 * so "any database" works live. The app's schema/migrations are then applied. Returns an error
 * string only when the app needs a DB we can't yet provision (so the agent can switch to one we can).
 */
export async function setupDatabase(dest: string, slug: string): Promise<{ ok: boolean; error?: string }> {
  const schemaCandidates = ['prisma/schema.prisma', 'schema.prisma', 'prisma/schema.sqlite.prisma'];
  const schemaRel = schemaCandidates.find((s) => fs.existsSync(path.join(dest, s)));
  let provider: string | null = null;
  if (schemaRel) {
    try {
      provider = (fs.readFileSync(path.join(dest, schemaRel), 'utf8').match(/provider\s*=\s*"(\w+)"/) || [])[1] || null;
    } catch {
      /* ignore */
    }
  }
  const pkgRaw = (() => {
    try {
      return fs.readFileSync(path.join(dest, 'package.json'), 'utf8');
    } catch {
      return null;
    }
  })();
  const kind = detectDbKind(pkgRaw, provider);

  // Resolve the connection string. SQLite → a file shipped with the app. A real DB → provision it.
  let dbUrl = 'file:./prod.db';
  if (kind !== 'sqlite' && kind !== 'none') {
    const prov = await provisionAppDatabase(slug, kind);
    if (!prov.ok) return { ok: false, error: prov.error };
    if (prov.connectionString) dbUrl = prov.connectionString;
  }
  if (kind === 'none' && !schemaRel) return { ok: true }; // no DB at all → nothing to do

  // Inject the connection string into the app's .env (registry.start loads it into the live process,
  // and Prisma/Next read it directly). Replace an existing DATABASE_URL so it points at the real DB.
  upsertEnv(dest, 'DATABASE_URL', dbUrl);

  // Apply the schema. Prisma → generate + migrate deploy (fallback db push) + seed. A non-Prisma app
  // (better-sqlite3, pg, …) creates/uses its tables itself at runtime, so nothing to apply here.
  if (schemaRel) {
    const sx = `--schema=${JSON.stringify(schemaRel)}`;
    await execBash(`npx --yes prisma generate ${sx}`, { cwd: dest, timeoutMs: 180_000 }).catch(() => null);
    const migrated = await execBash(`npx --yes prisma migrate deploy ${sx}`, { cwd: dest, timeoutMs: 180_000 }).catch(() => null);
    if (!migrated?.ok) {
      await execBash(`npx --yes prisma db push --skip-generate --accept-data-loss ${sx}`, { cwd: dest, timeoutMs: 180_000 }).catch(() => null);
    }
    await execBash('npx --yes prisma db seed', { cwd: dest, timeoutMs: 120_000 }).catch(() => null);
  }
  return { ok: true };
}

/** Write or replace a key in the app's .env (so a re-publish re-points it at the real database). */
function upsertEnv(dest: string, key: string, value: string): void {
  const envPath = path.join(dest, '.env');
  let env = '';
  try {
    env = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  } catch {
    /* ignore */
  }
  const line = `${key}="${value}"`;
  const re = new RegExp(`^\\s*${key}\\s*=.*$`, 'm');
  const next = re.test(env) ? env.replace(re, line) : `${env}${env && !env.endsWith('\n') ? '\n' : ''}${line}\n`;
  try {
    fs.writeFileSync(envPath, next);
  } catch {
    /* best effort */
  }
}

/** Where a SPA build dropped its output (first dir that actually has an index.html). */
const SPA_OUT_DIRS = ['dist', 'build', 'out', 'public'];
function findBuildOutput(dest: string): string | null {
  return SPA_OUT_DIRS.find((d) => fs.existsSync(path.join(dest, d, 'index.html'))) ?? null;
}

const APP_MARKERS = [
  'package.json', 'index.html', 'server.js', 'app.js', 'main.js', 'main.py', 'app.py', 'server.py', 'wsgi.py', 'requirements.txt', 'go.mod',
];
function hasAppMarker(dir: string): boolean {
  return APP_MARKERS.some((f) => fs.existsSync(path.join(dir, f)));
}

/**
 * Agents frequently build the app in a SUBDIRECTORY (todo-app/, client/, frontend/, app/)
 * rather than the workspace root — in which case publishing the root serves an empty dir →
 * 404 (the "publish is broken" the agent then hallucinates about). Find the real app root:
 * the workspace root if it has app markers, else the shallowest subdir (≤2 levels) that does.
 */
export function findAppRoot(dest: string): string {
  if (hasAppMarker(dest)) return dest;
  const skip = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'out', 'uploads', '.cache', '__pycache__']);
  let level = [dest];
  for (let depth = 0; depth < 2; depth++) {
    const next: string[] = [];
    for (const d of level) {
      let subs: string[] = [];
      try {
        subs = fs
          .readdirSync(d, { withFileTypes: true })
          .filter((e) => e.isDirectory() && !skip.has(e.name))
          .map((e) => path.join(d, e.name));
      } catch {}
      for (const s of subs) if (hasAppMarker(s)) return s;
      next.push(...subs);
    }
    level = next;
  }
  return dest;
}

async function uniqueSlug(base: string): Promise<string> {
  let s = base;
  let n = 1;
  while (await store.getDeploymentBySlug(s)) {
    n++;
    s = `${base}-${n}`;
  }
  return s;
}

/** Snapshot a session's built app into a durable dir and serve/run it at a slug URL. */
export async function publishSession(sessionId: string, name?: string): Promise<PublishResult> {
  const session = await store.getSession(sessionId);
  if (!session) throw new Error('session not found');
  const src = repoDir(sessionId);
  if (!fs.existsSync(src)) throw new Error('no workspace to publish');

  // Supersede any prior deployment(s) for this session — kill + remove them — so
  // re-publishes (including verification retries) don't pile up errored/duplicate
  // slugs, and the public URL stays stable instead of drifting to -2/-3.
  try {
    const prior = (await store.listDeployments()).filter((d) => d.sessionId === sessionId);
    for (const d of prior) {
      deploymentRegistry.kill(d.slug);
      await store.deleteDeployment(d.slug);
      try {
        fs.rmSync(deploymentDir(d.slug), { recursive: true, force: true });
      } catch {}
    }
  } catch {}

  const appName = String(name || session.repoName || session.title || 'app');
  const slug = await uniqueSlug(slugify(appName));
  const dest = deploymentDir(slug);
  fs.mkdirSync(dest, { recursive: true });

  // Durable snapshot (exclude node_modules/.git — deps are (re)installed below).
  const snap = await execBash(
    `tar -C ${JSON.stringify(src)} --exclude=node_modules --exclude=.git -cf - . | tar -C ${JSON.stringify(dest)} -xf -`,
    { cwd: src, timeoutMs: 120_000 },
  );
  if (!snap.ok) throw new Error(`snapshot failed: ${snap.output.slice(-300)}`);

  // If the app actually lives in a subdir (todo-app/, client/, …), RE-ROOT the snapshot so
  // build/run/serve all work from `dest` — otherwise we'd serve an empty root and 404.
  const appRoot = findAppRoot(dest);
  if (appRoot !== dest) {
    const tmp = `${dest}.approot`;
    const q = (s: string) => JSON.stringify(s);
    const r = await execBash(
      `rm -rf ${q(tmp)} && cp -a ${q(appRoot)} ${q(tmp)} && rm -rf ${q(dest)} && mv ${q(tmp)} ${q(dest)}`,
      { cwd: deploymentsRoot(), timeoutMs: 60_000 },
    ).catch(() => null);
    if (!r?.ok) console.warn(`[deploy] re-root from ${path.relative(dest, appRoot)} failed for ${slug}`);
  }

  let kind: DeploymentKind = 'static';
  let port: number | null = null;
  let status: Deployment['status'] = 'running';
  let staticDir: string | null = null;
  let buildError: string | undefined; // surfaced to the agent so a failed publish says WHY

  const spa = detectSpaBuild(dest);
  const startCmd = spa ? null : detectStartCommand(dest);

  if (spa) {
    // BUILD the SPA (needs devDeps → full install), then static-serve its output. This is
    // the most common ArksAI output (React/Vite); running its dev server under the proxy 502s.
    const install = fs.existsSync(path.join(dest, 'package-lock.json'))
      ? 'npm ci --no-audit --no-fund'
      : 'npm install --no-audit --no-fund';
    const inst = await execBash(install, { cwd: dest, timeoutMs: 300_000 }).catch(() => null);
    const built = await execBash(spa.build, { cwd: dest, timeoutMs: 300_000 }).catch(() => null);
    const out = findBuildOutput(dest);
    if (built?.ok && out) {
      kind = 'static';
      staticDir = out; // serve the built dist/ as static files
      // Reclaim disk: a static SPA only needs its built output, not the ~hundreds-of-MB
      // node_modules / source. (Disk is the Droplet's real constraint, not RAM.)
      await execBash(`rm -rf ${JSON.stringify(path.join(dest, 'node_modules'))}`, { cwd: dest, timeoutMs: 60_000 }).catch(() => null);
    } else {
      status = 'error'; // build failed or produced no index.html — better an honest error than a broken dev-server link
      kind = 'static';
      const tail = (s?: string) => String(s ?? '').slice(-700).trim();
      buildError = !built?.ok
        ? `The app's production build failed (\`npm run build\`). Read this error, fix it in the app, and republish:\n\n${tail(built?.output) || tail(inst?.output) || '(no output captured)'}`
        : `The build ran but produced no index.html in dist/ (or build/out/public). Make the build output a static site (a Vite/CRA build should write dist/index.html).`;
      console.warn(`[deploy] SPA build failed for ${slug}: ${tail(built?.output) || tail(inst?.output)}`);
    }
  } else if (startCmd) {
    kind = /python|wsgi/.test(startCmd) ? 'python' : 'node';
    if (kind === 'node' && fs.existsSync(path.join(dest, 'package.json'))) {
      // Install WITH devDeps — build toolchains (next/vite/astro/tailwind/tsc) live there.
      // (childEnv defaults the workspace to development; --prefer-offline hits the warm cache.)
      const hasLock = fs.existsSync(path.join(dest, 'package-lock.json'));
      const inst = await execBash(
        hasLock ? 'npm ci --no-audit --no-fund --prefer-offline' : 'npm install --no-audit --no-fund --prefer-offline',
        { cwd: dest, timeoutMs: 300_000 },
      ).catch(() => null);
      // Provision the database (SQLite file + schema/migrations) BEFORE the build — a Prisma app's
      // build/runtime needs the generated client + an applied schema, or it ships broken. A
      // server-DB app (Postgres/Mongo) is rejected with guidance to use self-contained SQLite.
      const db = await setupDatabase(dest, slug);
      if (!db.ok) {
        status = 'error';
        buildError = db.error;
        console.warn(`[deploy] db setup failed for ${slug}: ${db.error}`);
      }
      // Run the production build if the app defines one — a `node` app with a build step
      // (Next/Vite/Astro/SvelteKit/…) ships its BUILT output, not raw source. The old flow
      // installed prod-only and never built → "Could not find a production build".
      let pkg: any = {};
      try {
        pkg = JSON.parse(fs.readFileSync(path.join(dest, 'package.json'), 'utf8'));
      } catch {}
      if (status !== 'error' && pkg?.scripts?.build) {
        const built = await execBash('npm run build', { cwd: dest, timeoutMs: 420_000 }).catch(() => null);
        const tail = (s?: string) => String(s ?? '').slice(-700).trim();
        if (!built?.ok) {
          status = 'error';
          buildError = `The app's production build failed (\`npm run build\`). Read this error, fix it in the app, and republish:\n\n${tail(built?.output) || tail(inst?.output) || '(no output captured)'}`;
          console.warn(`[deploy] node build failed for ${slug}: ${tail(built?.output) || tail(inst?.output)}`);
        } else {
          // Reclaim disk: drop devDeps now the build is done (runtime needs prod deps + built output).
          await execBash('npm prune --omit=dev --no-audit --no-fund', { cwd: dest, timeoutMs: 120_000 }).catch(() => null);
        }
      }
    } else if (kind === 'python' && fs.existsSync(path.join(dest, 'requirements.txt'))) {
      await execBash('python3 -m pip install -r requirements.txt', { cwd: dest, timeoutMs: 300_000 }).catch(() => null);
    }
    // Only boot the server if the build didn't fail (a broken build → honest error, not a dead link).
    if (status !== 'error') {
      port = deploymentRegistry.allocPort();
      deploymentRegistry.start(slug, dest, startCmd, port);
      // Wait for it to bind its port.
      const deadline = Date.now() + 15_000;
      let bound = false;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 500));
        if (listeningPorts().includes(port)) {
          bound = true;
          break;
        }
      }
      if (!bound) status = 'error';
    }
  }

  const dep = await store.createDeployment({
    id: randomUUID(),
    sessionId,
    projectId: session.projectId,
    slug,
    name: appName.slice(0, 80),
    kind,
    status,
    url: `/apps/${slug}/`,
    port,
    orgId: session.orgId, // inherit the publishing session's org → scoped, manageable
    expiresAt: Date.now() + PREVIEW_TTL_MS, // 24h preview — the janitor deletes it after
    staticDir, // a built SPA serves from its dist/ subdir
  });

  // POST-PUBLISH verification — smoke-test the REAL public URL the user will
  // open (`/apps/<slug>/`, served by this same server), so they never get a
  // broken link. On a hard failure mark it errored and hand the defect back to
  // the agent to fix + republish. Bounded + best-effort (degrades to a pass if
  // Playwright/Chromium is unavailable, e.g. in a bare sandbox).
  let verifyDetail: string | undefined = buildError; // a failed SPA build → hand the build error back to the agent
  let verifyOk = !buildError;
  if (status !== 'error') {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 30_000);
    try {
      const ui = await browserSmokeTest(`http://127.0.0.1:${config.port}/apps/${slug}/`, ac.signal);
      if (ui.ran && ui.hardFail) {
        verifyOk = false;
        await store.updateDeployment(slug, { status: 'error' });
        dep.status = 'error';
        verifyDetail = ui.detail;
      } else if (ui.ran) {
        verifyDetail = 'Post-publish check: the live URL renders cleanly in a headless browser.';
      }
    } catch {
      /* never block a publish on the checker itself */
    } finally {
      clearTimeout(timer);
    }
  }

  return Object.assign(dep, { verifyDetail, verifyOk });
}

export async function stopDeployment(slug: string) {
  deploymentRegistry.kill(slug);
  await store.updateDeployment(slug, { status: 'stopped' });
}

export async function restartDeployment(slug: string) {
  const d = await store.getDeploymentBySlug(slug);
  if (!d) return;
  if (d.kind !== 'static' && d.port != null) {
    const sc = detectStartCommand(deploymentDir(slug));
    if (sc) deploymentRegistry.start(slug, deploymentDir(slug), sc, d.port);
  }
  await store.updateDeployment(slug, { status: 'running' });
}

export async function removeDeployment(slug: string) {
  deploymentRegistry.kill(slug);
  await store.deleteDeployment(slug);
  try {
    fs.rmSync(deploymentDir(slug), { recursive: true, force: true });
  } catch {}
}

// ---- 24h-preview auto-cleanup (the janitor) ----

/** Hard-delete every preview whose 24h window has closed (process + files + row). */
export async function sweepExpiredDeployments(now = Date.now()): Promise<number> {
  const deps = await store.listDeployments().catch(() => []);
  let n = 0;
  for (const d of deps) {
    if (d.expiresAt != null && d.expiresAt <= now) {
      await removeDeployment(d.slug).catch(() => {});
      n++;
    }
  }
  if (n) console.log(`[deploy] swept ${n} expired preview(s)`);
  return n;
}

let janitorTimer: ReturnType<typeof setInterval> | null = null;

/** Start the durable preview janitor (call once at boot). */
export function startDeploymentJanitor() {
  if (janitorTimer) return;
  janitorTimer = setInterval(() => void sweepExpiredDeployments(), JANITOR_MS);
  setTimeout(() => void sweepExpiredDeployments(), 10_000); // once shortly after boot
  console.log('[deploy] preview janitor started (24h TTL)');
}

/**
 * Self-healing: restart any server-app deployment that should be running but whose process
 * is dead (boot recovery that crashed, an OOM, a process killed by an agent run, …). Without
 * this a published backend can silently vanish after a deploy/restart — which broke the
 * Android "live backend" promise. Process-aliveness via the registry is the signal.
 */
export async function sweepDeadDeployments(): Promise<number> {
  const deps = await store.listDeployments().catch(() => []);
  let healed = 0;
  for (const d of deps) {
    if (d.kind === 'static' || d.status !== 'running' || d.port == null) continue;
    if (d.expiresAt != null && d.expiresAt <= Date.now()) continue; // expiring preview
    if (deploymentRegistry.isRunning(d.slug)) continue; // alive — nothing to do
    const dir = deploymentDir(d.slug);
    if (!fs.existsSync(dir)) {
      await store.updateDeployment(d.slug, { status: 'error' }).catch(() => {});
      continue;
    }
    const sc = detectStartCommand(dir);
    if (!sc) continue;
    try {
      deploymentRegistry.start(d.slug, dir, sc, d.port);
      healed++;
      console.log(`[deploy] self-healed dead deployment "${d.slug}" on :${d.port}`);
    } catch (e: any) {
      console.warn(`[deploy] could not restart "${d.slug}":`, e?.message ?? e);
    }
  }
  return healed;
}

let healthTimer: ReturnType<typeof setInterval> | null = null;
const DEPLOY_HEALTH_MS = Number(process.env.DEPLOY_HEALTH_MS || '60000') || 60_000;

/** Start the deployment health monitor (call once at boot, after recoverDeployments). */
export function startDeploymentHealthMonitor() {
  if (healthTimer) return;
  healthTimer = setInterval(() => void sweepDeadDeployments(), DEPLOY_HEALTH_MS);
  // A first pass ~30s after boot catches anything recoverDeployments failed to bring up.
  setTimeout(() => void sweepDeadDeployments(), 30_000);
  console.log(`[deploy] health monitor started (every ${Math.round(DEPLOY_HEALTH_MS / 1000)}s)`);
}
