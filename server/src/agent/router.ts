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
const EASY =
  /\b(rename|typo|format|lint|comment|readme|hello world|simple|quick|small|tweak|adjust|change the (colou?r|text|label|title)|bump version|add a (button|link))\b/;

/** Cheap, free complexity estimate from the task text and mode. */
export function complexityTier(task: string, mode: SessionMode): Tier {
  const t = task.toLowerCase();
  let score = 0;

  if (task.length > 800) score += 2;
  else if (task.length > 240) score += 1;
  // multi-step asks (bulleted/numbered lists or many lines)
  if (/\n\s*([-*]|\d+[.)])\s/.test(task) || task.split('\n').length > 6) score += 1;
  if (HARD.test(t)) score += 2;
  if (EASY.test(t)) score -= 1;
  if (mode === 'code') score += 1;
  else if (mode === 'chat') score -= 1;

  if (score <= 0) return 'light';
  if (score >= 3) return 'heavy';
  return 'standard';
}

export interface RouteOpts {
  /** Retained for signature stability; MiniMax is the only provider now (always true). */
  minimaxAvailable: boolean;
}

const tierModel = (tier: Tier, mode: SessionMode, _o: RouteOpts): string => {
  // CODING = ALL-BYTEPLUS (operator decision 2026-07-02: "for coding remove M3 completely — stick
  // to GLM-5.1, it gives better output"). Light builds keep the validated Swift/Dola fast lane;
  // everything else in CODE mode is GLM-5.1. M3 is NOT a coding tier anymore — it remains only
  // (a) the no-key fallback so the product still works without BytePlus, (b) the emergency
  // fallback on a hard BytePlus API failure (resilience, not routing), and (c) the REPORT engine.
  if (mode === 'code' && byteplusReady()) return tier === 'light' ? SWIFT_MODEL : HEAVY_GLM51_MODEL;
  // Otherwise MiniMax: reports + no-key coding → M3 (Max); quick non-code light turns → Flash.
  if (mode === 'code' || mode === 'report') return MAX_MODEL;
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
  const model = tierModel(tier, mode, o);
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
