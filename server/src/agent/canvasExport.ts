import fs from 'node:fs';
import path from 'node:path';
import { execBash } from '../lib/exec';
import { detectStartCommand } from './verify';
import { processRegistry } from './processes';

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
 * Leave a preview server running so the canvas can render the result. Apps boot
 * with their start command (PORT defaults to 4000 via childEnv); static sites
 * get a lightweight Python file server on 4000. Best-effort; never throws.
 * Returns the port to preview, or null.
 */
export function startPreviewServer(sessionId: string, dir: string, r: Renderable): number | null {
  try {
    processRegistry.killAllForSession(sessionId);
    if (r.startCmd) {
      processRegistry.start(sessionId, r.startCmd, dir, 'preview');
      return 4000;
    }
    if (r.staticDir) {
      const serveDir = path.join(dir, r.staticDir);
      processRegistry.start(sessionId, 'python3 -m http.server 4000 --bind 0.0.0.0', serveDir, 'preview');
      return 4000;
    }
  } catch {
    /* preview is a convenience — a failure here must not fail the run */
  }
  return null;
}
