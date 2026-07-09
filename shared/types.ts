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
/** ByteDance Dola-Seed-2.0-pro (BytePlus coding plan) — the fast lane for simple builds.
 *  Only used when BytePlus is configured; otherwise simple builds stay on MiniMax. */
export const SWIFT_MODEL = 'arksai-swift';
export const isAutoModel = (id: string): boolean => id === AUTO_MODEL;

/** Heavy-tier BytePlus coders under evaluation for the heavy build lane (bake-off vs M3).
 *  Selectable-by-id (not advertised in the default lineup) only when BytePlus is configured;
 *  each maps to a concrete BytePlus coding-plan model via config.byteplusHeavyModels. */
export const HEAVY_GLM_MODEL = 'arksai-heavy-glm';
export const HEAVY_GLM51_MODEL = 'arksai-heavy-glm51';
export const HEAVY_KIMI_MODEL = 'arksai-heavy-kimi';
export const HEAVY_DS4_MODEL = 'arksai-heavy-ds4';
export const HEAVY_SEEDCODE_MODEL = 'arksai-heavy-code';
export const HEAVY_BYTEPLUS_MODELS = [HEAVY_GLM_MODEL, HEAVY_GLM51_MODEL, HEAVY_KIMI_MODEL, HEAVY_DS4_MODEL, HEAVY_SEEDCODE_MODEL];

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
  // ArksAI Swift = Dola-Seed-2.0-pro on the BytePlus coding plan (flat-rate). Nominal per-token
  // estimate for the cost bar (the plan is flat, so marginal cost is ~0); tune to the plan.
  'arksai-swift': { label: 'ArksAI Swift', inputCacheHitPerM: 0.03, inputCacheMissPerM: 0.14, outputPerM: 0.28 },
  // Heavy-tier BytePlus coders (bake-off vs M3). Prices per BytePlus console (June 2026), per 1M tokens.
  'arksai-heavy-glm': { label: 'ArksAI Heavy (GLM-4.7)', inputCacheHitPerM: 0.11, inputCacheMissPerM: 0.6, outputPerM: 2.2 },
  'arksai-heavy-glm51': { label: 'ArksAI Heavy (GLM-5.1)', inputCacheHitPerM: 0.22, inputCacheMissPerM: 1.2, outputPerM: 4.0 },
  'arksai-heavy-kimi': { label: 'ArksAI Heavy (Kimi-K2.5)', inputCacheHitPerM: 0.12, inputCacheMissPerM: 0.6, outputPerM: 2.5 },
  'arksai-heavy-ds4': { label: 'ArksAI Heavy (DeepSeek-V4-pro)', inputCacheHitPerM: 0.145, inputCacheMissPerM: 1.74, outputPerM: 3.48 },
  'arksai-heavy-code': { label: 'ArksAI Heavy (Seed-2.0-Code)', inputCacheHitPerM: 0.2, inputCacheMissPerM: 1.0, outputPerM: 4.0 },
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
  /** The user who created the session — resolves per-user connections (GitHub, Google). */
  createdBy?: string | null;
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
  | {
      kind: 'assistant';
      id: string;
      text: string;
      ts: number;
      /** Wall-clock the run took to produce this output (ms), set on the run's FINAL
       *  assistant message — so the user sees "Completed in 3m 12s". Persisted in the
       *  timeline JSON, so it survives reload. */
      durationMs?: number;
    }
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
      /** The durable build-plan trail: every committed checkpoint (auto or model-called),
       *  so the UI can show "step N done" for a long build — and prove it's resumable. */
      type: 'checkpoint_update';
      steps: Array<{ task: string; sha: string; ts: number }>;
    }
  | {
      type: 'run_finished';
      runId: string;
      status: SessionStatus;
      totalTokens: number;
      diffStat: string | null;
      /** Wall-clock from run start (user input) to finish (output), in ms — so the
       *  live view can show "Completed in 3m 12s" without a reload. */
      durationMs: number;
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

/** Org wallet summary (USD canonical + the org's display currency). */
export interface WalletView {
  orgId: string;
  currency: string;
  pegged: boolean;
  fxRate: number;
  fxAsOf: number | null;
  fxSource: string;
  balanceUsd: number;
  balanceMicros: number;
  balanceDisplay: string;
  balanceUsdDisplay: string;
  balanceBasis: string;
  lowBalance: boolean;
  enforced: boolean;
  providers: { id: string }[];
}
export interface WalletLedgerEntry {
  id: string;
  ts: number;
  type: string;
  source: string;
  ref: string | null;
  note: string | null;
  amountUsd: number;
  amountUsdDisplay: string;
  amountDisplay: string;
  balanceAfterUsd: number;
  balanceAfterDisplay: string;
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
// 'verifying' = booted and under its pre-launch review; not advertised as live until it passes.
export type DeploymentStatus = 'running' | 'stopped' | 'error' | 'verifying';

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
/** The KIND of robot — drives its console view + runtime. Email is implemented; the rest are
 *  declared so the host/registry can route them as they're built. */
export type RobotType = 'email' | 'scheduled' | 'ads' | 'monitor' | 'social';
export type RobotStatus = 'draft' | 'active' | 'paused';
export type RobotAutonomy = 'shadow' | 'ask' | 'auto';
/** arksai-max = MiniMax M3, deepseek-v4 = DeepSeek, compare = run both (bake-off). */
export type RobotModel = 'arksai-max' | 'deepseek-v4' | 'compare';

export interface RobotConfig {
  /** Free-text persona / tone instructions for the robot. */
  persona?: string;
  /** A reusable org persona this robot speaks as (robot_personas.id). Free-text `persona` wins. */
  personaId?: string;
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
  /** Owner pings to notify-enabled commanders: escalations only (default), everything
   *  awaiting approval, or off. */
  notify?: 'escalations' | 'all' | 'off';
  /** Voice replies on chat channels: mirror the sender (default — speak only when they
   *  sent a voice note), always speak, or never. */
  voiceReplies?: 'mirror' | 'always' | 'off';
  /** Studio tools (make an image/creative/document/spreadsheet/chart, find photos) in the
   *  reply lane: available to the owner's commander addresses (default), to everyone the
   *  robot talks to, or off. Heavy builds always go through the commander build lane. */
  replyTools?: 'commanders' | 'everyone' | 'off';
  /** AUTONOMY SLIDER (0–100) for a Social Media Manager robot — the single control over how
   *  much it does on its own: replies to comments, publishes posts, runs ads. See
   *  server/src/robots/autonomy.ts. Default 30 ("Ask first"). */
  autonomyLevel?: number;
  /** Hard daily ad-spend cap in USD (Track C). No launch/budget change may exceed it. */
  adDailyCapUsd?: number;
  /** Hard per-campaign lifetime ad-spend cap in USD (Track C). */
  adCampaignCapUsd?: number;
}

// ---- Robot channels (beyond email: chat/SMS auto-responders) ----
export type RobotChannelKind = 'telegram' | 'whatsapp' | 'sms' | 'meta';
/** Where a draft/conversation lives — email plus the chat/SMS channels. */
export type RobotDraftChannel = 'email' | RobotChannelKind;

/** A connected messaging channel for one robot. Secrets (bot token / access token / API
 *  password) are AES-256-GCM encrypted at rest and WRITE-ONLY over the API — the client
 *  only ever sees `hasSecrets` + the non-secret meta. */
export interface RobotChannel {
  id: string;
  robotId: string;
  orgId: string;
  kind: RobotChannelKind;
  label: string | null;
  /** Non-secret, kind-specific settings (safe to show):
   *  telegram: botUsername; whatsapp: phoneNumberId, verifyToken;
   *  sms: provider ('smsala'), senderId, channelNumber, hookKey (inbound URL key). */
  meta: Record<string, string>;
  enabled: boolean;
  hasSecrets: boolean;
  verifiedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

/** An org-level reusable persona a robot can speak as. */
export interface RobotPersona {
  id: string;
  orgId: string;
  name: string;
  description: string | null;
  /** The voice/tone/behavior text folded into the reply prompt. */
  voice: string;
  language: string | null;
  signature: string | null;
  createdAt: number;
  updatedAt: number;
}

/** One knowledge document a robot grounds its replies in (extracted text). */
export interface RobotKbDoc {
  id: string;
  robotId: string;
  orgId: string;
  name: string;
  /** Extracted text size (chars) — the text itself stays server-side. */
  chars: number;
  createdAt: number;
}

/** A trusted commander identity — the OWNER's own address on a channel. Only messages
 *  from a listed commander can trigger builds or name delivery destinations; a commander
 *  row also doubles as an owner-NOTIFICATION target (escalation pings) when notify is on. */
export interface RobotCommander {
  id: string;
  robotId: string;
  orgId: string;
  channel: RobotDraftChannel;
  address: string;
  label: string | null;
  /** Receive owner pings (escalations / approvals) at this address. */
  notify: boolean;
  createdAt: number;
}

/** A proactive routine: a scheduled DIGEST of the robot's activity, or a recurring BRIEF
 *  (a build run on schedule and delivered on a channel). */
export type RobotJobKind = 'digest' | 'brief';
export interface RobotJob {
  id: string;
  robotId: string;
  orgId: string;
  kind: RobotJobKind;
  cadence: 'daily' | 'weekly' | 'interval';
  atTime: string | null; // "HH:MM" for daily/weekly
  weekday: number | null; // 0-6 for weekly
  tz: string | null;
  intervalMs?: number | null;
  prompt: string | null; // the brief for kind='brief'
  deliverTo: { channel: RobotDraftChannel; address: string }[];
  enabled: boolean;
  nextRunAt: number;
  lastRunAt: number | null;
  createdAt: number;
}

/** An org-defined HTTPS action the robot may take mid-reply (order lookup, stock check…).
 *  'ask' escalates for approval; 'auto' executes (logged + rate-capped). */
export interface RobotAction {
  id: string;
  robotId: string;
  orgId: string;
  name: string;
  description: string;
  method: 'GET' | 'POST';
  urlTemplate: string;
  /** Declared parameters the model may fill ({{name}} slots). */
  params: { name: string; description: string }[];
  bodyTemplate: string | null;
  mode: 'ask' | 'auto';
  cleanUses: number;
  enabled: boolean;
  hasHeaders: boolean;
  createdAt: number;
}

/** Aggregated per-robot performance stats (derived server-side; content never leaves). */
export interface RobotStats {
  total: number;
  sent: number;
  escalated: number;
  pending: number;
  dismissed: number;
  /** sent / (sent + escalated) — how much it handles without a human. */
  deflectionRate: number | null;
  medianResponseMs: number | null;
  byChannel: Record<string, number>;
  /** Last 14 days, oldest first: [epochDay, drafted, sent]. */
  byDay: [number, number, number][];
  tasks: { delivered: number; error: number; running: number };
  actions: { calls: number; failures: number };
}

export type RobotTaskStatus = 'running' | 'delivering' | 'delivered' | 'error';
/** A build the robot is running on a commander's instruction (spawns a real session). */
export interface RobotTask {
  id: string;
  robotId: string;
  orgId: string;
  channel: RobotDraftChannel;
  commander: string;
  request: string;
  sessionId: string;
  status: RobotTaskStatus;
  deliverTo: { channel: RobotDraftChannel; address: string }[];
  artifacts: string[];
  error: string | null;
  createdAt: number;
  /** When a delivered task was sent back for a revision (deliver-only-newer anchor). */
  revisedAt: number | null;
  finishedAt: number | null;
}

export interface Robot {
  id: string;
  orgId: string;
  name: string;
  /** The robot KIND — routes its console + runtime. Defaults to 'email' for existing robots. */
  type: RobotType;
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

export type RobotDraftStatus = 'pending' | 'sent' | 'dismissed' | 'escalated' | 'snoozed' | 'archived';
export interface RobotDraft {
  id: string;
  robotId: string;
  orgId: string;
  inboundMessageId: string | null;
  inboundFrom: string;
  inboundName: string | null;
  inboundSubject: string | null;
  inboundSnippet: string | null;
  /** Full inbound body (for the responder); snippet stays for the compact feed. */
  inboundBody: string | null;
  /** Which channel this conversation lives on (send dispatches accordingly). */
  channel: RobotDraftChannel;
  /** Meeting-invite lane: a prepared iCal METHOD:REPLY, attached when the draft sends. */
  icsReply?: string | null;
  /** Files studio tools produced for this reply — delivered with the send. */
  attachments?: string[] | null;
  /** When snoozed, the epoch ms it returns to "needs you". */
  snoozeUntil?: number | null;
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

/** A learned preference: "when an email is like {pattern}, {instruction}". Grounding data
 *  injected into the reply prompt so the robot handles that kind of mail itself. */
export interface RobotRule {
  id: string;
  robotId: string;
  orgId: string;
  pattern: string;
  instruction: string;
  enabled: boolean;
  createdAt: number;
}

export interface CreateRobotRequest {
  name: string;
  type?: RobotType;
  role: RobotRole;
  model?: RobotModel;
  autonomy?: RobotAutonomy;
  config?: RobotConfig;
}

/** One org-scoped read of everything the Home/Workspace + Activity surfaces need to
 *  show "what's running for you" and "what needs you" — aggregated server-side so the
 *  client makes a single call instead of fanning out. All lists are filtered to the
 *  caller's org (never the client's claim). */
export interface HomeSnapshot {
  /** Live + recent deployments (the client derives failed = status==='error'). */
  deployments: Deployment[];
  schedules: Schedule[];
  robots: Robot[];
  /** Robot reply drafts awaiting the user's approval. */
  pendingDrafts: RobotDraft[];
}

/** Read-only git state of a session's workspace — surfaced so the user can SEE whether
 *  their code is committed and pushed to the connected repo (never had to guess). */
export interface GitStatus {
  /** Is the workspace an initialized git repo? */
  hasRepo: boolean;
  /** Current branch name (empty if unknown / detached). */
  branch: string;
  /** The HEAD commit, or null if nothing is committed yet. */
  head: { sha: string; subject: string } | null;
  /** Count of uncommitted (staged + unstaged + untracked) changes. */
  dirty: number;
  /** The last successful push from this workspace, or null if it was never pushed. */
  lastPush: { sha: string; branch: string; at: string } | null;
  /** True when the current HEAD has been pushed and there are no pending changes. */
  pushed: boolean;
}

/** A user's rating of something the agent produced (a deliverable or a reply). */
export interface Feedback {
  id: string;
  orgId: string | null;
  sessionId: string;
  messageId: string | null;
  kind: 'deliverable' | 'reply' | 'app';
  rating: 'up' | 'down';
  /** The user's own words about what's wrong (down only). */
  complaint: string | null;
  /** Non-content context: mode, task, deliverable kind, name. */
  meta: Record<string, string> | null;
  status: 'new' | 'reviewed' | 'dismissed';
  createdAt: number;
}

export interface CreateFeedbackRequest {
  messageId?: string;
  kind: Feedback['kind'];
  rating: Feedback['rating'];
  complaint?: string;
  meta?: Record<string, string>;
}

/** Map git state → a short status chip (tone + text) for the repo bar. Pure + unit-tested. */
export function describeGitState(s: GitStatus): { tone: 'ok' | 'pending' | 'idle'; text: string } {
  if (!s.hasRepo) return { tone: 'idle', text: 'No repo yet' };
  if (s.dirty > 0) return { tone: 'pending', text: `${s.dirty} uncommitted change${s.dirty === 1 ? '' : 's'}` };
  if (s.head && s.pushed) return { tone: 'ok', text: `Pushed · ${s.head.sha}` };
  if (s.head) return { tone: 'pending', text: `Committed, not pushed · ${s.head.sha}` };
  return { tone: 'idle', text: 'Nothing committed yet' };
}
