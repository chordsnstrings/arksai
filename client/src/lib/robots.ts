import { DEPARTMENTS, departmentById, type IconName } from './departments';

/**
 * "Robots" — the agentic surface. A Robot is a STANDING, role-branded agent (Finance Agent,
 * Marketing Agent…) with a plain-language mandate, triggers that wake it, an autonomy level,
 * and a journal of what it's done. This file is the typed client contract + role catalog only;
 * the durable runtime (checkpointed long runs, real triggers, approvals) is the next build, so
 * the store starts EMPTY — no mock data. Robots are created by the user via the Hire flow.
 */

/** A robot's role is a department (reuses the existing per-function identity + accent). */
export type RobotRole = string; // a DepartmentId

/** How much the robot may do on its own — the consumer-friendly form of permission modes. */
export type AutonomyLevel = 'ask_all' | 'ask_big' | 'autonomous';
export const AUTONOMY: { id: AutonomyLevel; label: string; blurb: string }[] = [
  { id: 'ask_all', label: 'Ask me before everything', blurb: 'Nothing leaves without your OK. Most control.' },
  { id: 'ask_big', label: 'Ask me for the big things', blurb: 'Routine work runs itself; consequential actions wait for you.' },
  { id: 'autonomous', label: 'Just keep me posted', blurb: 'Acts on its own; you get a digest. Most hands-off.' },
];

/** What wakes a robot. Plain language; the runtime maps these to real triggers later. */
export type TriggerKind = 'manual' | 'schedule' | 'event' | 'watch';
export const TRIGGERS: { id: TriggerKind; label: string; blurb: string; icon: IconName }[] = [
  { id: 'manual', label: 'When I ask', blurb: 'Runs only when you tell it to.', icon: 'circle-check' },
  { id: 'schedule', label: 'On a schedule', blurb: 'Every day / week / month, automatically.', icon: 'calendar' },
  { id: 'event', label: 'When something arrives', blurb: 'New email, file, form response or webhook.', icon: 'mail' },
  { id: 'watch', label: 'When a number moves', blurb: 'Watches a metric and acts when it crosses a line.', icon: 'trending-up' },
];

export type RobotStatus = 'idle' | 'working' | 'waiting' | 'paused';
export const STATUS_META: Record<RobotStatus, { label: string; tone: string }> = {
  idle: { label: 'Idle', tone: '#8a8378' },
  working: { label: 'Working', tone: '#2a5a8c' },
  waiting: { label: 'Needs you', tone: '#c0502f' },
  paused: { label: 'Paused', tone: '#8a8378' },
};

export interface JournalEntry {
  id: string;
  at: number;
  text: string;
  kind?: 'did' | 'asked' | 'delivered' | 'note';
}
export interface RobotOutput {
  id: string;
  at: number;
  title: string;
  kind: 'app' | 'pdf' | 'sheet' | 'doc' | 'image' | 'message';
}

export interface Robot {
  id: string;
  role: RobotRole;
  name: string; // "Finance Agent"
  mandate: string; // plain-language standing instruction
  status: RobotStatus;
  autonomy: AutonomyLevel;
  triggers: TriggerKind[];
  createdAt: number;
  currentTask?: string;
  /** Backend role driving the reply persona: customer_service | personal_assistant | custom. */
  kind?: string;
  /** True when this robot has its own mailbox connected + receivable (IMAP). */
  mailboxReady?: boolean;
  /** Epoch ms of the last inbox check (heartbeat), or null if it hasn't run yet. */
  lastPolledAt?: number | null;
  journal: JournalEntry[];
  outputs: RobotOutput[];
}

/** A pending decision a robot is waiting on — the heart of the "Needs You" inbox. */
export interface Approval {
  id: string;
  robotId: string;
  title: string; // "Pause an underperforming ad"
  why: string; // one line of rationale
  draft?: string; // optional preview of what it wants to send/do
  at: number;
}

/** The role catalog = the existing departments, framed as hireable robots. */
export interface RoleSpec {
  id: string;
  name: string; // robot name, e.g. "Finance Agent"
  dept: string; // department display name
  accent: string;
  icon: IconName;
  blurb: string;
  /** A suggested starting mandate the user can edit. */
  mandateSuggestion: string;
}

const MANDATES: Record<string, string> = {
  finance:
    'Keep our financial model current, watch for anomalies in the numbers, and assemble the weekly board pack. Flag anything off before I have to ask.',
  marketing:
    'Watch our channel and ad performance, draft on-brand creative when we need it, and tell me what to double down on or cut.',
  sales:
    'Keep the pipeline clean and current, draft follow-ups for stalled deals, and refresh the forecast. Alert me when a key deal goes quiet.',
  people:
    'Help with hiring and people ops — draft JDs, offer letters and onboarding, and keep our process documents current.',
  engineering:
    'Keep an eye on our issues and errors, draft tech docs and runbooks, and prototype internal tools when asked.',
  bi: 'Turn our data into a living dashboard, watch the key metrics, and surface the insight behind any big move.',
  tax: 'Track our filing calendar and obligations, prepare the supporting workpapers, and warn me ahead of every deadline.',
  legal:
    'Review incoming contracts, flag the risky clauses, and prepare execution-ready drafts for counsel to sign off.',
};

export const ROLES: RoleSpec[] = DEPARTMENTS.map((d) => ({
  id: d.id,
  name: `${shortDept(d.name)} Agent`,
  dept: d.name,
  accent: d.accent,
  icon: d.icon,
  blurb: d.blurb,
  mandateSuggestion: MANDATES[d.id] ?? `Help the ${d.name} function with its recurring work, and check in with me before anything consequential.`,
}));

function shortDept(name: string): string {
  // "Finance / Strategy" → "Finance", "HR / People & Ops" → "People", "Tax & Compliance (UAE)" → "Tax"
  return name.split(/[/(&]/)[0].trim().replace(/^HR\s*/, 'People ').trim();
}

export function roleSpec(role: string): RoleSpec | undefined {
  return ROLES.find((r) => r.id === role) ?? roleFromDept(role);
}
function roleFromDept(role: string): RoleSpec | undefined {
  const d = departmentById(role);
  if (!d) return undefined;
  return { id: d.id, name: `${shortDept(d.name)} Agent`, dept: d.name, accent: d.accent, icon: d.icon, blurb: d.blurb, mandateSuggestion: '' };
}
