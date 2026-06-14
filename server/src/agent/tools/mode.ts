import type { SessionMode } from '../../../../shared/types';
import type { ToolDef } from './common';

const VALID: SessionMode[] = ['chat', 'plan', 'code', 'report'];
const LABEL: Record<SessionMode, string> = {
  chat: 'Chat',
  plan: 'Plan',
  code: 'Build (Code)',
  report: 'Report',
};

/**
 * Let the agent move the session into the mode that fits the request, mid-run.
 * This is how a chat becomes a build: the runner reloads the new mode's toolset,
 * system prompt, and engine, then continues the same turn. Used automatically —
 * the agent doesn't ask the user, it just switches and says so.
 */
export const switchModeTool: ToolDef = {
  name: 'switch_mode',
  description:
    "Switch this session into a different mode when the request needs capabilities the current mode " +
    "lacks, then keep working. Use 'code' to BUILD (apps, sites, tools, scripts, spreadsheets, docs — " +
    "unlocks write/run/verify/publish), 'report' for a polished PDF / slide deck / designed report, " +
    "'chat' for plain conversation, 'plan' for read-only investigation. Call this and proceed in the " +
    "same turn; tell the user in one short line that you've switched. Don't ask permission.",
  parameters: {
    type: 'object',
    properties: {
      mode: { type: 'string', enum: VALID, description: 'The mode to switch into.' },
      reason: { type: 'string', description: 'One short phrase on why (shown to the user).' },
    },
    required: ['mode'],
  },
  modes: ['chat', 'plan', 'code', 'report'],
  summarize: (a) => `switch to ${String(a.mode ?? '')}`,
  async run(args, ctx) {
    const mode = String(args.mode ?? '') as SessionMode;
    if (!VALID.includes(mode)) return `Error: unknown mode "${args.mode}". Use one of: ${VALID.join(', ')}.`;
    if (mode === ctx.mode) return `Already in ${LABEL[mode]} mode — no switch needed; just proceed.`;
    if (!ctx.requestModeSwitch) return 'Error: mode switching is not available in this run.';
    ctx.requestModeSwitch(mode);
    return `Switched to ${LABEL[mode]} mode — its tools are now available. Continue and complete the task.`;
  },
};
