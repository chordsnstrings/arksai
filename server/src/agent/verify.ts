import fs from 'node:fs';
import path from 'node:path';
import { execBash, truncateMiddle } from '../lib/exec';

export interface CheckResult {
  name: string;
  ok: boolean;
  output: string;
}
export interface VerifyReport {
  ran: boolean;
  ok: boolean;
  checks: CheckResult[];
  summary: string;
}

/** Reports each static check as it starts/finishes so the runner can stream a
 *  live "the system is rigorously checking this" progress beat. */
export type PhaseReporter = (name: string, status: 'start' | 'ok' | 'fail') => void;

/** Human, jargon-keeping labels for the checks (they advertise real work). */
const CHECK_LABEL: Record<string, string> = {
  'install deps': 'Installing dependencies',
  typecheck: 'Type-checking',
  'typecheck (tsc)': 'Type-checking',
  lint: 'Linting',
  test: 'Running the test suite',
  build: 'Building',
  'go build': 'Compiling (Go)',
  'go test': 'Running the test suite',
  'cargo build': 'Compiling (Rust)',
  'cargo test': 'Running the test suite',
  pytest: 'Running the test suite',
  'py compile': 'Compiling (Python)',
};
export function checkLabel(name: string): string {
  return CHECK_LABEL[name] ?? name;
}

const NO_TEST = /no test specified/i;

/**
 * Detect how to boot this project as a running app, or null if it's a
 * library/script with nothing to serve. Used by the runtime verification phase.
 */
