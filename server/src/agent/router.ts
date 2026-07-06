import type { SessionMode } from '../../../shared/types';
import { MAX_MODEL, FAST_MODEL, SWIFT_MODEL, HEAVY_GLM51_MODEL } from '../../../shared/types';
import { config } from '../config';
import { byteplusConfigured } from './byteplusRuntime';

/** BytePlus (Dola/Swift) is available as the fast lane only when its key is configured
 *  (env ARK_API_KEY or the encrypted app_settings value loaded at boot). */
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
 * EXCEL_BAKEOFF.md round 2 (2026-07-06): seed-2-0-pro was the fastest model AND 4/4 on
 * semantic ground truth for exactly this class — route it to the Swift lane instead of the
 * heavy lane, where the same workbook took ~8 minutes. Guarded: any app/product subsystem
 * signal keeps the brief on normal routing (a SaaS build that exports xlsx is NOT this).
 */
export function isSpreadsheetBrief(task: string): boolean {
  const t = task.toLowerCase();
  if (!/\b(spreadsheet|workbook|xlsx|excel|financial model|cash[- ]?flow (model|projection|forecast)|budget (model|sheet)|amorti[sz]ation|3[- ]statement)\b/.test(t)) return false;
  if (/\b(app|website|web ?site|landing page|dashboard|api|backend|frontend|deck|pdf|report|video)\b/.test(t)) return false;
  // "36 monthly payments" / "billing schedule" are MODEL VOCABULARY in a spreadsheet brief,
  // not the payments/billing SUBSYSTEM (live: a loan brief routed Heavy on "payments").
  const scrubbed = task.replace(/\b(payments?|billing)\b/gi, '');
  return !new RegExp(SUBSYSTEM.source, 'i').test(scrubbed);
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
  // looped the failing render call — this work needs the heavy lane (M3).
  if (/\b(motion graphics|explainer video|animated (video|explainer|infographic)|render_motion_video)\b/.test(t)) score += 4;

  if (score <= 0) return 'light';
  if (score >= 3) return 'heavy';
  return 'standard';
}

export interface RouteOpts {
  /** Retained for signature stability; MiniMax is the only provider now (always true). */
  minimaxAvailable: boolean;
}

const tierModel = (tier: Tier, mode: SessionMode, _o: RouteOpts, task = ''): string => {
  // Spreadsheet-deliverable briefs → Swift (seed-2-0-pro): bake-off-verified equal accuracy
  // (4/4 ground truth, audit-clean) at a fraction of the heavy lane's latency. The pattern
  // dialect in generate_spreadsheet is what makes this safe — accuracy is enforced by the
  // audits, not by the slow model's carefulness.
  if (mode === 'code' && byteplusReady() && isSpreadsheetBrief(task)) return SWIFT_MODEL;
  // CODING = ALL-BYTEPLUS (operator decision 2026-07-02: "for coding remove M3 completely — stick
  // to GLM-5.1, it gives better output"). Light builds keep the validated Swift/Dola fast lane;
  // everything else in CODE mode is GLM-5.1. M3 is NOT a coding tier anymore — it remains only
  // (a) the no-key fallback so the product still works without BytePlus, (b) the emergency
  // fallback on a hard BytePlus API failure (resilience, not routing), and (c) the REPORT engine.
  if (mode === 'code' && byteplusReady()) return tier === 'light' ? SWIFT_MODEL : HEAVY_GLM51_MODEL;
  // Otherwise MiniMax: reports + no-key coding → M3 (Max); quick non-code light turns → Flash.
  if (mode === 'code' || mode === 'report') return MAX_MODEL;
  // CHAT light/standard → Swift (seed-2-0-pro): the 2026-07-02 judgment bake-off winner —
  // the ONLY model that correctly handled "make me an image" (clarify → generate, no
  // "I can't create images / use Canva" hallucination — the exact deployed lie), the best
  // repeat-error diagnosis (fixes the root cause itself instead of "escalating to IT"),
  // and the fastest (3.5–8s). Heavy chat stays on M3 (long-context reasoning).
  if (mode === 'chat' && tier !== 'heavy' && byteplusReady()) return SWIFT_MODEL;
  if (tier === 'light') return FAST_MODEL;
  return MAX_MODEL; // standard + heavy → M3
};

const LABELS: Record<string, string> = {
  [FAST_MODEL]: 'ArksAI Flash',
  [MAX_MODEL]: 'ArksAI Max',
  [SWIFT_MODEL]: 'ArksAI Swift',
  [HEAVY_GLM51_MODEL]: 'ArksAI Heavy',
};

/** Pick a concrete model for a task. Pure + deterministic so it's testable. */
export function selectModel(task: string, mode: SessionMode, o: RouteOpts): { model: string; tier: Tier; reason: string } {
  const tier = complexityTier(task, mode);
  const model = tierModel(tier, mode, o, task);
  const why =
    mode === 'code'
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

/** Escalate one notch when verification keeps failing or the model stalls.
 *  Coding is all-BytePlus: Swift escalates to GLM-5.1 (never M3); GLM-5.1 is the coding cap.
 *  M3 remains the cap only for MiniMax paths (chat/report). */
export function escalateModel(current: string, _o: RouteOpts): string {
  if (current === SWIFT_MODEL) return byteplusReady() ? HEAVY_GLM51_MODEL : MAX_MODEL;
  if (current === FAST_MODEL) return MAX_MODEL;
  return current; // GLM-5.1 (code) / M3 (report) are their lanes' caps
}

export type Provider = 'minimax' | 'byteplus';
export interface Resolved {
  provider: Provider;
  apiModel: string; // the id actually sent to the provider's API
  pricingId: string; // id used for cost lookup (branded, stable)
  baseUrl?: string; // optional per-model endpoint override (else the provider default)
}

/** Map a branded/selectable model id to the provider + API model + a stable pricing id.
 *  Swift → Dola on BytePlus; Max → M3, Flash → the fast MiniMax model; anything else → M3. */
export function resolveProvider(modelId: string): Resolved {
  if (modelId === SWIFT_MODEL) {
    return { provider: 'byteplus', apiModel: config.byteplusModel, pricingId: SWIFT_MODEL };
  }
  // Heavy-tier BytePlus coders (bake-off): branded id → concrete model, same adapter. Most run on
  // the coding endpoint; some carry a per-model base URL override (the general endpoint).
  const heavy = config.byteplusHeavyModels[modelId];
  if (heavy) {
    return { provider: 'byteplus', apiModel: heavy.model, pricingId: modelId, baseUrl: heavy.base };
  }
  if (modelId === FAST_MODEL) {
    return { provider: 'minimax', apiModel: config.minimaxFallbackModel, pricingId: FAST_MODEL };
  }
  return { provider: 'minimax', apiModel: config.minimaxModel, pricingId: MAX_MODEL };
}
