import { execBash } from '../lib/exec';
import { listeningPorts } from '../lib/ports';
import { processRegistry } from './processes';

export interface RuntimeResult {
  booted: boolean;
  port: number | null;
  httpCode: number | null;
  detail: string;
}

const BOOT_WAIT_MS = 12_000;

/**
 * Boot the app in the background, detect the port it starts listening on, and
 * hit it over HTTP to confirm it actually serves. Cleans up the process after.
 */
export async function bootAndCheck(
  sessionId: string,
  dir: string,
  startCmd: string,
  signal: AbortSignal,
): Promise<RuntimeResult> {
  const before = new Set(listeningPorts());
  let proc;
  try {
    proc = processRegistry.start(sessionId, startCmd, dir, 'verify-boot');
  } catch (e: any) {
    return { booted: false, port: null, httpCode: null, detail: `Could not start: ${e?.message ?? e}` };
  }

  try {
    // Poll for a newly-opened listening port.
    let port: number | null = null;
    const deadline = Date.now() + BOOT_WAIT_MS;
    while (Date.now() < deadline && !signal.aborted) {
      await new Promise((r) => setTimeout(r, 600));
      if (proc.exited) break;
      const fresh = listeningPorts().filter((p) => !before.has(p));
      if (fresh.length) {
        port = fresh[0];
        break;
      }
    }

    if (!port) {
      const logs = processRegistry.tail(proc.id, 30);
      return {
        booted: false,
        port: null,
        httpCode: null,
        detail: `App did not open a port within ${BOOT_WAIT_MS / 1000}s.\nStart command: ${startCmd}\nLogs:\n${logs || '(none)'}`,
      };
    }

    // Hit the server (root, then common health paths).
    let httpCode: number | null = null;
    let body = '';
    for (const pathTry of ['/', '/healthz', '/health', '/api']) {
      const res = await execBash(
        `curl -s -m 6 -o /dev/null -w '%{http_code}' http://127.0.0.1:${port}${pathTry}`,
        { cwd: dir, timeoutMs: 8000, signal },
      );
      const code = parseInt(res.output.trim(), 10);
      if (Number.isFinite(code) && code > 0) {
        httpCode = code;
        if (code < 500) {
          body = pathTry;
          break;
        }
      }
    }

    const ok = httpCode !== null && httpCode > 0 && httpCode < 500;
    const logs = processRegistry.tail(proc.id, 20);
    return {
      booted: ok,
      port,
      httpCode,
      detail: ok
        ? `App booted on port ${port}; HTTP ${httpCode} on ${body || '/'}.`
        : `App started on port ${port} but did not serve a healthy response (last HTTP ${httpCode ?? 'no response'}).\nLogs:\n${logs || '(none)'}`,
    };
  } finally {
    processRegistry.kill(proc.id);
  }
}
