import type { TaskProfile } from './taskProfile';
import type { SessionMode } from '../../../shared/types';

/**
 * Simple-build fast path — keeps trivially-simple asks trivially simple.
 * The failure it fixes: a "make me a counter app" ask ballooning into 100+ tool calls and 15 min
 * because the agent adds pages/features/state nobody asked for and re-polishes through many gate
 * rounds. For a `light`-tier code build we (1) inject anti-over-engineering guidance, (2) cap the
 * design-critique to a single round, and (3) nudge the model to ship once it's clearly over-building.
 * Model-agnostic: it changes the PIPELINE, not the model, so it works on the current stack.
 */
export function isSimpleBuild(profile: TaskProfile | undefined, mode: SessionMode): boolean {
  return mode === 'code' && profile?.tier === 'light';
}

/** Injected into the system prompt for a simple build. Simplicity IS the quality bar here. */
export function simpleBuildGuidance(): string {
  return `## Keep it simple — this is a SMALL request (fast path)
The user asked for a small, focused thing. Build the SIMPLEST version that FULLY satisfies the request, then STOP:
- ONE screen/page unless more is explicitly asked. Do NOT add extra pages, tabs, settings panels, auth, onboarding, dashboards, or "nice to have" features the user didn't request.
- Prefer sensible defaults over configurability; no speculative extras or future-proofing.
- Keep the modern look from the design system (that's automatic and cheap) — but don't gold-plate: no elaborate multi-section marketing layout for a one-purpose tool.
- Get the core working, verify it ONCE, and finish. Don't re-polish the same thing repeatedly.
An over-built result for a simple ask is a FAILURE, not thoroughness — simplicity is the bar.`;
}

/** Iteration count past which a simple build is clearly over-building and gets a one-time "ship it" nudge. */
export const SIMPLE_BUILD_NUDGE_AT = 28;

/** The one-time nudge appended to the conversation when a simple build runs long. */
export function simpleBuildNudge(): string {
  return `You've done a lot of work for what is a SMALL request. Ship the SIMPLEST working version NOW: stop adding features, pages, or polish; make sure the core does what was asked; verify once and finish.`;
}
