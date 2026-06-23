import { execBash } from '../../lib/exec';
import { resolvePushUrl } from '../../sessions/workspace';
import type { ToolDef } from './common';

export const gitDiffStatTool: ToolDef = {
  name: 'git_diff_stat',
  description: 'Show git status and a diff summary of uncommitted changes in the workspace.',
  parameters: { type: 'object', properties: {} },
  modes: ['plan', 'code'],
  summarize: () => 'status + diff',
  async run(_args, ctx) {
    const status = await execBash('git status --short --branch', { cwd: ctx.repoDir, timeoutMs: 15_000 });
    const diff = await execBash('git diff --stat HEAD 2>/dev/null | tail -n 30', {
      cwd: ctx.repoDir,
      timeoutMs: 15_000,
    });
    return `${status.output}\n${diff.output}`.trim() || 'Clean working tree.';
  },
};

export const gitCommitTool: ToolDef = {
  name: 'git_commit',
  description: 'Stage all changes and create a git commit with the given message.',
  parameters: {
    type: 'object',
    properties: { message: { type: 'string' } },
    required: ['message'],
  },
  modes: ['code'],
  summarize: (args) => String(args.message ?? '').slice(0, 80),
  async run(args, ctx) {
    const msg = String(args.message ?? '').trim();
    if (!msg) return 'Error: empty commit message';
    const add = await execBash('git add -A', { cwd: ctx.repoDir, timeoutMs: 30_000 });
    if (!add.ok) return `git add failed:\n${add.output}`;
    const commit = await execBash(`git commit -m ${JSON.stringify(msg)}`, {
      cwd: ctx.repoDir,
      timeoutMs: 30_000,
    });
    return commit.output || (commit.ok ? 'Committed.' : 'Commit failed.');
  },
};

export const gitPushTool: ToolDef = {
  name: 'git_push',
  description:
    'Push the current branch (or a named branch) to the GitHub origin remote. ' +
    'Set create_branch to true to create and switch to a new branch before pushing.',
  parameters: {
    type: 'object',
    properties: {
      branch: { type: 'string', description: 'Branch to push (default: current branch)' },
      create_branch: { type: 'boolean', description: 'Create the branch first' },
    },
  },
  modes: ['code'],
  summarize: (args) => (args.branch ? `push ${args.branch}` : 'push current branch'),
  async run(args, ctx) {
    const target = await resolvePushUrl(ctx.session);
    if (!target) return 'Error: this session has no GitHub repository connected. Ask the user to connect a GitHub account and pick a repo (Connect GitHub → choose a repo) so pushes have a destination.';
    const { url, token } = target;

    let branch = String(args.branch ?? '').trim();
    if (args.create_branch && branch) {
      const co = await execBash(`git checkout -b ${JSON.stringify(branch)}`, {
        cwd: ctx.repoDir,
        timeoutMs: 30_000,
      });
      if (!co.ok && !/already exists/.test(co.output)) return `checkout failed:\n${co.output}`;
    }
    if (!branch) {
      const cur = await execBash('git rev-parse --abbrev-ref HEAD', { cwd: ctx.repoDir, timeoutMs: 15_000 });
      branch = cur.output.trim();
    }
    // Token is injected only for this invocation; exec scrubs it (global + this user's) from output.
    const res = await execBash(`git push ${JSON.stringify(url)} HEAD:${JSON.stringify(branch)}`, {
      cwd: ctx.repoDir,
      timeoutMs: 120_000,
      signal: ctx.signal,
      redact: [token],
    });
    return res.ok ? `Pushed to ${branch}.\n${res.output}` : `Push failed:\n${res.output}`;
  },
};
