import { execBash, MAX_TIMEOUT_MS } from '../../lib/exec';
import type { ToolDef } from './common';

/**
 * Plan mode is read-only: write tools are removed from the schema entirely,
 * and this denylist is defense-in-depth for bash itself.
 */
const PLAN_MODE_DENY: RegExp[] = [
  /(^|[;&|]\s*)(rm|mv|cp|touch|mkdir|rmdir|chmod|chown|ln|truncate|dd)\b/,
  />>?/,
  /\bsed\s+(-[a-zA-Z]*\s+)*-i\b/,
  /\bgit\s+(add|commit|push|checkout|switch|reset|merge|rebase|clean|stash|cherry-pick|tag|branch\s+-[dDm])\b/,
  /\b(npm|pnpm|yarn|bun)\s+(install|i|ci|add|remove|update|up)\b/,
  /\bpip3?\s+install\b/,
  /\btee\b/,
];

export function planModeViolation(command: string): string | null {
  for (const re of PLAN_MODE_DENY) {
    if (re.test(command)) {
      return `Blocked in Plan mode (read-only): command matches ${re}. Switch to Code mode to make changes.`;
    }
  }
  return null;
}

export const bashTool: ToolDef = {
  name: 'bash',
  description:
    'Run a bash command inside the workspace repository. Working directory is the repo root. ' +
    'Output is truncated to ~30KB. In Plan mode only read-only commands are allowed.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The bash command to run' },
      timeout_ms: {
        type: 'number',
        description: `Optional timeout in ms (default 60000, max ${MAX_TIMEOUT_MS})`,
      },
    },
    required: ['command'],
  },
  modes: ['plan', 'code'],
  summarize: (args) => String(args.command ?? '').slice(0, 120),
  async run(args, ctx) {
    const command = String(args.command ?? '');
    if (!command.trim()) return 'Error: empty command';
    if (ctx.mode === 'plan') {
      const violation = planModeViolation(command);
      if (violation) return violation;
    }
    const res = await execBash(command, {
      cwd: ctx.repoDir,
      timeoutMs: args.timeout_ms,
      signal: ctx.signal,
    });
    const head = res.ok ? '' : `[exit code ${res.exitCode}]\n`;
    return head + (res.output || '(no output)');
  },
};
