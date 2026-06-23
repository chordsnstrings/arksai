/**
 * Shared contract between server and client.
 * The AgentEvent union drives the server emitter, the SSE payloads and the
 * client timeline reducer — change it here and both sides follow.
 */

export type SessionMode = 'chat' | 'plan' | 'code' | 'report';
export type SessionStatus = 'idle' | 'running' | 'done' | 'error';

/**
 * Macro-stages of a run, in order. Drives the live progress bar: each phase owns
 * a monotonic pct band so the bar only ever moves forward, while the labels
 * advertise the (deliberately visible) expert work happening at each stage.
 */
export type ProgressPhase =
  | 'understanding'
  | 'building'
  | 'verifying'
  | 'testing'
  | 'polishing'
  | 'publishing'
  | 'done';

const PHASE_BANDS: Record<ProgressPhase, { floor: number; ceil: number }> = {
  understanding: { floor: 0, ceil: 10 },
  building: { floor: 10, ceil: 55 },
  verifying: { floor: 55, ceil: 75 },
  testing: { floor: 75, ceil: 88 },
  polishing: { floor: 88, ceil: 94 },
  publishing: { floor: 94, ceil: 99 },
  done: { floor: 100, ceil: 100 },
};

/** Start-of-band pct for a phase (the bar snaps here when the phase begins). */
export function phaseFloor(phase: ProgressPhase): number {
  return PHASE_BANDS[phase]?.floor ?? 0;
}
/** End-of-band pct — the client eases ("creeps") toward this while the phase runs. */
export function phaseCeiling(phase: ProgressPhase): number {
  return PHASE_BANDS[phase]?.ceil ?? 100;
}

/**
 * Typical wall-clock SECONDS per phase for a normal build — drives an honest, slightly-
 * generous "time remaining" estimate (a build usually BEATS it → a small positive surprise,
 * not a broken countdown). Heuristic; refined later from real run durations. `building` is the
 * variable one, scaled by mode. ORDER must match the phase progression.
 */
const PHASE_TYPICAL_SEC: Record<ProgressPhase, number> = {
  understanding: 12,
  building: 140,
  verifying: 35,
  testing: 30,
  polishing: 22,
  publishing: 25,
  done: 0,
};
const PHASE_ORDER: ProgressPhase[] = ['understanding', 'building', 'verifying', 'testing', 'polishing', 'publishing', 'done'];

/**
 * Best-effort estimate of seconds remaining: the unfinished part of the current phase plus
 * the typical duration of every phase still to come. Pure + deterministic so it's testable and
 * shared by server (emits it) and tests. `building` scales by mode (reports are bigger single
 * outputs; chat/plan are quick). Clamped to [0, 1800].
 */
export function estimateRemainingSeconds(
  phase: ProgressPhase,
  elapsedInPhaseSec: number,
  mode?: string,
  /** Self-calibrated typical seconds per phase (learned from this mode's real runs).
   *  When a phase is present here it OVERRIDES the static heuristic (and the mode scale,
   *  since a calibrated value already encodes mode). Phases absent here fall back. */
  typical?: Partial<Record<ProgressPhase, number>>,
): number {
  const idx = PHASE_ORDER.indexOf(phase);
  if (idx < 0 || phase === 'done') return 0;
  const scale = (p: ProgressPhase) =>
    p === 'building' ? (mode === 'report' ? 1.8 : mode === 'chat' || mode === 'plan' ? 0.5 : 1) : 1;
  const typ = (p: ProgressPhase) => typical?.[p] ?? PHASE_TYPICAL_SEC[p] * scale(p);
  const current = Math.max(0, typ(phase) - Math.max(0, elapsedInPhaseSec));
  let future = 0;
  for (let i = idx + 1; i < PHASE_ORDER.length; i++) future += typ(PHASE_ORDER[i]);
  return Math.min(1800, Math.round(current + future));
}
/** A selectable model id. The lineup is MiniMax-backed (Auto / Max / Flash). */
export type ModelId = string;

export const SESSION_MODES: SessionMode[] = ['chat', 'plan', 'code', 'report'];

/** Default: the orchestrator picks the concrete MiniMax model per task. */
export const DEFAULT_MODEL = 'arksai-auto';

