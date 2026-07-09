import type { RobotAutonomy, RobotConfig } from '../../../shared/types';

/**
 * The AUTONOMY SLIDER (0–100) — the single control for a Social Media Manager robot. One
 * number, set by a slider in the console, decides how much the robot does on its own vs.
 * proposes for approval, across all three tracks (Engage / Publish / Advertise).
 *
 * Pure + unit-tested. Two invariants hold at EVERY level: negative/sensitive comments always
 * escalate (never auto-answered), and any ad spend over the configured cap always asks.
 *
 * Bands (by threshold):
 *   0–39   Ask first      — proposes everything; nothing goes out without your tap.
 *   40–59  Auto-reply     — answers comments/DMs on its own; posts & ads still ask.
 *   60–79  Auto content   — auto-replies AND publishes the approved calendar; ads still ask.
 *   80–100 Autopilot      — replies, publishes, and runs ads on its own, within the caps.
 */
export interface AutonomyPolicy {
  /** Clamped 0–100. */
  level: number;
  /** UI band label. */
  band: string;
  /** Auto-post comment/DM replies (never for escalated/negative messages). */
  autoReply: boolean;
  /** Auto-publish a due, approved calendar post without asking. */
  autoPublish: boolean;
  /** Auto-launch / auto-adjust ads WITHIN the spend cap without asking. */
  autoLaunch: boolean;
  /** Always true — negative/sensitive comments escalate at every level. */
  escalateNegative: boolean;
  /** True when nothing is automated → the robot only proposes (approval-gated). */
  holdForApproval: boolean;
}

export const AUTONOMY_BANDS: { min: number; label: string; blurb: string }[] = [
  { min: 0, label: 'Ask first', blurb: 'Proposes everything — nothing goes out without your tap.' },
  { min: 40, label: 'Auto-reply', blurb: 'Answers comments & DMs on its own. Posts and ads still ask you.' },
  { min: 60, label: 'Auto content', blurb: 'Auto-replies AND publishes the approved calendar. Ads still ask.' },
  { min: 80, label: 'Autopilot', blurb: 'Replies, publishes, and runs ads on its own — within your caps.' },
];

const clamp = (n: number): number => (Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 30);

/** The band a level falls into (highest threshold ≤ level). */
export function autonomyBand(level: number): { min: number; label: string; blurb: string } {
  const l = clamp(level);
  let band = AUTONOMY_BANDS[0];
  for (const b of AUTONOMY_BANDS) if (l >= b.min) band = b;
  return band;
}

/** Resolve the full policy from a slider level (0–100). */
export function autonomyPolicy(level: number): AutonomyPolicy {
  const l = clamp(level);
  const autoReply = l >= 40;
  const autoPublish = l >= 60;
  const autoLaunch = l >= 80;
  return {
    level: l,
    band: autonomyBand(l).label,
    autoReply,
    autoPublish,
    autoLaunch,
    escalateNegative: true,
    holdForApproval: !autoReply && !autoPublish && !autoLaunch,
  };
}

/** The slider value stored on a robot's config (default 30 = "Ask first"). */
export function autonomyLevelOf(config: RobotConfig | null | undefined, fallback = 30): number {
  const v = config?.autonomyLevel;
  return typeof v === 'number' && Number.isFinite(v) ? clamp(v) : fallback;
}

/** Derive the coarse reply-engine autonomy enum from the slider, so the shared inbound
 *  handler auto-sends replies exactly when the slider says "auto-reply" or higher. */
export function autonomyEnumFromLevel(level: number): RobotAutonomy {
  const l = clamp(level);
  if (l >= 40) return 'auto';
  if (l >= 15) return 'ask';
  return 'shadow';
}
