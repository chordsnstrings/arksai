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

const NO_TEST = /no test specified/i;

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
export async function verifyProject(dir: string, signal: AbortSignal): Promise<VerifyReport> {
  const checks: CheckResult[] = [];
  const add = (c: CheckResult) => {
    checks.push(c);
    return c.ok;
  };
  const done = (): VerifyReport => {
    const ran = checks.length > 0;
    const ok = checks.every((c) => c.ok);
    const summary = !ran
      ? 'No recognizable project to verify (no package.json/go.mod/Cargo.toml/Python project found).'
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
      if (!add(await run('install deps', install, dir, signal, 300_000))) return done();
    }
    const order: [string, string][] = [];
    if (scripts.typecheck) order.push(['typecheck', 'npm run typecheck']);
    else if (exists(dir, 'tsconfig.json')) order.push(['typecheck (tsc)', 'npx --no-install tsc --noEmit']);
    if (scripts.lint) order.push(['lint', 'npm run lint']);
    if (scripts.test && !NO_TEST.test(scripts.test)) order.push(['test', 'npm test']);
    if (scripts.build) order.push(['build', 'npm run build']);
    for (const [name, cmd] of order) if (!add(await run(name, cmd, dir, signal))) return done();
    if (order.length > 0 || checks.length > 0) return done();
  }

  // ---- Go ----
  if (exists(dir, 'go.mod')) {
    if (!add(await run('go build', 'go build ./... 2>&1', dir, signal))) return done();
    add(await run('go test', 'go test ./... 2>&1', dir, signal));
    return done();
  }

  // ---- Rust ----
  if (exists(dir, 'Cargo.toml')) {
    if (!add(await run('cargo build', 'cargo build 2>&1', dir, signal, 300_000))) return done();
    add(await run('cargo test', 'cargo test 2>&1', dir, signal, 300_000));
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
      const res = await run('pytest', 'python3 -m pytest -q 2>&1', dir, signal);
      // "no tests ran" exit code 5 isn't a real failure; fall back to compile.
      if (res.ok || /no tests ran|collected 0 items/i.test(res.output)) add({ ...res, ok: true, name: 'pytest' });
      else return (add(res), done());
    }
    add(await run('py compile', 'python3 -m compileall -q . 2>&1', dir, signal));
    return done();
  }

  return done();
}
