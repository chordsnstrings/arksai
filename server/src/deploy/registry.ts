import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';
import { childEnv } from '../lib/exec';
import { detectStartCommand } from '../agent/verify';
import * as store from '../sessions/store';

const PORT_BASE = 41000;
const PORT_MAX = 41999;

export function deploymentsRoot(): string {
  return path.join(config.dataDir, 'deployments');
}
export function deploymentDir(slug: string): string {
  return path.join(deploymentsRoot(), slug);
}

/**
 * Durable manager for published apps. Unlike the per-session processRegistry,
 * these survive session deletion and are restarted on server boot.
 */
class DeploymentRegistry {
  private live = new Map<string, { child: ChildProcess; port: number }>();

  runningPort(slug: string): number | null {
    return this.live.get(slug)?.port ?? null;
  }
  isRunning(slug: string): boolean {
    return this.live.has(slug);
  }
  allocPort(): number {
    const used = new Set([...this.live.values()].map((v) => v.port));
    for (let p = PORT_BASE; p <= PORT_MAX; p++) if (!used.has(p)) return p;
    throw new Error('no free deployment port');
  }

  start(slug: string, dir: string, startCmd: string, port: number): number {
    this.kill(slug);
    fs.mkdirSync(dir, { recursive: true });
    const logFd = fs.openSync(path.join(dir, '.deploy.log'), 'a');
    const child = spawn('bash', ['-c', startCmd], {
      cwd: dir,
      env: { ...childEnv(), PORT: String(port), HOST: '127.0.0.1' },
      detached: true,
      stdio: ['ignore', logFd, logFd],
    });
    child.unref();
    fs.closeSync(logFd);
    this.live.set(slug, { child, port });
    child.on('exit', () => {
      if (this.live.get(slug)?.child === child) this.live.delete(slug);
    });
    return port;
  }

  kill(slug: string) {
    const e = this.live.get(slug);
    if (!e) return;
    try {
      if (e.child.pid) process.kill(-e.child.pid, 'SIGKILL');
    } catch {
      try {
        e.child.kill('SIGKILL');
      } catch {}
    }
    this.live.delete(slug);
  }

  tail(slug: string, bytes = 4000): string {
    const f = path.join(deploymentDir(slug), '.deploy.log');
    try {
      const size = fs.statSync(f).size;
      const start = Math.max(0, size - bytes);
      const fd = fs.openSync(f, 'r');
      const buf = Buffer.alloc(size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      fs.closeSync(fd);
      return buf.toString('utf8');
    } catch {
      return '';
    }
  }
}

export const deploymentRegistry = new DeploymentRegistry();

/** Boot sweep: restart server-app deployments that were running. */
export async function recoverDeployments(): Promise<void> {
  const deps = await store.listDeployments().catch(() => []);
  for (const d of deps) {
    if (d.expiresAt != null && d.expiresAt <= Date.now()) continue; // expired preview — the janitor removes it
    if (d.kind === 'static' || d.status !== 'running' || d.port == null) continue;
    const dir = deploymentDir(d.slug);
    if (!fs.existsSync(dir)) {
      await store.updateDeployment(d.slug, { status: 'error' });
      continue;
    }
    const startCmd = detectStartCommand(dir);
    if (startCmd) {
      try {
        deploymentRegistry.start(d.slug, dir, startCmd, d.port);
      } catch {
        await store.updateDeployment(d.slug, { status: 'error' });
      }
    }
  }
}

process.on('exit', () => {
  for (const slug of [...(deploymentRegistry as any).live.keys()]) deploymentRegistry.kill(slug);
});
