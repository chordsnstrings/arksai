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

/** Steering injected for a LARGE build so it proceeds task-by-task with durable checkpoints.
 *  Doctrine (operator, 2026-07-02): ONE PASS IF IT WORKS — this does NOT ask for extra passes.
 *  It bounds a build that is genuinely too large for one pass into a few one-pass STEPS. */
export function checkpointPlanGuidance(): string {
  return `## Large build — a few one-pass steps, each checkpointed
This build is likely too large for a single pass. Same one-pass rule, applied per STEP:
- FIRST post a SHORT ordered step plan (3–6 discrete, independently-workable steps, e.g. "1. shell + tokens, 2. core screens, 3. data layer, 4. polish+states").
- Each step is ONE pass: build it complete → check it works ONCE → call checkpoint("<the step>") — the commit makes the build resumable so nothing finished is ever redone or re-paid for.
- Then move to the NEXT step. Iterate on a step ONLY if its check found a concrete defect.
- If the whole build genuinely fits one pass, treat it as ONE step: build → check → checkpoint → deliver. Never add steps (or extra passes) a working result doesn't need.`;
}
