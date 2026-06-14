/**
 * Shared contract between server and client.
 * The AgentEvent union drives the server emitter, the SSE payloads and the
 * client timeline reducer — change it here and both sides follow.
 */

export type SessionMode = 'chat' | 'plan' | 'code' | 'report';
export type SessionStatus = 'idle' | 'running' | 'done' | 'error';
/** Any DeepSeek model id. The selectable list is fetched live from /api/models. */
export type ModelId = string;

export const SESSION_MODES: SessionMode[] = ['chat', 'plan', 'code', 'report'];

export const DEFAULT_MODEL = 'deepseek-v4-flash';
/** Used when the live model list can't be fetched. */
export const FALLBACK_MODEL_IDS = ['deepseek-v4-flash', 'deepseek-v4-pro'];
/** Kept for older imports; the live list supersedes it. */
export const MODELS: ModelId[] = FALLBACK_MODEL_IDS;

/** Virtual model: the orchestrator picks the concrete model per task. */
export const AUTO_MODEL = 'arksai-auto';
/** Branded id for the MiniMax LLM engine (routable + directly selectable). */
export const MAX_MODEL = 'arksai-max';
export const isAutoModel = (id: string): boolean => id === AUTO_MODEL;

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
 * DeepSeek pricing in USD per 1M tokens, matching the live platform exactly,
 * including the cache-hit input tier. Source:
 * https://api-docs.deepseek.com/quick_start/pricing. Update if it changes.
 */
const DEFAULT_PRICING: ModelPricing = {
  label: 'unknown',
  inputCacheHitPerM: 0.0028,
  inputCacheMissPerM: 0.14,
  outputPerM: 0.28,
};
// UI labels are ArksAI-branded (the underlying provider/model id is internal).
// As we add other engines (e.g. music via Suno), they get ArksAI labels here too.
export const KNOWN_MODELS: Record<string, ModelPricing> = {
  'deepseek-v4-flash': { label: 'ArksAI Flash', inputCacheHitPerM: 0.0028, inputCacheMissPerM: 0.14, outputPerM: 0.28 },
  'deepseek-v4-pro': { label: 'ArksAI Pro', inputCacheHitPerM: 0.003625, inputCacheMissPerM: 0.435, outputPerM: 0.87 },
  // Orchestrated options. 'arksai-auto' is virtual (cost is computed against the
  // concrete model the router actually used). 'arksai-max' = MiniMax LLM;
  // pricing is an estimate until validated against MiniMax billing.
  'arksai-auto': { label: 'ArksAI Auto', inputCacheHitPerM: 0.0028, inputCacheMissPerM: 0.14, outputPerM: 0.28 },
  'arksai-max': { label: 'ArksAI Max', inputCacheHitPerM: 0.2, inputCacheMissPerM: 0.2, outputPerM: 1.1 },
  // legacy aliases
  'deepseek-chat': { label: 'ArksAI Flash', inputCacheHitPerM: 0.0028, inputCacheMissPerM: 0.14, outputPerM: 0.28 },
  'deepseek-reasoner': { label: 'ArksAI Flash (reasoning)', inputCacheHitPerM: 0.0028, inputCacheMissPerM: 0.14, outputPerM: 0.28 },
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

/** Cost in USD mirroring DeepSeek billing, accounting for cached input tokens. */
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
  projectId: string | null;
  repoUrl: string | null;
  repoName: string | null;
  branch: string | null;
  mode: SessionMode;
  model: ModelId;
  status: SessionStatus;
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
      type: 'run_finished';
      runId: string;
      status: SessionStatus;
      totalTokens: number;
      diffStat: string | null;
    }
  | { type: 'run_error'; runId: string; message: string }
  | { type: 'session_meta_updated'; meta: Partial<SessionMeta> & { id: string } }
  | { type: 'timeline_item'; item: TimelineItem }
  | { type: 'open_canvas'; port?: number; file?: string; kind?: 'app' | 'pdf' | 'sheet' | 'doc' }
  | { type: 'clone_progress'; phase: 'cloning' | 'done' | 'error'; detail: string };

/** Lightweight event broadcast on the global channel for the sidebar. */
export type GlobalEvent = { type: 'session_status'; session: SessionMeta } | {
  type: 'session_deleted';
  sessionId: string;
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