/** Virtual model: the orchestrator picks the concrete model per task. */
export const AUTO_MODEL = 'arksai-auto';
/** MiniMax M3 — the top-quality, multimodal brain. */
export const MAX_MODEL = 'arksai-max';
/** MiniMax M2.7-highspeed — the fast/cheap tier. */
export const FAST_MODEL = 'arksai-flash';
export const isAutoModel = (id: string): boolean => id === AUTO_MODEL;

/** The full selectable lineup (all MiniMax-backed). */
export const FALLBACK_MODEL_IDS = [AUTO_MODEL, MAX_MODEL, FAST_MODEL];
/** Kept for older imports. */
export const MODELS: ModelId[] = FALLBACK_MODEL_IDS;

export interface ModelPricing {
  label: string;
  /** USD per 1M cached input tokens (much cheaper) */
  inputCacheHitPerM: number;
  /** USD per 1M uncached input tokens */
  inputCacheMissPerM: number;
  outputPerM: number;
}

export interface ModelInfo extends ModelPricing {
  id: string;
}

/**
 * MiniMax pricing in USD per 1M tokens. M3 (verified June 2026, current promo):
 * $0.30 input / $1.20 output, $0.06 cached input. Source:
 * https://devtk.ai/en/models/minimax-m3/ + the MiniMax console. Update if it changes.
 */
const DEFAULT_PRICING: ModelPricing = {
  label: 'unknown',
  inputCacheHitPerM: 0.06,
  inputCacheMissPerM: 0.3,
  outputPerM: 1.2,
};
// UI labels are ArksAI-branded (the underlying provider/model id is internal).
// All three tiers are MiniMax-backed. As we add other engines (e.g. music via
// Suno), they get ArksAI labels here too.
export const KNOWN_MODELS: Record<string, ModelPricing> = {
  // 'arksai-auto' is virtual (cost is computed against the concrete model the
  // router actually used → M3 or Flash). Priced like M3 as a neutral placeholder.
  'arksai-auto': { label: 'ArksAI Auto', inputCacheHitPerM: 0.06, inputCacheMissPerM: 0.3, outputPerM: 1.2 },
  // ArksAI Max = MiniMax M3 (verified current promo pricing).
  'arksai-max': { label: 'ArksAI Max', inputCacheHitPerM: 0.06, inputCacheMissPerM: 0.3, outputPerM: 1.2 },
  // ArksAI Flash = MiniMax M2.7-highspeed (fast/cheap tier). Output priced lower
  // than M3 as an ESTIMATE — validate against MiniMax billing and tune.
  'arksai-flash': { label: 'ArksAI Flash', inputCacheHitPerM: 0.06, inputCacheMissPerM: 0.2, outputPerM: 0.6 },
};

export function pricingFor(model: string): ModelPricing {
  return KNOWN_MODELS[model] ?? DEFAULT_PRICING;
}

export function modelLabel(id: string): string {
  return KNOWN_MODELS[id]?.label ?? id;
}

export interface CostTokens {
  cacheHit?: number;
  cacheMiss?: number;
  /** total prompt tokens; if cacheHit/cacheMiss are absent, all of this is billed as cache-miss */
  prompt?: number;
  completion: number;
}

/** Cost in USD mirroring MiniMax billing, accounting for cached input tokens. */
export function computeCost(model: string, t: CostTokens): number {
  const p = pricingFor(model);
  const hit = t.cacheHit ?? 0;
  const miss = t.cacheMiss ?? Math.max(0, (t.prompt ?? 0) - hit);
  return (
    (hit / 1e6) * p.inputCacheHitPerM +
    (miss / 1e6) * p.inputCacheMissPerM +
    (t.completion / 1e6) * p.outputPerM
  );
}

export interface SessionMeta {
  id: string;
  title: string;
  /** Owning organization (tenant). Drives org-scoped shared memory + branding. */
  orgId: string | null;
  projectId: string | null;
  repoUrl: string | null;
  repoName: string | null;
  branch: string | null;
  /** The user's GitHub connection used to clone/push this session's repo (per-user OAuth). */
  githubConnectionId?: string | null;
  mode: SessionMode;
  model: ModelId;
  status: SessionStatus;
  /** Department task key (e.g. "finance.cashflow") → injects expert standards. */
  task: string | null;
  /** Plan mode presented a build plan and is awaiting the user's Approve/Revise. */
  awaitingPlan?: boolean;
  diffStat: string | null;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  createdAt: number;
  updatedAt: number;
}

export interface ToolCallRecord {
  callId: string;
  tool: string;
  argsSummary: string;
  running: boolean;
  ok?: boolean;
  durationMs?: number;
  outputPreview?: string;
}

