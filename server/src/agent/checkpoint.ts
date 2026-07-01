import fs from 'node:fs';
import path from 'node:path';
import { execBash } from '../lib/exec';

/**
 * Checkpointed long-build mode (Phase 4) — make a large/long build DURABLE + RESUMABLE.
 * For a big build the agent works task-by-task and calls `checkpoint("<milestone>")` after each
 * working milestone: we commit the workspace state (a real git checkpoint) and record it in a
 * durable ledger. If the run is interrupted (crash/restart/stall) and the session resumes, we
 * inject a note listing the completed checkpoints so the agent CONTINUES instead of redoing work.
 * Opt-in (config.checkpointBuilds); does nothing when off.
 */
export interface Checkpoint {
  task: string;
  sha: string;
  ts: number;
}

const LEDGER_REL = '.arksai/checkpoints.json';
const ledgerPath = (repoDir: string): string => path.join(repoDir, LEDGER_REL);
const GIT_ID = '-c user.email=agent@arksai.studio -c user.name="ArksAI"';

/** Read the durable checkpoint ledger for a workspace (empty if none / unreadable). */
export function readCheckpoints(repoDir: string): Checkpoint[] {
  try {
    const arr = JSON.parse(fs.readFileSync(ledgerPath(repoDir), 'utf8'));
    return Array.isArray(arr) ? arr.filter((c) => c && typeof c.task === 'string') : [];
  } catch {
    return [];
  }
}

async function ensureGitRepo(repoDir: string): Promise<void> {
  if (fs.existsSync(path.join(repoDir, '.git'))) return;
  await execBash(`git init -q && git add -A && git ${GIT_ID} commit -q --allow-empty -m "checkpoint: initial state"`, {
    cwd: repoDir,
    timeoutMs: 30_000,
  });
}

/** Commit the current workspace state as a durable checkpoint for one completed task + record it. */
export async function recordCheckpoint(repoDir: string, task: string): Promise<{ ok: boolean; sha: string; output: string }> {
  const clean = task.trim().replace(/\s+/g, ' ').slice(0, 120) || 'task';
  await ensureGitRepo(repoDir);
  const add = await execBash('git add -A', { cwd: repoDir, timeoutMs: 30_000 });
  if (!add.ok) return { ok: false, sha: '', output: add.output };
  // --allow-empty so a checkpoint after a no-op step still advances the ledger.
  const commit = await execBash(`git ${GIT_ID} commit -q --allow-empty -m ${JSON.stringify('checkpoint: ' + clean)}`, {
    cwd: repoDir,
    timeoutMs: 30_000,
  });
  const rev = await execBash('git rev-parse --short HEAD', { cwd: repoDir, timeoutMs: 15_000 });
  const sha = rev.ok ? (rev.output.trim().split('\n').pop() || '').slice(0, 12) : '';
  const list = readCheckpoints(repoDir);
  list.push({ task: clean, sha, ts: Date.now() });
  try {
    fs.mkdirSync(path.dirname(ledgerPath(repoDir)), { recursive: true });
    fs.writeFileSync(ledgerPath(repoDir), JSON.stringify(list, null, 2));
  } catch {
    /* ledger is best-effort; the git commit is the real durable state */
  }
  return { ok: commit.ok, sha, output: commit.output };
}

/** A resume note injected when a build with prior checkpoints starts again — so work isn't redone. */
export function checkpointResumeNote(repoDir: string): string {
  const cps = readCheckpoints(repoDir);
  if (!cps.length) return '';
  const done = cps.map((c, i) => `${i + 1}. ${c.task} (${c.sha})`).join('\n');
  const last = cps[cps.length - 1];
  return `\n\n## Resuming a checkpointed build\nThis build has ${cps.length} committed checkpoint(s) — completed, working code you must NOT rebuild:\n${done}\nThe last checkpoint was "${last.task}". CONTINUE from there: reuse the already-committed code in the workspace, pick up the next unfinished task, and call checkpoint(...) after each new milestone.`;
}

/** Steering injected for a LARGE build so it proceeds task-by-task with durable checkpoints. */
export function checkpointPlanGuidance(): string {
  return `## Large build — work in durable, resumable tasks
This is a big/complex build. Do NOT try to produce everything in one pass:
- First OUTLINE the build as an ordered list of discrete, independently-workable tasks (e.g. "1. data model + migrations, 2. auth API, 3. login screen, 4. …").
- Build ONE task at a time to a working state, then call checkpoint("<the task you finished>") — it commits the workspace so the build survives an interruption and can resume without redoing work.
- Keep each task small enough to complete + checkpoint; verify a task works before moving on. This trades a single fragile marathon for steady, recoverable progress.`;
}
