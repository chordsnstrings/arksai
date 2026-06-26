import { execBash } from '../../lib/exec';
import { recordPush, resolvePushUrl, resolveSessionToken, sessionDiff } from '../../sessions/workspace';
import { createPullRequest, parseOwnerRepo } from '../../github/pr';
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

export const gitDiffTool: ToolDef = {
  name: 'git_diff',
  description:
    'Show the FULL unified diff of everything you have changed this session (committed + uncommitted) ' +
    'vs the commit the workspace started from. Use this to REVIEW YOUR OWN WORK before you finish — ' +
    'read it and check for correctness bugs, regressions, leftover debug code, and anything you ' +
    "didn't intend to change.",
  parameters: { type: 'object', properties: {} },
  modes: ['plan', 'code'],
  summarize: () => 'full diff',
  async run(_args, ctx) {
    const { diff, changed } = await sessionDiff(ctx.session.id);
    if (!changed) return 'No changes yet — the working tree matches the base commit.';
    return diff;
  },
};

export const gitBranchesTool: ToolDef = {
  name: 'git_branches',
  description: 'List local and remote branches in the connected repository.',
  parameters: { type: 'object', properties: {} },
  modes: ['plan', 'code'],
  summarize: () => 'list branches',
  async run(_args, ctx) {
    const res = await execBash('git branch -a --format="%(refname:short)" 2>/dev/null | head -n 80', {
      cwd: ctx.repoDir,
      timeoutMs: 15_000,
    });
    return res.output.trim() || 'No branches found.';
  },
};

export const gitFetchTool: ToolDef = {
  name: 'git_fetch',
  description:
    'Fetch the latest refs from the GitHub origin (does not change your working tree). ' +
    'Use before creating a branch or opening a PR so your base is current.',
  parameters: { type: 'object', properties: {} },
  modes: ['code'],
  summarize: () => 'fetch origin',
  async run(_args, ctx) {
    const target = await resolvePushUrl(ctx.session);
    if (!target) return 'Error: no GitHub repository connected.';
    const res = await execBash(`git fetch ${JSON.stringify(target.url)} --prune`, {
      cwd: ctx.repoDir,
      timeoutMs: 120_000,
      signal: ctx.signal,
      redact: [target.token],
    });
    return res.ok ? `Fetched origin.\n${res.output}`.trim() : `Fetch failed:\n${res.output}`;
  },
};

export const gitPullTool: ToolDef = {
  name: 'git_pull',
  description:
    'Pull and merge the latest commits for a branch from the GitHub origin into your working tree. ' +
    'Defaults to the current branch.',
  parameters: {
    type: 'object',
    properties: { branch: { type: 'string', description: 'Branch to pull (default: current branch)' } },
  },
  modes: ['code'],
  summarize: (args) => (args.branch ? `pull ${args.branch}` : 'pull current branch'),
  async run(args, ctx) {
    const target = await resolvePushUrl(ctx.session);
    if (!target) return 'Error: no GitHub repository connected.';
    let branch = String(args.branch ?? '').trim();
    if (!branch) {
      branch = (await execBash('git rev-parse --abbrev-ref HEAD', { cwd: ctx.repoDir, timeoutMs: 15_000 })).output.trim();
    }
    const res = await execBash(`git pull --no-edit ${JSON.stringify(target.url)} ${JSON.stringify(branch)}`, {
      cwd: ctx.repoDir,
      timeoutMs: 120_000,
      signal: ctx.signal,
      redact: [target.token],
    });
    return res.ok ? `Pulled ${branch}.\n${res.output}`.trim() : `Pull failed:\n${res.output}`;
  },
};

export const openPullRequestTool: ToolDef = {
  name: 'open_pull_request',
  description:
    'Open a GitHub pull request for the work on the CURRENT branch. The branch must already be ' +
    'pushed (use git_push with create_branch first). Provide a clear title and a body summarizing ' +
    'WHAT changed, WHY, and HOW you verified it. Returns the PR URL. This is the right way to deliver ' +
    'changes to a connected repo — a reviewable PR, not a push straight onto the user\'s branch.',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'PR title — concise, imperative.' },
      body: { type: 'string', description: 'PR description: what changed, why, and how it was verified.' },
      base: { type: 'string', description: 'Branch to merge INTO (default: the branch the session started on).' },
      head: { type: 'string', description: 'Branch to merge FROM (default: the current branch).' },
      draft: { type: 'boolean', description: 'Open as a draft PR.' },
    },
    required: ['title'],
  },
  modes: ['code'],
  summarize: (args) => `PR: ${String(args.title ?? '').slice(0, 60)}`,
  async run(args, ctx) {
    if (!ctx.session.repoName) return 'Error: no GitHub repository connected, so there is nothing to open a PR against.';
    const or = parseOwnerRepo(ctx.session.repoName);
    if (!or) return `Error: could not parse owner/repo from "${ctx.session.repoName}".`;
    const token = await resolveSessionToken(ctx.session);
    if (!token) return 'Error: no GitHub token available to open a PR. Ask the user to connect their GitHub account.';

    const head = String(args.head ?? '').trim() ||
      (await execBash('git rev-parse --abbrev-ref HEAD', { cwd: ctx.repoDir, timeoutMs: 15_000 })).output.trim();
    const base = String(args.base ?? '').trim() || ctx.session.branch || 'main';
    if (head === base) {
      return `Error: head and base are the same branch (${head}). Create a working branch first (git_push with create_branch:true), then open the PR from it into ${base}.`;
    }
    const r = await createPullRequest({
      owner: or.owner,
      repo: or.repo,
      token,
      title: String(args.title ?? '').trim() || 'Update from ArksAI',
      head,
      base,
      body: String(args.body ?? ''),
      draft: !!args.draft,
    });
    if (!r.ok) return `Could not open the PR: ${r.error}. (Make sure the branch "${head}" is pushed and differs from "${base}".)`;
    return `Opened pull request #${r.number}: ${r.url}`;
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
    if (!res.ok) return `Push failed:\n${res.output}`;
    // Remember the pushed commit so the UI can show "pushed" with certainty (we push to an
    // explicit URL without an upstream, so local git alone can't tell what's been pushed).
    const sha = (await execBash('git rev-parse HEAD', { cwd: ctx.repoDir, timeoutMs: 15_000 })).output.trim();
    if (sha) recordPush(ctx.session.id, sha, branch);
    return `Pushed to ${branch} (${sha.slice(0, 7)}).\n${res.output}`;
  },
};
