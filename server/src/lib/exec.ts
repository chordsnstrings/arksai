import { spawn } from 'node:child_process';
import { config, secretValues } from '../config';

export interface ExecResult {
  ok: boolean;
  exitCode: number | null;
  output: string;
  durationMs: number;
  timedOut: boolean;
}

const OUTPUT_CAP = 30_000; // chars
export const MAX_TIMEOUT_MS = 120_000;

/**
 * Child process environment.
 * - Hardened (default): an allowlist — the agent's bash cannot read
 *   DEEPSEEK_API_KEY / GITHUB_TOKEN / APP_PASSWORD because they aren't present.
 * - Unrestricted (AGENT_UNRESTRICTED=true): inherits the full process env so
 *   the agent can use credentials you provide (e.g. DIGITALOCEAN_TOKEN).
 */
export function childEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  // PORT defaults to 4000 so the agent's apps never inherit ArksAI's own port
  // (3000) and kill the server. The agent can still override it explicitly.
  // NODE_ENV defaults to 'development' so a workspace `npm install` pulls devDeps
  // (build toolchains live there). The server image runs NODE_ENV=production, which
  // would otherwise leak in and make `npm install` skip devDeps — the build then
  // fails (no tailwind/vite/etc.) and the agent burns turns rediscovering it. Build
  // tools (`next build`/`vite build`) set production themselves, so this is safe.
  const base: NodeJS.ProcessEnv = {
    TERM: 'dumb',
    GIT_TERMINAL_PROMPT: '0',
    CI: 'true',
    PORT: '4000',
    NODE_ENV: 'development',
  };
  if (config.agentUnrestricted) {
    // base (incl. NODE_ENV=development) is spread AFTER process.env so it overrides
    // the inherited production value; an explicit `extra.NODE_ENV` still wins.
    return { ...process.env, ...base, ...extra };
  }
  // NODE_ENV intentionally omitted from the allowlist so the loop can't overwrite
  // base's 'development' with the server's inherited 'production'.
  const allow = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'USER', 'TMPDIR', 'NODE_PATH'];
  for (const key of allow) {
    if (process.env[key]) base[key] = process.env[key];
  }
  return { ...base, ...extra };
}

/** Replace any known secret value in output with a placeholder. */
export function scrubSecrets(text: string): string {
  let out = text;
  for (const secret of secretValues()) {
    out = out.split(secret).join('[redacted]');
  }
  return out;
}

export function truncateMiddle(text: string, cap = OUTPUT_CAP): string {
  if (text.length <= cap) return text;
  const half = Math.floor(cap / 2);
  return (
    text.slice(0, half) +
    `\n\n... [${text.length - cap} characters truncated] ...\n\n` +
    text.slice(-half)
  );
}

export function execBash(
  command: string,
  opts: { cwd: string; timeoutMs?: number; signal?: AbortSignal; env?: Record<string, string>; redact?: (string | null | undefined)[] },
): Promise<ExecResult> {
  const timeoutMs = Math.min(opts.timeoutMs ?? 60_000, MAX_TIMEOUT_MS);
  const started = Date.now();

  return new Promise((resolve) => {
    const child = spawn('bash', ['-c', command], {
      cwd: opts.cwd,
      env: childEnv(opts.env),
      detached: true, // own process group so we can kill the whole tree
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    let timedOut = false;
    let settled = false;

    const append = (chunk: Buffer) => {
      if (output.length < OUTPUT_CAP * 4) output += chunk.toString('utf8');
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);

    const killTree = () => {
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL');
      } catch {
        try {
          child.kill('SIGKILL');
        } catch {}
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killTree();
    }, timeoutMs);

    const onAbort = () => killTree();
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      let text = scrubSecrets(truncateMiddle(output));
      // Per-call secrets (e.g. a user's GitHub token injected into a git URL for this push only).
      for (const r of opts.redact ?? []) if (r && r.length >= 6) text = text.split(r).join('[redacted]');
      if (timedOut) text += `\n[command timed out after ${timeoutMs}ms and was killed]`;
      resolve({
        ok: exitCode === 0,
        exitCode,
        output: text,
        durationMs: Date.now() - started,
        timedOut,
      });
    };

    child.on('error', (err) => {
      output += `\nspawn error: ${err.message}`;
      finish(null);
    });
    child.on('close', (code) => finish(code));
  });
}
