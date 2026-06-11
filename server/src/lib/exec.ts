import { spawn } from 'node:child_process';
import { secretValues } from '../config';

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
 * Child processes get an allowlisted environment: the agent's bash can never
 * read DEEPSEEK_API_KEY / GITHUB_TOKEN / APP_PASSWORD because they simply
 * aren't there.
 */
export function childEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const allow = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'USER', 'NODE_ENV', 'TMPDIR'];
  const env: NodeJS.ProcessEnv = { TERM: 'dumb', GIT_TERMINAL_PROMPT: '0', CI: 'true' };
  for (const key of allow) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return { ...env, ...extra };
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
  opts: { cwd: string; timeoutMs?: number; signal?: AbortSignal; env?: Record<string, string> },
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
