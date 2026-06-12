import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';
import { childEnv, scrubSecrets } from '../lib/exec';

export interface BgProcess {
  id: string;
  sessionId: string;
  name: string;
  command: string;
  pid: number | undefined;
  logFile: string;
  startedAt: number;
  exitCode: number | null;
  exited: boolean;
}

const MAX_PER_SESSION = 5;
const TAIL_BYTES = 16_384;

/**
 * Background processes started by the agent (dev servers, watchers).
 * They intentionally survive across tool calls and runs within a session;
 * they die with the session (delete/clear) or with this server process.
 */
class ProcessRegistry {
  private procs = new Map<string, BgProcess>();
  private children = new Map<string, ReturnType<typeof spawn>>();
  private counter = 0;

  start(sessionId: string, command: string, cwd: string, name?: string): BgProcess {
    const live = this.listForSession(sessionId).filter((p) => !p.exited);
    if (live.length >= MAX_PER_SESSION) {
      throw new Error(
        `Too many background processes (max ${MAX_PER_SESSION}). Kill one first: ` +
          live.map((p) => `${p.id} (${p.name})`).join(', '),
      );
    }

    const id = `p${++this.counter}`;
    const logsDir = path.join(config.dataDir, 'workspaces', sessionId, 'logs');
    fs.mkdirSync(logsDir, { recursive: true });
    const logFile = path.join(logsDir, `${id}.log`);
    const fd = fs.openSync(logFile, 'a');

    const child = spawn('bash', ['-c', command], {
      cwd,
      env: childEnv(),
      detached: true, // own process group so kill() takes the whole tree
      stdio: ['ignore', fd, fd],
    });
    child.unref();
    fs.closeSync(fd);

    const proc: BgProcess = {
      id,
      sessionId,
      name: name?.trim() || command.slice(0, 40),
      command,
      pid: child.pid,
      logFile,
      startedAt: Date.now(),
      exitCode: null,
      exited: false,
    };
    child.on('exit', (code) => {
      proc.exited = true;
      proc.exitCode = code;
      this.children.delete(id);
    });
    child.on('error', () => {
      proc.exited = true;
      this.children.delete(id);
    });

    this.procs.set(id, proc);
    this.children.set(id, child);
    return proc;
  }

  get(id: string): BgProcess | undefined {
    return this.procs.get(id);
  }

  listForSession(sessionId: string): BgProcess[] {
    return [...this.procs.values()].filter((p) => p.sessionId === sessionId);
  }

  /** Last N lines of the process log, secrets scrubbed. */
  tail(id: string, lines = 50): string {
    const proc = this.procs.get(id);
    if (!proc || !fs.existsSync(proc.logFile)) return '';
    const size = fs.statSync(proc.logFile).size;
    const start = Math.max(0, size - TAIL_BYTES);
    const fd = fs.openSync(proc.logFile, 'r');
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    const all = buf.toString('utf8').split('\n');
    return scrubSecrets(all.slice(-Math.max(1, Math.min(lines, 500))).join('\n'));
  }

  kill(id: string): boolean {
    const proc = this.procs.get(id);
    if (!proc || proc.exited) return false;
    try {
      if (proc.pid) process.kill(-proc.pid, 'SIGKILL');
    } catch {
      try {
        this.children.get(id)?.kill('SIGKILL');
      } catch {}
    }
    proc.exited = true;
    return true;
  }

  killAllForSession(sessionId: string) {
    for (const proc of this.listForSession(sessionId)) this.kill(proc.id);
  }

  killAll() {
    for (const id of this.procs.keys()) this.kill(id);
  }

  describe(proc: BgProcess): string {
    const status = proc.exited
      ? `exited${proc.exitCode !== null ? ` (code ${proc.exitCode})` : ''}`
      : 'running';
    const age = Math.floor((Date.now() - proc.startedAt) / 1000);
    return `[${proc.id}] ${proc.name} — ${status}, started ${age}s ago`;
  }
}

export const processRegistry = new ProcessRegistry();

// Best-effort cleanup so local dev doesn't leak orphans; in Docker the
// container's death handles this anyway.
process.on('exit', () => processRegistry.killAll());
