import type { SessionMode } from '../../../shared/types';
import { MAX_MODEL, FAST_MODEL, SWIFT_MODEL, HEAVY_GLM51_MODEL, HEAVY_DS4_MODEL, HEAVY_GLM_MODEL, HEAVY_SEEDCODE_MODEL } from '../../../shared/types';
import { config } from '../config';
import { byteplusConfigured } from './byteplusRuntime';

/** ModelArk (every model lane) is usable once its key is configured (env ARK_API_KEY or the
 *  encrypted app_settings value loaded at boot). */
export const byteplusReady = (): boolean => byteplusConfigured();

export type Tier = 'light' | 'standard' | 'heavy';

const HARD =
  /\b(architect|design|refactor|migrat|optimi[sz]|concurren|distribut|debug|race condition|deadlock|security|vulnerab|scalab|algorithm|performance|end[- ]?to[- ]?end|full[- ]?stack|microservice|database schema|state machine|implement (an?|the) [\w-]+ (system|service|pipeline|engine|compiler|parser)|build (an?|the) [\w-]+ (app|api|backend|platform))\b/;
// Product-scale signals — each is a whole SUBSYSTEM (auth, tenancy, billing, realtime…), and a
// brief that stacks several is a big build even when the prose is short. The TaskForge brief
// ("multi-tenant SaaS…JWT auth…orgs…invite…isolation") scored 'standard' under the old regexes.
const SUBSYSTEM =
  /\b(multi[- ]?tenant|multi[- ]?org|saas|jwt|oauth|signup\/login|login\/signup|authenticat|authoriz|role[s]?[- ](based|and)|permission|workspace|organi[sz]ations?|invite (code|members)|per[- ]org|isolation|realtime|websocket|payments?|stripe|billing|subscription|admin (panel|dashboard)|kanban|drag[- ]and[- ]drop)\b/gi;
const EASY =
  /\b(rename|typo|format|lint|comment|readme|hello world|simple|quick|small|tweak|adjust|change the (colou?r|text|label|title)|bump version|add a (button|link))\b/;

/**
 * A brief whose DELIVERABLE is a spreadsheet/financial model (not an app that mentions one).
 * Routed to the bounded-reasoning spreadsheet lane (HEAVY_DS4 — the 2026-10-20 bake-off winner
 * for financial models) in chat AND code. Guarded: any app/product subsystem signal keeps the
 * brief on normal routing (a SaaS build that exports xlsx is NOT this).
 */
export function isSpreadsheetBrief(task: string): boolean {
  // "excel at/in/as" is the verb, not the product ("how do I excel at interviews?").
  const t = task.toLowerCase().replace(/\bexcel(?:s|led|ling)? (?:at|in|as)\b/g, '');
  if (!/\b(spreadsheet|workbook|xlsx|excel|financial model|cash[- ]?flow (model|projection|forecast)|budget (model|sheet)|amorti[sz]ation|3[- ]statement)\b/.test(t)) return false;
  // "dashboard" is deliberately NOT an excluding word: reaching this line means the brief
  // already named a spreadsheet deliverable, and "an Excel KPI dashboard" IS one (the
  // kpi-dashboard scaffold) — a web dashboard brief still excludes via app/website/frontend.
  if (/\b(app|website|web ?site|landing page|api|backend|frontend|deck|pdf|report|video)\b/.test(t)) return false;
  // "36 monthly payments" / "billing schedule" are MODEL VOCABULARY in a spreadsheet brief,
  // not the payments/billing SUBSYSTEM (live: a loan brief routed Heavy on "payments").
  const scrubbed = task.replace(/\b(payments?|billing)\b/gi, '');
  return !new RegExp(SUBSYSTEM.source, 'i').test(scrubbed);
}

// A CHAT message names a spreadsheet as something to PRODUCE or change — not a question about one
// ("what is a cash flow forecast?" stays on the quick lane).
const SHEET_INTENT =
  /\b(make|create|build|generate|draft|prepare|produce|put together|set up|give me|send me|i need|we need|need an?|want an?|turn|convert|update|change|edit|add|fix|redo|rebuild|recalculate|extend)\b/i;

