import fs from 'node:fs';
import path from 'node:path';
import { execBash } from '../lib/exec';
import { detectStartCommand } from './verify';
import { processRegistry } from './processes';
import { config } from '../config';
import { previewRegistry } from '../sandbox/previewRegistry';

export interface Renderable {
  /** Can this be shown in the canvas preview (a web app or static HTML)? */
  renderable: boolean;
  /** Command to boot it as a server, if it's a runnable app. */
  startCmd: string | null;
  /** Sub-directory containing index.html to serve statically (no server needed). */
  staticDir: string | null;
}

const STATIC_CANDIDATES = ['.', 'public', 'dist', 'build', 'site', 'out', 'www', 'src'];
const PROJECT_MARKERS = ['package.json', 'go.mod', 'Cargo.toml', 'requirements.txt', 'pyproject.toml', 'index.html'];

/** Does the workspace contain a recognizable project worth exporting? */
export function looksLikeProject(dir: string): boolean {
  if (PROJECT_MARKERS.some((m) => fs.existsSync(path.join(dir, m)))) return true;
  // any python/js entrypoint at the root
  try {
    return fs.readdirSync(dir).some((f) => /\.(py|js|ts|html)$/i.test(f));
  } catch {
    return false;
  }
}

/** Decide whether the result can be rendered in the canvas, and how to serve it. */
export function detectRenderable(dir: string): Renderable {
  const startCmd = detectStartCommand(dir);
  if (startCmd) return { renderable: true, startCmd, staticDir: null };
  for (const c of STATIC_CANDIDATES) {
    if (fs.existsSync(path.join(dir, c, 'index.html'))) {
      return { renderable: true, startCmd: null, staticDir: c };
    }
  }
  // A static report/site often lands in a named subdir (e.g. ielts-report/).
  // Scan one level deep so the canvas still finds it.
  try {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!ent.isDirectory() || ent.name.startsWith('.') || ent.name === 'node_modules') continue;
      if (fs.existsSync(path.join(dir, ent.name, 'index.html'))) {
        return { renderable: true, startCmd: null, staticDir: ent.name };
      }
    }
  } catch {}
  return { renderable: false, startCmd: null, staticDir: null };
}

const EXCLUDES = [
  'node_modules/*',
  '.git/*',
  'venv/*',
  '.venv/*',
  '__pycache__/*',
  '*.pyc',
  '.next/*',
  '.cache/*',
  'logs/*',
  '*.log',
];

/**
 * Zip the whole workspace into `<name>-export.zip` at its root so it gets
 * surfaced as a download chip. Falls back to .tar.gz if `zip` isn't available.
 * Returns the archive's path relative to the workspace, or null on failure.
 */
export async function buildExportArchive(
  dir: string,
  baseName: string,
  signal: AbortSignal,
): Promise<string | null> {
  const safe = (baseName || 'arksai').replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 40) || 'arksai';
  const zipName = `${safe}-export.zip`;
  // Drop any stale archive so the new one is a clean snapshot (zip would append).
  for (const n of [zipName, `${safe}-export.tar.gz`]) {
    try {
      fs.rmSync(path.join(dir, n));
    } catch {}
  }

  const zipEx = EXCLUDES.concat(zipName).map((e) => `'${e}'`).join(' ');
  await execBash(`zip -r -q ${JSON.stringify(zipName)} . -x ${zipEx}`, {
    cwd: dir,
    timeoutMs: 90_000,
    signal,
  }).catch(() => null);
  if (fs.existsSync(path.join(dir, zipName))) return zipName;

  // Fallback: tar.gz (gzip/tar are present in any base image).
  const tgz = `${safe}-export.tar.gz`;
  const tarEx = EXCLUDES.concat(tgz).map((e) => `--exclude=${JSON.stringify(e.replace(/\/\*$/, ''))}`).join(' ');
  await execBash(`tar ${tarEx} -czf ${JSON.stringify(tgz)} .`, {
    cwd: dir,
    timeoutMs: 90_000,
    signal,
  }).catch(() => null);
  return fs.existsSync(path.join(dir, tgz)) ? tgz : null;
}

/**
 * Detect a build-to-static FRONTEND (Vite/CRA/Astro/Vue/Angular/Parcel/Gatsby) — apps that
 * compile to a folder of static files. For these, the in-canvas preview builds + serves the
 * static OUTPUT (reliable through the preview proxy) instead of the dev server (whose absolute
 * module paths + HMR websocket don't survive a path-based proxy). SSR frameworks (Next/Nuxt/
 * SvelteKit/Remix) need their own running server, so they're excluded → they use the start cmd.
 */