export type TimelineItem =
  | { kind: 'user'; id: string; text: string; ts: number }
  | { kind: 'assistant'; id: string; text: string; ts: number }
  | { kind: 'tools'; id: string; calls: ToolCallRecord[]; ts: number }
  | { kind: 'system'; id: string; level: 'info' | 'error'; text: string; ts: number }
  | { kind: 'file'; id: string; path: string; name: string; size: number; ts: number };

export type AgentEvent =
  | { type: 'run_started'; runId: string; mode: SessionMode }
  | { type: 'assistant_delta'; runId: string; text: string }
  | { type: 'assistant_message_done'; runId: string; messageId: string }
  // The current turn was dropped mid-stream (a transient connection close) and is being
  // redone — clear any partial assistant/tool output so the retry doesn't visibly double.
  | { type: 'turn_reset'; runId: string }
  | {
      type: 'tool_call_started';
      runId: string;
      callId: string;
      tool: string;
      argsSummary: string;
    }
  | {
      type: 'tool_call_finished';
      runId: string;
      callId: string;
      ok: boolean;
      durationMs: number;
      outputPreview: string;
    }
  | {
      type: 'usage_update';
      totalTokens: number;
      promptTokens: number;
      completionTokens: number;
      cacheHitTokens: number;
      cacheMissTokens: number;
      /** cumulative external-engine spend this run (e.g. Suno), USD */
      engineCostUsd?: number;
      /** server-authoritative model spend this run, USD — blends whatever model
       *  the orchestrator actually used (so the footer is correct in Auto mode) */
      costUsd?: number;
    }
  | { type: 'tick'; elapsedSeconds: number; runningTasks: number }
  | {
      /** Live progress beat: which macro-phase we're in, a human label advertising
       *  the work, a monotonic 0–100 pct, and an optional finer-grained detail. */
      type: 'progress';
      phase: ProgressPhase;
      label: string;
      pct: number;
      detail?: string;
      /** Best-effort estimated seconds remaining (slightly generous so a run usually
       *  beats it). Omitted when not estimable; the client ticks it down + degrades
       *  to a soft "almost there / larger job" when it runs out. */
      etaSeconds?: number;
    }
  | {
      type: 'run_finished';
      runId: string;
      status: SessionStatus;
      totalTokens: number;
      diffStat: string | null;
      /** What the run produced, for the "it's ready" completion card. */
      deliverable?: { kind: 'app' | 'pdf' | 'sheet' | 'doc' | 'image'; name?: string };
    }
  | { type: 'run_error'; runId: string; message: string }
  | { type: 'session_meta_updated'; meta: Partial<SessionMeta> & { id: string } }
  | { type: 'timeline_item'; item: TimelineItem }
  | { type: 'open_canvas'; port?: number; file?: string; kind?: 'app' | 'pdf' | 'sheet' | 'doc' | 'image' }
  | { type: 'clone_progress'; phase: 'cloning' | 'done' | 'error'; detail: string };

/** Lightweight event broadcast on the global channel for the sidebar. */
export type GlobalEvent = { type: 'session_status'; session: SessionMeta } | {
  type: 'session_deleted';
  sessionId: string;
  /** Owning org — lets the global stream filter so it never leaks across orgs. */
  orgId: string | null;
};

// ---- REST DTOs ----

export interface LoginRequest {
  password: string;
}

export interface CreateSessionRequest {
  repoUrl?: string;
  branch?: string;
  mode?: SessionMode;
  model?: ModelId;
  /** create this session inside a project — it inherits the project's defaults */
  projectId?: string;
  /** department task key (e.g. "finance.cashflow") for expert standards */
  task?: string;
  /** the caller's GitHub connection id to push this session's repo with (per-user OAuth) */
  githubConnectionId?: string;
}

/** A token-free GitHub connection + a repo, as the client picker sees them. */
export interface GithubStatus {
  enabled: boolean;
  connected: boolean;
  login?: string | null;
  avatarUrl?: string | null;
}
export interface GithubRepo {
  fullName: string;
  private: boolean;
  defaultBranch: string;
  pushedAt: string | null;
  cloneUrl: string;
}

// ---- Projects (persistent workspaces: instructions + knowledge + defaults) ----

export interface ProjectBranding {
  /** primary accent colour, hex */
  accent?: string;
  /** a few complementary swatches, hex */
  palette?: string[];
  /** logo file name stored in the project's knowledge dir, if uploaded */
  logoName?: string;
}