/** A chat message asking for a spreadsheet DELIVERABLE (isSpreadsheetBrief + an intent to make
 *  or change one). Chat makes these directly with generate_spreadsheet, so they need the
 *  bounded-reasoning lane — but a question that merely mentions Excel must not pay for it. */
export function isChatSpreadsheetAsk(task: string): boolean {
  return isSpreadsheetBrief(task) && SHEET_INTENT.test(task);
}

/** Cheap, free complexity estimate from the task text and mode. */
export function complexityTier(task: string, mode: SessionMode): Tier {
  const t = task.toLowerCase();
  let score = 0;

  if (task.length > 800) score += 2;
  else if (task.length > 240) score += 1;
  // multi-step asks (bulleted/numbered lists or many lines)
  if (/\n\s*([-*]|\d+[.)])\s/.test(task) || task.split('\n').length > 6) score += 1;
  // enumerated REQUIREMENT clusters — "(1) BACKEND… (2) DATA… (3) FRONTEND…" style briefs
  if ((task.match(/\(\d\)/g) || []).length >= 3) score += 1;
  if (HARD.test(t)) score += 2;
  // 2+ distinct subsystems stacked in one brief = a genuinely large build
  const subsystems = new Set((task.match(SUBSYSTEM) || []).map((s) => s.toLowerCase()));
  if (subsystems.size >= 2) score += 2;
  else if (subsystems.size === 1) score += 1;
  if (EASY.test(t)) score -= 1;
  if (mode === 'code') score += 1;
  else if (mode === 'chat') score -= 1;
  // Motion-graphics production = authoring MANY designed scene files + a long tool workflow.
  // Seen live 2026-07-04: Swift claimed it wrote the scene files without writing them, then
  // looped the failing render call — this work needs the heavy lane (Max).
  if (/\b(motion graphics|explainer video|animated (video|explainer|infographic)|render_motion_video)\b/.test(t)) score += 4;

  // META AD-ACCOUNT OPERATIONS = high-stakes, real-money, multi-step Graph API work. Seen
  // live 2026-07-13: the Swift fast lane hand-rolled a broken campaign and HALLUCINATED
  // success (fake campaign id, fake pages, "created" objects that never existed). This work
  // needs the heavy lane (Max) — careful multi-step tool use + honest failure reporting.
  if (/\b(campaign|ad ?set|ad account|launch (an? )?ad|run (an? )?ad|boost (the |this )?post|facebook ads?|meta ads?|instagram ads?|advertis)/.test(t)) score += 4;

  if (score <= 0) return 'light';
  if (score >= 3) return 'heavy';
  return 'standard';
}

export interface RouteOpts {
  /** Reserved for future routing inputs (ModelArk is the only provider). */
  [k: string]: unknown;
}

const tierModel = (tier: Tier, mode: SessionMode, _o: RouteOpts, task = ''): string => {
  // Spreadsheet/financial-model deliverables → the bounded-reasoning lane (round-2 bake-off winner,
  // 7.5; thinking-off scored 1.25 — it produces broken models). Accuracy is also enforced by the
  // generate_spreadsheet pattern dialect + audits. CHAT too: the chat prompt has the agent call
  // generate_spreadsheet right there, so a chat spreadsheet must never land on thinking-off Swift.
  if (mode === 'code' ? isSpreadsheetBrief(task) : mode === 'chat' && isChatSpreadsheetAsk(task)) return HEAVY_DS4_MODEL;
  // CODING: every build runs the heavy coder with FULL reasoning — the bake-off showed even a
  // simple app loses quality without it (8.5 → 6.0). Quality first; long-but-healthy turns get a
  // progress line and can never hang (content-based idle deadline).
  if (mode === 'code') return HEAVY_GLM51_MODEL;
  // REPORTS (designed PDFs/decks) → Max.
  if (mode === 'report') return MAX_MODEL;
  // CHAT light/standard → Swift (thinking off): the chat-routing bake-off winner (clarifies vague
  // asks, routes images to generate_*, never claims it can't) and the fastest. Heavy → Max.
  if (mode === 'chat' && tier !== 'heavy') return SWIFT_MODEL;
  if (tier === 'light') return FAST_MODEL;
  return MAX_MODEL;
};

