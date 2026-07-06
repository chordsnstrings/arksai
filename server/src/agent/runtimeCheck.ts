import fs from 'node:fs';
import path from 'node:path';
import { execBash } from '../lib/exec';
import { listeningPorts } from '../lib/ports';
import { processRegistry } from './processes';
import { browserSmokeTest, WIREFRAME_RUBRIC_PROMPT, type UiCheckResult, type VerifyManifest } from './uiCheck';

/** The scaffold-declared verification manifest, when the workspace has one. */
export function readVerifyManifest(dir: string): VerifyManifest | null {
  try {
    const raw = fs.readFileSync(path.join(dir, '.arksai', 'verify.json'), 'utf8');
    const m = JSON.parse(raw);
    return m && typeof m === 'object' ? (m as VerifyManifest) : null;
  } catch {
    return null;
  }
}

/**
 * If the agent locked a bespoke design direction (design_direction → design-direction.json),
 * surface its concept + signature to the design critique so it can judge CONCEPT FIDELITY, not
 * just generic competence. Checks the served dir and one level up (a static subfolder build).
 */
function readDesignBrief(dir: string): string | undefined {
  for (const d of [dir, path.dirname(dir)]) {
    try {
      const raw = fs.readFileSync(path.join(d, 'design-direction.json'), 'utf8');
      const b = JSON.parse(raw);
      if (b && typeof b.concept === 'string') {
        const parts = [`concept "${b.concept}"`];
        if (b.signature) parts.push(`signature: ${b.signature}`);
        if (b.type?.display?.family && b.type?.body?.family) {
          parts.push(`type ${b.type.display.family}/${b.type.body.family}${b.type?.data?.family ? `/${b.type.data.family}` : ''}`);
        }
        return parts.join('; ').slice(0, 320);
      }
    } catch {
      /* no brief here — fall through */
    }
  }
  return undefined;
}

export interface ProbeCheck {
  method: string;
  path: string;
  code: number | null;
  note: string;
}
export interface ProbeReport {
  booted: boolean;
  port: number | null;
  baseCode: number | null;
  checks: ProbeCheck[];
  serverErrors: number; // count of 5xx / crashes
  roundTrip: boolean; // a create -> read-back succeeded
  routesFound: number;
  ui: UiCheckResult | null; // headless-browser UI render check (HTML apps only)
  detail: string;
}

const BOOT_WAIT_MS = 20_000;
const MAX_ROUTES = 14;
const MARKER = 'ArksAIVerifyZ9';
// Broad seed payload covering common CRUD field names.
const SEED = JSON.stringify({
  name: MARKER,
  title: MARKER,
  description: 'arksai verification',
  text: MARKER,
  content: MARKER,
  message: MARKER,
  email: 'verify@arksai.test',
  username: 'arksai_verify',
  password: 'Verify123!',
  value: 42,
  amount: 10,
  price: 9.99,
  quantity: 1,
  completed: false,
  done: false,
  status: 'open',
});