/**
 * An organization's shared profile — its identity + "about us", seeded during the
 * agent-driven onboarding and injected (read-only) into every session in the org.
 * Branding reuses ProjectBranding. NEVER shared across orgs.
 */
export interface OrgProfile {
  branding?: ProjectBranding;
  /** A short description of the org — what it does, who it serves. */
  about?: string;
  /** The org's website, used to seed the brand + about during onboarding. */
  websiteUrl?: string;
  /** Free-form answers captured during onboarding (industry, tone, priorities…). */
  answers?: Record<string, string>;
  /** True once the agent-driven onboarding has run. */
  onboardingComplete: boolean;
}

// ---- Scheduled / recurring tasks (durable server-side) ----

export type ScheduleCadence = 'daily' | 'weekly' | 'interval';

export interface Schedule {
  id: string;
  label: string;
  /** The brief sent as the first message of each run. */
  prompt: string;
  mode: SessionMode;
  model: ModelId;
  cadence: ScheduleCadence;
  /** "HH:MM" (24h) for daily/weekly — interpreted in `tz`. */
  at: string | null;
  /** 0–6 (Sun–Sat) for weekly. */
  weekday: number | null;
  /** milliseconds for the 'interval' cadence. */
  intervalMs: number | null;
  /** IANA timezone the `at`/`weekday` wall-clock is read in (e.g. "Asia/Dubai"). UTC if null. */
  tz: string | null;
  enabled: boolean;
  nextRunAt: number;
  lastRunAt: number | null;
  createdAt: number;
}

export interface CreateScheduleRequest {
  label: string;
  prompt: string;
  mode?: SessionMode;
  model?: ModelId;
  cadence: ScheduleCadence;
  at?: string;
  weekday?: number;
  intervalMs?: number;
  /** IANA timezone for `at`/`weekday` (defaults to the creator's browser tz). */
  tz?: string;
}