// A long-running SERVER/app entry contains one of these; a plain LIBRARY (index.js that just
// exports) or a STATIC client app does not. Signals are language-scoped and chosen to NOT match
// common CLIENT idioms — bare `.listen(` (React Router `history.listen`, store.listen) and `app.run()`
// (a plain method name) are NOT used, since a static app with those was wrongly booted as a server.
const JS_SERVER_RE =
  /createServer|express\s*\(|fastify\s*\(|new\s+Koa\b|new\s+Hono\b|@hono\/node-server|Deno\.serve|Bun\.serve|polka\s*\(/i;
// A server that binds a port from the environment: `app.listen(process.env.PORT)` (either order).
const JS_PORT_LISTEN_RE =
  /process\.env\.PORT[\s\S]{0,300}\.listen\s*\(|\.listen\s*\([^)]{0,80}process\.env\.PORT/i;
// Python server signals — only checked on .py files.
const PY_SERVER_RE =
  /Flask\s*\(|FastAPI\s*\(|Sanic\s*\(|app\.run\s*\(|uvicorn|gunicorn|HTTPServer|socketserver|http\.server|wsgiref|aiohttp/i;

function looksLikeServer(dir: string, file: string): boolean {
  try {
    const src = fs.readFileSync(path.join(dir, file), 'utf8').slice(0, 40_000);
    if (/\.py$/.test(file)) return PY_SERVER_RE.test(src);
    return JS_SERVER_RE.test(src) || JS_PORT_LISTEN_RE.test(src);
  } catch {
    return false;
  }
}

// A DB/infra-backed server app (Prisma/Postgres/Mongo/Redis/…) provably CANNOT boot inside the
// build sandbox — there's no database or env there. That's not a code defect: the verify gate
// should not hard-fail it (which blocks finishing + publishing, where it runs with its real DB).
const DB_DEP_RE =
  /"(@prisma\/client|prisma|pg|pg-promise|postgres|mysql2?|mariadb|mongoose|mongodb|typeorm|sequelize|drizzle-orm|knex|redis|ioredis|@planetscale\/database|@neondatabase\/serverless|better-sqlite3)"/i;
const PY_DB_RE = /\b(psycopg2?|sqlalchemy|django|asyncpg|pymongo|redis|mysqlclient|aiomysql|databases)\b/i;
export function needsExternalDb(dir: string): boolean {
  try {
    if (exists(dir, 'package.json')) {
      const raw = fs.readFileSync(path.join(dir, 'package.json'), 'utf8');
      const pkg = JSON.parse(raw);
      const deps = JSON.stringify({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) });
      if (DB_DEP_RE.test(deps)) return true;
      if (/DATABASE_URL|MONGO_URL|REDIS_URL|POSTGRES_URL/.test(JSON.stringify(pkg.scripts || {}))) return true;
    }
  } catch {
    /* ignore */
  }
  try {
    if (exists(dir, 'requirements.txt')) return PY_DB_RE.test(fs.readFileSync(path.join(dir, 'requirements.txt'), 'utf8'));
  } catch {
    /* ignore */
  }
  return false;
}

export function detectStartCommand(dir: string): string | null {
  if (exists(dir, 'package.json')) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
      const s: Record<string, string> = pkg.scripts ?? {};
      // An explicit run script means the author declared how to run it — trust it.
      if (s.start) return 'npm start';
      if (s.serve) return 'npm run serve';
      if (s.dev) return 'npm run dev';
    } catch {}
    // Entry-file fallback: ONLY treat it as a start command if the file actually starts a server.
    // Otherwise it's a library (index.js exports a function) and there is nothing to boot — booting
    // it opens no port and loops the runtime gate (the p-limit case).
    for (const f of ['server.js', 'app.js', 'src/server.js', 'index.js', 'main.js', 'src/index.js']) {
      if (exists(dir, f) && looksLikeServer(dir, f)) return `node ${f}`;
    }
  }
  for (const f of ['main.py', 'app.py', 'server.py', 'wsgi.py']) {
    if (exists(dir, f) && looksLikeServer(dir, f)) return `python3 ${f}`;
  }
  if (exists(dir, 'go.mod')) return 'go run .';
  return null;
}

async function run(name: string, command: string, dir: string, signal: AbortSignal, timeoutMs = 180_000): Promise<CheckResult> {
  const res = await execBash(command, { cwd: dir, timeoutMs, signal });
  return { name, ok: res.ok, output: truncateMiddle(res.output, 4000) };
}

function exists(dir: string, p: string) {
  return fs.existsSync(path.join(dir, p));
}

/**
 * Detect the project's stack and run its checks (typecheck/lint/test/build).
 * Stops at the first failing check (that's the one to fix). Returns ran=false
 * if no recognizable project is present.
 */
export async function verifyProject(
  dir: string,
  signal: AbortSignal,
  onPhase?: PhaseReporter,
): Promise<VerifyReport> {
  const checks: CheckResult[] = [];
  const add = (c: CheckResult) => {
    checks.push(c);
    return c.ok;
  };
  // Run a check while announcing its start/result, so the UI can show the system
  // doing each piece of real work (install → typecheck → test → build).
  const step = async (name: string, command: string, timeoutMs?: number): Promise<CheckResult> => {
    onPhase?.(name, 'start');
    const res = await run(name, command, dir, signal, timeoutMs);
    onPhase?.(name, res.ok ? 'ok' : 'fail');
    return res;
  };
  const done = (): VerifyReport => {
    const ran = checks.length > 0;
    const ok = checks.every((c) => c.ok);
    const summary = !ran
      ? 'No build step needed here — it’s a static site, so there’s nothing to compile. (It’s loaded in a real browser separately to confirm it renders.)'
      : ok
        ? `✓ All checks passed: ${checks.map((c) => c.name).join(', ')}.`
        : `✗ Verification failed at: ${checks.find((c) => !c.ok)!.name}.`;
    return { ran, ok, checks, summary };
  };

  // ---- Node / TypeScript ----
  if (exists(dir, 'package.json')) {
    let pkg: any = {};
    try {
      pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    } catch {}
    const scripts: Record<string, string> = pkg.scripts ?? {};

    if (!exists(dir, 'node_modules')) {
      const install = exists(dir, 'package-lock.json')
        ? 'npm ci --no-audit --no-fund'
        : 'npm install --no-audit --no-fund';
      if (!add(await step('install deps', install, 300_000))) return done();
    }
    const order: [string, string][] = [];
    if (scripts.typecheck) order.push(['typecheck', 'npm run typecheck']);
    else if (exists(dir, 'tsconfig.json')) order.push(['typecheck (tsc)', 'npx --no-install tsc --noEmit']);
    if (scripts.lint) order.push(['lint', 'npm run lint']);
    if (scripts.test && !NO_TEST.test(scripts.test)) order.push(['test', 'npm test']);
    if (scripts.build) order.push(['build', 'npm run build']);
    for (const [name, cmd] of order) if (!add(await step(name, cmd))) return done();
    if (order.length > 0 || checks.length > 0) return done();
  }

  // ---- Go ----
  if (exists(dir, 'go.mod')) {
    if (!add(await step('go build', 'go build ./... 2>&1'))) return done();
    add(await step('go test', 'go test ./... 2>&1'));
    return done();
  }

  // ---- Rust ----
  if (exists(dir, 'Cargo.toml')) {
    if (!add(await step('cargo build', 'cargo build 2>&1', 300_000))) return done();
    add(await step('cargo test', 'cargo test 2>&1', 300_000));
    return done();
  }

  // ---- Python ----
  if (exists(dir, 'pyproject.toml') || exists(dir, 'setup.py') || exists(dir, 'requirements.txt')) {
    const hasTests =
      exists(dir, 'tests') ||
      exists(dir, 'pytest.ini') ||
      exists(dir, 'conftest.py') ||
      exists(dir, 'pyproject.toml');
    if (hasTests) {
      const res = await step('pytest', 'python3 -m pytest -q 2>&1');
      // "no tests ran" exit code 5 isn't a real failure; fall back to compile.
      if (res.ok || /no tests ran|collected 0 items/i.test(res.output)) add({ ...res, ok: true, name: 'pytest' });
      else return (add(res), done());
    }
    add(await step('py compile', 'python3 -m compileall -q . 2>&1'));
    return done();
  }

  return done();
}
