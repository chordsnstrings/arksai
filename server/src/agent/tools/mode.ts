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
    // The plan gate is structural: you can't jump from PLAN straight into BUILD in the
    // same turn you wrote the plan. Present it, call submit_plan (which ends your turn),
    // and the user Approves — only then (their next turn) can you switch to code.
    if (mode === 'code' && ctx.mode === 'plan' && !ctx.planResolved) {
      return 'Error: not yet — finish the plan and call submit_plan. Your turn ends so the user can Approve & build or Revise; you may switch to Build only once they have responded.';
    }
    ctx.requestModeSwitch(mode);
    return `Switched to ${LABEL[mode]} mode — its tools are now available. Continue and complete the task.`;
  },
};

/**
 * Plan mode's approval gate: the agent writes the plan, then calls this to hand the
 * decision to the user. It ends the turn and surfaces an Approve & build / Revise choice
 * in the UI — so building can only begin on the user's explicit next turn.
 */
export const submitPlanTool: ToolDef = {
  name: 'submit_plan',
  description:
    "Call this RIGHT AFTER you've laid out the full build plan in plan mode. It ends your " +
    'turn and shows the user an "Approve & build" / "Revise" choice. Prerequisite: the entire ' +
    'plan must already be written in your message above. Do not keep working or output anything ' +
    'after calling it — wait for the user.',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'One short line naming what will be built (shown on the prompt).' },
    },
  },
  modes: ['plan'],
  summarize: () => 'submit plan for approval',
  async run(_args, ctx) {
    if (ctx.mode !== 'plan') return 'Error: submit_plan is only used in plan mode.';
    if (!ctx.submitPlan) return 'Error: plan approval is not available in this run.';
    ctx.submitPlan();
    return 'Plan submitted for approval. Your turn ends now — the user will either Approve & build (you then switch_mode("code") and build the whole thing autonomously) or ask to Revise. Output nothing further.';
  },
};
