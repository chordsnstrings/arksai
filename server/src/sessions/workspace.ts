import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';
import { execBash } from '../lib/exec';
import { extractText } from '../lib/extract';
import { bus } from '../events/bus';
import * as store from './store';
import type { SessionMeta } from '../../../shared/types';

export function workspaceRoot(): string {
  return path.join(config.dataDir, 'workspaces');
}

export function repoDir(sessionId: string): string {
  return path.join(workspaceRoot(), sessionId, 'repo');
}

/** Where a project's persistent knowledge files live on the volume. */
export function projectKnowledgeDir(projectId: string): string {
  return path.join(config.dataDir, 'projects', projectId, 'knowledge');
}

/**
 * Copy a project's knowledge files into the session workspace under knowledge/
 * and extract documents to readable sidecars, so the agent picks them up with
 * the normal read_file/glob/grep tools.
 */
async function copyProjectKnowledge(session: SessionMeta): Promise<void> {
  if (!session.projectId) return;
  const src = projectKnowledgeDir(session.projectId);
  if (!fs.existsSync(src)) return;
  const dest = path.join(repoDir(session.id), 'knowledge');
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    try {
      const d = path.join(dest, name);
      fs.copyFileSync(path.join(src, name), d);
      const extracted = await extractText(d);
      if (extracted !== null) fs.writeFileSync(path.join(dest, `${name}.extracted.txt`), extracted);
    } catch {
      /* skip a bad file */
    }
  }
}

/** Parse "https://github.com/owner/repo(.git)" or "owner/repo" → canonical https URL + name. */
export function parseRepoUrl(input: string): { url: string; name: string } | null {
  const trimmed = input.trim().replace(/\.git$/, '');
  let m = trimmed.match(/^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/?$/);
  if (!m) m = trimmed.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (!m) return null;
  return { url: `https://github.com/${m[1]}/${m[2]}.git`, name: `${m[1]}/${m[2]}` };
}

function authedUrl(cleanUrl: string): string {
  if (!config.githubToken) return cleanUrl;
  return cleanUrl.replace('https://', `https://x-access-token:${config.githubToken}@`);
}

async function git(dir: string, args: string, timeoutMs = 120_000) {
  return execBash(`git ${args}`, { cwd: dir, timeoutMs });
}

/**
 * Create the workspace dir and either clone the repo (PAT injected for the
 * clone only, then scrubbed from the on-disk remote) or git-init an empty one.
 */
export async function setupWorkspace(session: SessionMeta): Promise<void> {
  const wsDir = path.dirname(repoDir(session.id));
  fs.mkdirSync(wsDir, { recursive: true });
  const dir = repoDir(session.id);

  if (session.repoUrl) {
    bus.emit(session.id, { type: 'clone_progress', phase: 'cloning', detail: `Cloning ${session.repoName}...` });
    const branchArg = session.branch ? `-b ${JSON.stringify(session.branch)}` : '';
    const res = await git(
      wsDir,
      `clone --depth 50 ${branchArg} ${JSON.stringify(authedUrl(session.repoUrl))} repo`,
      300_000,
    );
    if (!res.ok) {
      bus.emit(session.id, { type: 'clone_progress', phase: 'error', detail: res.output.slice(-1000) });
      await store.updateSession(session.id, { status: 'error' });
      await store.appendTimeline(session.id, {
        kind: 'system',
        id: crypto.randomUUID(),
        level: 'error',
        text: `Clone failed:\n${res.output.slice(-1000)}`,
        ts: Date.now(),
      });
      bus.sessionChanged((await store.getSession(session.id))!);
      return;
    }
    // Scrub the token from the persisted remote; pushes re-inject it per call.
    await git(dir, `remote set-url origin ${JSON.stringify(session.repoUrl)}`);
  } else {
    fs.mkdirSync(dir, { recursive: true });
    await git(dir, 'init');
  }

  await git(dir, 'config user.name "ArksAI Agent"');
  await git(dir, 'config user.email "arksai-agent@users.noreply.github.com"');

  const branchRes = await git(dir, 'rev-parse --abbrev-ref HEAD');
  const branch = branchRes.ok ? branchRes.output.trim() : session.branch;
  await store.updateSession(session.id, { branch: branch || null });

  // Project knowledge: drop the project's files into the workspace so the agent
  // has them available in every session of the project.
  await copyProjectKnowledge(session).catch((err) => console.error('[project-knowledge]', err));

  bus.emit(session.id, { type: 'clone_progress', phase: 'done', detail: 'Workspace ready' });
  bus.sessionChanged((await store.getSession(session.id))!);
}

