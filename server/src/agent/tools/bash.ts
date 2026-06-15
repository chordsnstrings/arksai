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

/**
 * Commands blocked in EVERY mode (even AGENT_UNRESTRICTED): the agent loop runs
 * INSIDE the ArksAI server process, so a broad process-kill or a host power command
 * can take the whole server down (it has, repeatedly). The agent manages its own
 * background processes with kill_process, never the host.
 */
const PROTECTED: { re: RegExp; why: string }[] = [
  { re: /(^|[\s;&|`(])(pkill|killall)\b/i, why: 'kills processes by name (e.g. "pkill node" kills ArksAI itself)' },
  { re: /\bfuser\b[^\n]*-k/i, why: 'fuser -k kills whatever holds a port' },
  { re: /\b(shutdown|reboot|halt|poweroff)\b/i, why: 'is host power control' },
  { re: /\binit\s+[06]\b/i, why: 'halts/reboots the host' },
  { re: /\bsystemctl\s+(stop|restart|kill|disable|mask)\b/i, why: 'controls host services' },
];
export function protectedCommand(command: string): string | null {
  for (const { re, why } of PROTECTED) {
    if (re.test(command)) {
      return `Blocked: that command ${why} — the agent runs inside the ArksAI server, so it could kill the server or the host. Use kill_process to stop your OWN background processes; never pkill/killall/fuser/shutdown the host.`;
    }
  }
  return null;
}

export const bashTool: ToolDef = {
  name: 'bash',
  description:
    'Run a bash command inside the workspace repository. Working directory is the repo root. ' +
    'Output is truncated to ~30KB. In Plan mode only read-only commands are allowed. ' +
    'The process group is killed when the call returns — use bash_background for servers ' +
    'or anything that must keep running.',
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
    const protectedHit = protectedCommand(command);
    if (protectedHit) return protectedHit;
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