export interface Project {
  id: string;
  name: string;
  /** persistent custom-instructions layer applied to every session in the project */
  instructions: string;
  defaultRepoUrl: string | null;
  defaultBranch: string | null;
  defaultMode: SessionMode | null;
  defaultModel: ModelId | null;
  branding: ProjectBranding | null;
  /** 'org' = visible to the whole org (default); 'private' = owner + invited members only */
  visibility?: 'org' | 'private';
  /** computed */
  sessionCount: number;
  fileCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectFile {
  id: string;
  projectId: string;
  name: string;
  size: number;
  createdAt: number;
}

// ---- Deployments (publish a built app to a durable URL) ----

export type DeploymentKind = 'static' | 'node' | 'python';
export type DeploymentStatus = 'running' | 'stopped' | 'error';

export interface Deployment {
  id: string;
  sessionId: string;
  projectId: string | null;
  slug: string;
  name: string;
  kind: DeploymentKind;
  status: DeploymentStatus;
  url: string;
  port: number | null;
  createdAt: number;
  updatedAt: number;
  /** When this preview auto-expires (ms epoch). null = no expiry (legacy/permanent). */
  expiresAt?: number | null;
  /** For a built SPA framework (Vite/CRA/…): the built-output subdir to static-serve (e.g. "dist"). null = serve the deployment root. */
  staticDir?: string | null;
  /** Result of the post-publish smoke test (present on the publish response only). */
  verifyDetail?: string;
}

export interface CreateProjectRequest {
  name: string;
  instructions?: string;
  defaultRepoUrl?: string;
  defaultBranch?: string;
  defaultMode?: SessionMode;
  defaultModel?: ModelId;
  branding?: ProjectBranding;
}

export interface PatchProjectRequest {
  name?: string;
  instructions?: string;
  defaultRepoUrl?: string | null;
  defaultBranch?: string | null;
  defaultMode?: SessionMode;
  defaultModel?: ModelId;
  branding?: ProjectBranding | null;
}

export interface SendMessageRequest {
  text: string;
}

export interface PatchSessionRequest {
  mode?: SessionMode;
  model?: ModelId;
  title?: string;
  /** Attach/change the push target (no re-clone): repo + the caller's GitHub connection. */
  repoUrl?: string;
  branch?: string;
  githubConnectionId?: string;
}

export interface ProcessInfo {
  id: string;
  name: string;
  running: boolean;
  exitCode: number | null;
  startedAt: number;
}

export interface CustomCommand {
  name: string;
  description: string;
  template: string;
  createdAt: number;
  updatedAt: number;
}

export interface MemoryEntry {
  id: string;
  /** 'global' (every session) or a repo name like 'owner/repo' (that repo only) */
  scope: string;
  text: string;
  createdAt: number;
}

/** Expand a custom command template with positional + $ARGUMENTS substitution. */
export function expandTemplate(template: string, argString: string): string {
  const args = argString.trim().length ? argString.trim().split(/\s+/) : [];
  let out = template.replace(/\$ARGUMENTS\b/g, argString.trim());
  out = out.replace(/\$(\d+)/g, (_, n) => args[Number(n) - 1] ?? '');
  return out;
}

export interface SessionDetail {
  meta: SessionMeta;
  timeline: TimelineItem[];
}

/**
 * Free / consumer email providers — invites to an organization should use a
 * company address, so these are rejected (server-authoritative) and flagged in
 * the UI. ("for now": we block personal email outright.)
 */
export const FREE_EMAIL_DOMAINS = new Set<string>([
  'gmail.com', 'googlemail.com',
  'yahoo.com', 'yahoo.co.uk', 'yahoo.co.in', 'ymail.com', 'rocketmail.com',
  'hotmail.com', 'hotmail.co.uk', 'outlook.com', 'live.com', 'msn.com',
  'icloud.com', 'me.com', 'mac.com', 'aol.com',
  'proton.me', 'protonmail.com', 'pm.me',
  'gmx.com', 'gmx.net', 'mail.com', 'yandex.com', 'yandex.ru',
  'zoho.com', 'tutanota.com', 'tuta.io', 'hey.com', 'fastmail.com',
]);

/** The lowercased domain part of an email, or '' if it isn't one. */
export function emailDomain(email: string): string {
  const e = String(email ?? '').trim().toLowerCase();
  const at = e.lastIndexOf('@');
  return at >= 0 ? e.slice(at + 1) : '';
}

/** True if the email is on a free/consumer provider (gmail, outlook, …). */
export function isFreeEmailDomain(email: string): boolean {
  return FREE_EMAIL_DOMAINS.has(emailDomain(email));
}

// ---- Robots (standing email agents) ----
export type RobotRole = 'customer_service' | 'personal_assistant' | 'custom';
export type RobotStatus = 'draft' | 'active' | 'paused';
export type RobotAutonomy = 'shadow' | 'ask' | 'auto';
/** arksai-max = MiniMax M3, deepseek-v4 = DeepSeek, compare = run both (bake-off). */
export type RobotModel = 'arksai-max' | 'deepseek-v4' | 'compare';

export interface RobotConfig {
  /** Free-text persona / tone instructions for the robot. */
  persona?: string;
  /** Knowledge the robot can ground replies in (product info, policies, FAQ, your prefs). */
  knowledge?: string;
  /** Topics that must escalate to a human instead of being answered autonomously. */
  escalateOn?: string;
  /** Signature appended to outgoing replies. */
  signature?: string;
  /** Console fields: the department role the robot was hired under, its plain-language
   *  standing mandate, and the wake triggers chosen in the Hire flow. */
  dept?: string;
  mandate?: string;
  triggers?: string[];
}

export interface Robot {
  id: string;
  orgId: string;
  name: string;
  role: RobotRole;
  status: RobotStatus;
  autonomy: RobotAutonomy;
  model: RobotModel;
  config: RobotConfig;
  lastPolledAt: number | null;
  /** True when this robot has its own mailbox connected, enabled, and able to receive (IMAP). */
  mailboxReady: boolean;
  createdAt: number;
  updatedAt: number;
}

export type RobotDraftStatus = 'pending' | 'sent' | 'dismissed' | 'escalated';
export interface RobotDraft {
  id: string;
  robotId: string;
  orgId: string;
  inboundMessageId: string | null;
  inboundFrom: string;
  inboundName: string | null;
  inboundSubject: string | null;
  inboundSnippet: string | null;
  toAddr: string;
  subject: string;
  draftText: string;
  modelUsed: string | null;
  altText: string | null;
  altModel: string | null;
  escalated: boolean;
  escalationReason: string | null;
  status: RobotDraftStatus;
  createdAt: number;
  sentAt: number | null;
}

export interface CreateRobotRequest {
  name: string;
  role: RobotRole;
  model?: RobotModel;
  autonomy?: RobotAutonomy;
  config?: RobotConfig;
}