const LABELS: Record<string, string> = {
  [FAST_MODEL]: 'ArksAI Flash',
  [MAX_MODEL]: 'ArksAI Max',
  [SWIFT_MODEL]: 'ArksAI Swift',
  [HEAVY_GLM51_MODEL]: 'ArksAI Heavy',
  [HEAVY_DS4_MODEL]: 'ArksAI Heavy',
};

/** Pick a concrete model for a task. Pure + deterministic so it's testable. */
export function selectModel(task: string, mode: SessionMode, o: RouteOpts = {}): { model: string; tier: Tier; reason: string } {
  const tier = complexityTier(task, mode);
  const model = tierModel(tier, mode, o, task);
  const why =
    model === HEAVY_DS4_MODEL
      ? 'a spreadsheet model'
      : mode === 'code'
        ? tier === 'heavy'
          ? 'a complex build'
          : tier === 'light'
            ? 'a quick build'
            : 'coding'
        : model === MAX_MODEL && mode === 'report'
          ? 'a designed deliverable'
          : tier === 'light'
            ? 'a quick task'
            : tier === 'standard'
              ? 'a moderate task'
              : 'a complex task';
  return { model, tier, reason: `${LABELS[model] ?? model} — ${why}` };
}

/** Escalate one notch when verification keeps failing. Swift → the heavy coder; Flash → Max.
 *  The heavy coder (code) and Max (chat/report) are their lanes' caps. */
export function escalateModel(current: string, _o: RouteOpts = {}): string {
  if (current === SWIFT_MODEL) return HEAVY_GLM51_MODEL;
  if (current === FAST_MODEL) return MAX_MODEL;
  return current;
}

/**
 * Alternate engines to try when the active one goes SILENT mid-stream or hard-fails: every
 * branded lane, ordered by preference for the current one, keeping only lanes whose CONCRETE
 * model differs from the current one (switching to an alias of the same model wouldn't help).
 * PURE (unit-tested); the run loop walks it.
 */
export function stallLadder(current: string): string[] {
  // Alternates first (GLM-5.2, Seed), then the main lanes — whatever they currently resolve to.
  const prefs = [HEAVY_GLM_MODEL, HEAVY_SEEDCODE_MODEL, MAX_MODEL, HEAVY_GLM51_MODEL, SWIFT_MODEL, HEAVY_DS4_MODEL, FAST_MODEL];
  const seen = new Set([resolveProvider(current).apiModel]);
  const out: string[] = [];
  for (const id of prefs) {
    const api = resolveProvider(id).apiModel;
    if (seen.has(api)) continue;
    seen.add(api);
    out.push(id);
  }
  return out;
}

export type Provider = 'modelark';
export interface Resolved {
  provider: Provider;
  apiModel: string; // the id actually sent to ModelArk
  pricingId: string; // id used for cost lookup (branded, stable)
  baseUrl?: string; // optional per-model endpoint override (else the coding-plan endpoint)
  thinking?: 'enabled' | 'disabled'; // lane reasoning control (omitted = the model default)
  effort?: 'minimal' | 'low' | 'medium' | 'high'; // reasoning_effort (bounds reasoning length)
}

/** Map a branded model id to its concrete ModelArk model. Unknown ids → Max. */
export function resolveProvider(modelId: string): Resolved {
  const lane = config.modelarkModels[modelId];
  const id = lane ? modelId : MAX_MODEL;
  const m = lane ?? config.modelarkModels[MAX_MODEL];
  return { provider: 'modelark', apiModel: m.model, pricingId: id, baseUrl: m.base, thinking: m.thinking, effort: m.effort };
}