/** "+12 −3" style summary of uncommitted changes, or null if clean/unavailable. */
export async function diffStat(sessionId: string): Promise<string | null> {
  const dir = repoDir(sessionId);
  if (!fs.existsSync(dir)) return null;
  const res = await execBash('git diff --shortstat HEAD 2>/dev/null', { cwd: dir, timeoutMs: 15_000 });
  if (!res.ok) return null;
  const ins = res.output.match(/(\d+) insertion/);
  const del = res.output.match(/(\d+) deletion/);
  if (!ins && !del) return null;
  return `+${ins ? ins[1] : 0} −${del ? del[1] : 0}`;
}

/** Full uncommitted diff (status + git diff), capped. */
export async function fullDiff(sessionId: string): Promise<string> {
  const dir = repoDir(sessionId);
  if (!fs.existsSync(dir)) return 'No workspace.';
  const status = await execBash('git status --short --branch', { cwd: dir, timeoutMs: 15_000 });
  const diff = await execBash('git diff HEAD 2>/dev/null', { cwd: dir, timeoutMs: 20_000 });
  const out = `${status.output}\n\n${diff.output}`.trim();
  return out || 'Clean working tree — no changes.';
}

/** Workspace file list (excluding node_modules/.git), capped. */
export async function listFiles(sessionId: string): Promise<string[]> {
  const dir = repoDir(sessionId);
  if (!fs.existsSync(dir)) return [];
  const fg = (await import('fast-glob')).default;
  const files = await fg('**/*', {
    // Exclude dependency / virtualenv / build noise so a deliverable is never pushed off
    // the listing cap (a python-docx .venv added hundreds of files and hid the real .docx).
    cwd: dir,
    ignore: [
      '**/node_modules/**',
      '**/.git/**',
      '**/.venv/**',
      '**/venv/**',
      '**/env/**',
      '**/__pycache__/**',
      '**/site-packages/**',
      '**/*.egg-info/**',
      '**/.pytest_cache/**',
      '**/.cache/**',
    ],
    dot: true,
    onlyFiles: true,
    followSymbolicLinks: false,
    suppressErrors: true,
  });
  return files.sort().slice(0, 400);
}

export function pushUrl(session: SessionMeta): string | null {
  if (!session.repoUrl) return null;
  return authedUrl(session.repoUrl);
}

export function deleteWorkspace(sessionId: string) {
  const dir = path.join(workspaceRoot(), sessionId);
  fs.rmSync(dir, { recursive: true, force: true });
}

/** Boot sweep: remove workspace dirs with no session or older than the TTL. */
export async function sweepWorkspaces() {
  const root = workspaceRoot();
  if (!fs.existsSync(root)) return;
  const ttlMs = config.workspaceTtlDays * 24 * 3600 * 1000;
  for (const entry of fs.readdirSync(root)) {
    const session = await store.getSession(entry);
    const full = path.join(root, entry);
    let stale = false;
    if (!session) stale = true;
    else if (Date.now() - session.updatedAt > ttlMs) stale = true;
    if (stale) {
      try {
        fs.rmSync(full, { recursive: true, force: true });
        console.log(`[sweep] removed stale workspace ${entry}`);
      } catch (err) {
        console.warn(`[sweep] failed to remove ${entry}:`, err);
      }
    }
  }
}
