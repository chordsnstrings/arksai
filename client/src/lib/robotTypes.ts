import type { IconName } from './departments';

/**
 * The robot-TYPE registry (the per-kind scaffolding). A robot's `type` decides its
 * console view + how its "needs you" / timeline are framed. Email is implemented; the
 * others are declared so the host can show them as "coming soon" in the hire flow and
 * so adding one later is a registry entry + a view, not a refactor.
 *
 * Keep this in lockstep with shared/types.ts RobotType.
 */
export type RobotTypeId = 'email' | 'scheduled' | 'ads' | 'monitor' | 'social';

export interface RobotTypeSpec {
  id: RobotTypeId;
  label: string;
  icon: IconName;
  accent: string;
  /** One-line pitch for the hire picker. */
  tagline: string;
  /** What its trigger is, in plain words (shown in the hire picker). */
  trigger: string;
  /** Whether the console for this type is built yet. */
  available: boolean;
  /** Noun for an item in its "needs you" set (e.g. "email", "report"). */
  itemNoun: string;
}

export const ROBOT_TYPES: Record<RobotTypeId, RobotTypeSpec> = {
  email: {
    id: 'email',
    label: 'Email assistant',
    icon: 'mail',
    accent: '#3f6fb0',
    tagline: 'Reads your inbox, replies on its own, and flags the hard ones for you.',
    trigger: 'When an email arrives',
    available: true,
    itemNoun: 'email',
  },
  scheduled: {
    id: 'scheduled',
    label: 'Scheduled report',
    icon: 'calendar',
    accent: '#4f6551',
    tagline: 'Builds and delivers a report or dashboard on a cadence.',
    trigger: 'On a schedule',
    available: false,
    itemNoun: 'run',
  },
  ads: {
    id: 'ads',
    label: 'Ads manager',
    icon: 'megaphone',
    accent: '#97604a',
    tagline: 'Watches campaigns and proposes spend/creative changes to approve.',
    trigger: 'When a campaign needs a decision',
    available: false,
    itemNoun: 'change',
  },
  monitor: {
    id: 'monitor',
    label: 'Monitor',
    icon: 'trending-up',
    accent: '#5f5170',
    tagline: 'Watches a metric or source and alerts you when something fires.',
    trigger: 'When something crosses a threshold',
    available: false,
    itemNoun: 'alert',
  },
  social: {
    id: 'social',
    label: 'Social media manager',
    icon: 'megaphone',
    accent: '#b0533f',
    tagline: 'Runs your Facebook & Instagram — posts, replies, autonomous ad campaigns and emailed reports.',
    trigger: 'Comments, DMs, the content calendar and the 48h ad-optimise loop',
    available: true,
    itemNoun: 'reply',
  },
};

export function robotType(id: string | undefined): RobotTypeSpec {
  return ROBOT_TYPES[(id as RobotTypeId) ?? 'email'] ?? ROBOT_TYPES.email;
}
