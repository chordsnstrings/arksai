import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execBash } from '../lib/exec';
import { listeningPorts } from '../lib/ports';
import { detectStartCommand } from '../agent/verify';
import { browserSmokeTest } from '../agent/uiCheck';
import { config } from '../config';
import { repoDir } from '../sessions/workspace';
import * as store from '../sessions/store';
import { deploymentRegistry, deploymentDir } from './registry';
import type { Deployment, DeploymentKind } from '../../../shared/types';

/** A published deployment plus the result of smoke-testing its live public URL. */
export type PublishResult = Deployment & { verifyDetail?: string; verifyOk?: boolean };

function slugify(name: string): string {
  return (
    (name || 'app')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'app'
  );
}

async function uniqueSlug(base: string): Promise<string> {
  let s = base;
  let n = 1;
  while (await store.getDeploymentBySlug(s)) {
    n++;
    s = `${base}-${n}`;
  }
  return s;
}

/** Snapshot a session's built app into a durable dir and serve/run it at a slug URL. */
export async function publishSession(sessionId: string, name?: string): Promise<PublishResult> {
  const session = await store.getSession(sessionId);
  if (!session) throw new Error('session not found');
  const src = repoDir(sessionId);
  if (!fs.existsSync(src)) throw new Error('no workspace to publish');

  // Supersede any prior deployment(s) for this session — kill + remove them — so
  // re-publishes (including verification retries) don't pile up errored/duplicate
  // slugs, and the public URL stays stable instead of drifting to -2/-3.
  try {
    const prior = (await store.listDeployments()).filter((d) => d.sessionId === sessionId);
    for (const d of prior) {
      deploymentRegistry.kill(d.slug);
      await store.deleteDeployment(d.slug);
      try {
        fs.rmSync(deploymentDir(d.slug), { recursive: true, force: true });
      } catch {}
    }
  } catch {}

  const appName = String(name || session.repoName || session.title || 'app');
  const slug = await uniqueSlug(slugify(appName));
  const dest = deploymentDir(slug);
  fs.mkdirSync(dest, { recursive: true });

  // Durable snapshot (exclude node_modules/.git — deps are (re)installed below).
  const snap = await execBash(
    `tar -C ${JSON.stringify(src)} --exclude=node_modules --exclude=.git -cf - . | tar -C ${JSON.stringify(dest)} -xf -`,
    { cwd: src, timeoutMs: 120_000 },
  );
  if (!snap.ok) throw new Error(`snapshot failed: ${snap.output.slice(-300)}`);

  const startCmd = detectStartCommand(dest);
  let kind: DeploymentKind = 'static';
  let port: number | null = null;
  let status: Deployment['status'] = 'running';

  if (startCmd) {
    kind = /python|wsgi/.test(startCmd) ? 'python' : 'node';
    if (kind === 'node' && fs.existsSync(path.join(dest, 'package.json'))) {
      const install = fs.existsSync(path.join(dest, 'package-lock.json'))
        ? 'npm ci --omit=dev --no-audit --no-fund'
        : 'npm install --omit=dev --no-audit --no-fund';
      await execBash(install, { cwd: dest, timeoutMs: 300_000 }).catch(() => null);
    } else if (kind === 'python' && fs.existsSync(path.join(dest, 'requirements.txt'))) {
      await execBash('python3 -m pip install -r requirements.txt', { cwd: dest, timeoutMs: 300_000 }).catch(() => null);
    }
    port = deploymentRegistry.allocPort();
    deploymentRegistry.start(slug, dest, startCmd, port);
    // Wait for it to bind its port.
    const deadline = Date.now() + 15_000;
    let bound = false;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500));
      if (listeningPorts().includes(port)) {
        bound = true;
        break;
      }
    }
    if (!bound) status = 'error';
  }

  const dep = await store.createDeployment({
    id: randomUUID(),
    sessionId,
    projectId: session.projectId,
    slug,
    name: appName.slice(0, 80),
    kind,
    status,
    url: `/apps/${slug}/`,
    port,
  });

  // POST-PUBLISH verification — smoke-test the REAL public URL the user will
  // open (`/apps/<slug>/`, served by this same server), so they never get a
  // broken link. On a hard failure mark it errored and hand the defect back to
  // the agent to fix + republish. Bounded + best-effort (degrades to a pass if
  // Playwright/Chromium is unavailable, e.g. in a bare sandbox).
  let verifyDetail: string | undefined;
  let verifyOk = true;
  if (status !== 'error') {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 30_000);
    try {
      const ui = await browserSmokeTest(`http://127.0.0.1:${config.port}/apps/${slug}/`, ac.signal);
      if (ui.ran && ui.hardFail) {
        verifyOk = false;
        await store.updateDeployment(slug, { status: 'error' });
        dep.status = 'error';
        verifyDetail = ui.detail;
      } else if (ui.ran) {
        verifyDetail = 'Post-publish check: the live URL renders cleanly in a headless browser.';
      }
    } catch {
      /* never block a publish on the checker itself */
    } finally {
      clearTimeout(timer);
    }
  }

  return Object.assign(dep, { verifyDetail, verifyOk });
}

export async function stopDeployment(slug: string) {
  deploymentRegistry.kill(slug);
  await store.updateDeployment(slug, { status: 'stopped' });
}

export async function restartDeployment(slug: string) {
  const d = await store.getDeploymentBySlug(slug);
  if (!d) return;
  if (d.kind !== 'static' && d.port != null) {
    const sc = detectStartCommand(deploymentDir(slug));
    if (sc) deploymentRegistry.start(slug, deploymentDir(slug), sc, d.port);
  }
  await store.updateDeployment(slug, { status: 'running' });
}

export async function removeDeployment(slug: string) {
  deploymentRegistry.kill(slug);
  await store.deleteDeployment(slug);
  try {
    fs.rmSync(deploymentDir(slug), { recursive: true, force: true });
  } catch {}
}