export function detectFrontendBuild(dir: string): { outDir: string } | null {
  const pkgPath = path.join(dir, 'package.json');
  if (!fs.existsSync(pkgPath)) return null;
  let pkg: any;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  } catch {
    return null;
  }
  if (!pkg?.scripts?.build) return null;
  const deps: Record<string, string> = { ...pkg.dependencies, ...pkg.devDependencies };
  const dep = (n: string) => Object.prototype.hasOwnProperty.call(deps, n);
  // SSR frameworks serve themselves — don't static-serve them.
  if (['next', 'nuxt', '@sveltejs/kit', '@remix-run/dev', '@remix-run/serve'].some(dep)) return null;
  const viteCfg = fs.existsSync(path.join(dir, 'vite.config.ts')) || fs.existsSync(path.join(dir, 'vite.config.js'));
  if (dep('react-scripts')) return { outDir: 'build' };
  if (dep('gatsby')) return { outDir: 'public' };
  if (dep('vite') || viteCfg || dep('astro') || dep('parcel') || dep('@vue/cli-service') || dep('@angular/cli') || dep('@angular-devkit/build-angular')) {
    return { outDir: 'dist' };
  }
  return null;
}

/**
 * Leave a preview server running so the canvas can render the result. Apps boot
 * with their start command (PORT defaults to 4000 via childEnv); static sites
 * get a lightweight Python file server on 4000; a build-to-static frontend
 * (Vite/React/…) is BUILT then served statically (so it renders reliably in the
 * in-canvas proxy by default — easiest for the user). Best-effort; never throws.
 * Returns the port to preview, or null.
 */
export function startPreviewServer(sessionId: string, dir: string, r: Renderable): number | null {
  try {
    processRegistry.killAllForSession(sessionId);
    // One unique, recorded port per session (kills the canvas port race). Legacy fixed-4000
    // remains available via PREVIEW_PORT_ALLOC=0 for rollback.
    const port = config.previewPortAlloc ? previewRegistry.allocPort(sessionId) : 4000;
    // Build-to-static frontend → build (if needed) then serve the static output. This is the
    // default because the static build renders reliably through the canvas proxy, whereas a
    // dev server's absolute module paths + HMR websocket do not.
    const fe = r.startCmd ? detectFrontendBuild(dir) : null;
    // FULL-STACK single service (a Vite frontend AND a node server that serves the built
    // output + an API, e.g. create_react_app backend:true → `npm start`): build the frontend,
    // then run the SERVER. Don't serve dist/ via a python static server — that 404s the API in
    // the preview AND collides with the app's own :4000 server (a real over-iteration trap).
    const serverStart = !!r.startCmd && /\bnpm (run )?start\b|\bnode\b/i.test(r.startCmd);
    if (fe && serverStart) {
      const out = fe.outDir;
      const cmd =
        `if [ ! -d "${out}" ] || [ -z "$(ls -A "${out}" 2>/dev/null)" ]; then ` +
        `(test -d node_modules || npm install --no-audit --no-fund --loglevel=error) && npm run build; fi; ` +
        `exec ${r.startCmd}`;
      processRegistry.start(sessionId, cmd, dir, 'preview');
      return 4000;
    }
    if (fe) {
      const out = fe.outDir;
      const cmd =
        `if [ ! -d "${out}" ] || [ -z "$(ls -A "${out}" 2>/dev/null)" ]; then ` +
        `(test -d node_modules || npm install --no-audit --no-fund --loglevel=error) && npm run build; fi; ` +
        `if [ -d "${out}" ]; then cd "${out}"; fi; ` +
        `exec python3 -m http.server ${port} --bind 0.0.0.0`;
      processRegistry.start(sessionId, cmd, dir, 'preview');
      return port;
    }
    if (r.startCmd) {
      // The app reads PORT from its env — hand it the allocated port (childEnv default is 4000).
      processRegistry.start(sessionId, r.startCmd, dir, 'preview', { PORT: String(port) });
      return port;
    }
    if (r.staticDir) {
      const serveDir = path.join(dir, r.staticDir);
      processRegistry.start(sessionId, `python3 -m http.server ${port} --bind 0.0.0.0`, serveDir, 'preview');
      return port;
    }
  } catch {
    /* preview is a convenience — a failure here must not fail the run */
  }
  return null;
}