/** Discover HTTP routes from the workspace source (Express/Fastify/Flask/FastAPI). */
async function discoverRoutes(dir: string, signal: AbortSignal): Promise<{ method: string; path: string }[]> {
  const out: { method: string; path: string }[] = [];
  const seen = new Set<string>();
  const add = (method: string, path: string) => {
    if (!path.startsWith('/')) return;
    const key = `${method} ${path}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ method, path });
    }
  };

  // JS/TS: app.get('/x'), router.post("/y"), .route('/z')
  const js = await execBash(
    `rg -No --no-filename -e "\\.(get|post|put|patch|delete|route)\\s*\\(\\s*['\\\`\\"][^'\\\`\\"]+" --glob '*.{js,ts,jsx,tsx,mjs,cjs}' -g '!**/node_modules/**' . 2>/dev/null | head -n 200`,
    { cwd: dir, timeoutMs: 15_000, signal },
  );
  for (const line of js.output.split('\n')) {
    const m = line.match(/\.(get|post|put|patch|delete|route)\s*\(\s*['"`]([^'"`]+)/i);
    if (m) add(m[1].toLowerCase() === 'route' ? 'get' : m[1].toUpperCase(), m[2]);
  }
  // Python: @app.get("/x"), @router.post('/y'), @app.route("/z")
  const py = await execBash(
    `rg -No --no-filename -e "@\\w+\\.(get|post|put|patch|delete|route)\\s*\\(\\s*['\\"][^'\\"]+" --glob '*.py' . 2>/dev/null | head -n 200`,
    { cwd: dir, timeoutMs: 15_000, signal },
  );
  for (const line of py.output.split('\n')) {
    const m = line.match(/@\w+\.(get|post|put|patch|delete|route)\s*\(\s*['"]([^'"]+)/i);
    if (m) add(m[1].toLowerCase() === 'route' ? 'get' : m[1].toUpperCase(), m[2]);
  }
  return out.slice(0, MAX_ROUTES);
}

/** A seed value for a single route param, by name (so :id stays numeric-ish). */
function paramValue(name: string): string {
  const n = name.toLowerCase();
  if (/slug/.test(n)) return 'arksai-verify';
  if (/(^|_)(id|pk|num|count|page|index)$/.test(n) || n === 'id') return '1';
  return 'arksai-verify';
}

/**
 * Fill route params with seed values so parameterized routes are actually
 * exercised instead of skipped: Express `:id`, brace `{id}`, Flask/FastAPI
 * `<id>` / `<int:id>`. Returns null for catch-all/wildcard routes we can't
 * meaningfully hit. A handler that 404s on a missing record is fine; one that
 * 5xx-crashes is exactly the bug this surfaces.
 */
export function fillParams(p: string): string | null {
  if (p.includes('*')) return null;
  // Angle-bracket form first (Flask/FastAPI `<int:id>`) — it contains a colon
  // that the Express `:param` rule would otherwise grab.
  let out = p
    .replace(/<(?:[a-zA-Z_]+:)?([a-zA-Z_][\w]*)>/g, (_m, name) => paramValue(name))
    .replace(/\{([a-zA-Z_][\w]*)\}/g, (_m, name) => paramValue(name))
    .replace(/:([a-zA-Z_][\w]*)\??/g, (_m, name) => paramValue(name));
  // Any leftover param syntax means we couldn't fully resolve it — skip.
  if (/[:{}<>]/.test(out)) return null;
  return out;
}

async function curl(method: string, url: string, dir: string, signal: AbortSignal, body?: string) {
  const data = body ? `-X ${method} -H 'Content-Type: application/json' -d ${JSON.stringify(body)}` : `-X ${method}`;
  const res = await execBash(
    `curl -s -m 8 ${data} -w '\\n__CODE__%{http_code}' ${JSON.stringify(url)}`,
    { cwd: dir, timeoutMs: 10_000, signal },
  );
  const i = res.output.lastIndexOf('__CODE__');
  const code = i >= 0 ? parseInt(res.output.slice(i + 8).trim(), 10) : NaN;
  const text = i >= 0 ? res.output.slice(0, i) : res.output;
  return { code: Number.isFinite(code) ? code : null, text };
}

/**
 * Boot the app, then actually exercise it: GET the readable routes, POST seeded
 * data to write routes, and confirm a create -> read-back round-trip. Surfaces
 * any 5xx as a real failure. Cleans up the process afterward.
 */
export async function probeApp(
  sessionId: string,
  dir: string,
  startCmd: string,
  signal: AbortSignal,
  opts?: {
    visual?: boolean;
    onPhase?: (label: string) => void;
    /** Wireframe boards: swap in the lo-fi rubric + export the board PNG next to the HTML. */
    wireframe?: boolean;
  },
): Promise<ProbeReport> {
  const phase = (label: string) => opts?.onPhase?.(label);
  const empty = (detail: string): ProbeReport => ({
    booted: false,
    port: null,
    baseCode: null,
    checks: [],
    serverErrors: 0,
    roundTrip: false,
    routesFound: 0,
    ui: null,
    detail,
  });

  const before = new Set(listeningPorts());
  let proc;
  try {
    phase('Starting it up…');
    proc = processRegistry.start(sessionId, startCmd, dir, 'verify-boot');
  } catch (e: any) {
    return empty(`Could not start the app: ${e?.message ?? e}`);
  }

  try {
    // Wait for it to open a port.
    let port: number | null = null;
    const deadline = Date.now() + BOOT_WAIT_MS;
    while (Date.now() < deadline && !signal.aborted) {
      await new Promise((r) => setTimeout(r, 600));
      if (proc.exited) {
        return empty(`The app crashed on startup.\nStart: ${startCmd}\nLogs:\n${processRegistry.tail(proc.id, 30)}`);
      }
      const fresh = listeningPorts().filter((p) => !before.has(p));
      if (fresh.length) {
        port = fresh[0];
        break;
      }
    }
    if (!port) {
      return empty(
        `The app did not open a port within ${BOOT_WAIT_MS / 1000}s.\nStart: ${startCmd}\nLogs:\n${processRegistry.tail(proc.id, 30)}`,
      );
    }
    const base = `http://127.0.0.1:${port}`;

    // Base route.
    const root = await curl('GET', `${base}/`, dir, signal);
    const checks: ProbeCheck[] = [];
    let serverErrors = 0;
    const note5xx = (c: number | null) => (c && c >= 500 ? (serverErrors++, 'SERVER ERROR') : '');

    // Discover and exercise routes.
    const routes = await discoverRoutes(dir, signal);
    if (routes.length) phase('Exercising every route with seeded data…');
    const writePaths: string[] = [];
    for (const r of routes) {
      if (signal.aborted) break;
      const reqPath = fillParams(r.path);
      if (reqPath === null) continue; // wildcard / unresolvable param route
      const paramNote = reqPath !== r.path ? ' [param-filled]' : '';
      if (r.method === 'GET') {
        const res = await curl('GET', base + reqPath, dir, signal);
        checks.push({ method: 'GET', path: r.path, code: res.code, note: note5xx(res.code) + paramNote });
      } else if (r.method === 'POST') {
        const res = await curl('POST', base + reqPath, dir, signal, SEED);
        const ok2xx = res.code !== null && res.code >= 200 && res.code < 300;
        checks.push({
          method: 'POST',
          path: r.path,
          code: res.code,
          note:
            (note5xx(res.code) || (ok2xx ? 'seeded' : res.code && res.code < 500 ? '(payload rejected)' : '')) +
            paramNote,
        });
        // Only round-trip-check param-free write paths (a filled :id may not be GETtable).
        if (ok2xx && reqPath === r.path) writePaths.push(r.path);
      }
    }

    // Round-trip: re-GET each path we successfully POSTed to and look for the marker.
    let roundTrip = false;
    for (const p of writePaths) {
      if (signal.aborted) break;
      const res = await curl('GET', base + p, dir, signal);
      if (res.text.includes(MARKER)) {
        roundTrip = true;
        checks.push({ method: 'GET', path: p, code: res.code, note: '✓ round-trip: seeded data read back' });
        break;
      }
    }

    const baseOk = root.code !== null && root.code > 0 && root.code < 500;
    const booted = baseOk && serverErrors === 0;

    // UI smoke test: for HTML apps, load it in a real headless browser and check
    // it actually renders (no uncaught errors, no blank page, assets resolve).
    let ui: UiCheckResult | null = null;
    const servesHtml = /<!doctype html|<html[\s>]/i.test(root.text);
    if (baseOk && servesHtml && !signal.aborted) {
      phase('Checking it renders in a real browser…');
      ui = await browserSmokeTest(`http://127.0.0.1:${port}/`, signal, {
        visual: opts?.visual,
        designBrief: readDesignBrief(dir),
        manifest: readVerifyManifest(dir),
        ...(opts?.wireframe
          ? { wireframe: true, rubric: WIREFRAME_RUBRIC_PROMPT, exportShotPath: path.join(dir, 'wireframe-board.png') }
          : {}),
      });
    }

    const lines = checks.map((c) => `  ${c.method} ${c.path} → ${c.code ?? 'no response'}${c.note ? '  ' + c.note : ''}`);
    let detail =
      `App booted on port ${port}. Base / → ${root.code ?? 'no response'}.\n` +
      (routes.length ? `Exercised ${checks.length} route(s):\n${lines.join('\n')}` : 'No routes discovered from source.') +
      (roundTrip ? '\n✓ Verified a create→read-back flow end-to-end.' : '');
    if (ui && ui.ran) detail += `\n\n--- UI render check ---\n${ui.detail}`;
    if (serverErrors > 0) {
      detail += `\n\n✗ ${serverErrors} endpoint(s) returned a 5xx — the app is erroring.\nLogs:\n${processRegistry.tail(proc.id, 25)}`;
    } else if (!baseOk) {
      detail += `\n\n✗ The app did not serve a healthy base response.\nLogs:\n${processRegistry.tail(proc.id, 25)}`;
    } else if (ui && ui.hardFail) {
      detail += `\n\nLogs:\n${processRegistry.tail(proc.id, 25)}`;
    }

    return {
      booted,
      port,
      baseCode: root.code,
      checks,
      serverErrors,
      roundTrip,
      routesFound: routes.length,
      ui,
      detail,
    };
  } finally {
    processRegistry.kill(proc.id);
  }
}
