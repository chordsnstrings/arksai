import type { SessionMode } from '../../../shared/types';
import { MAX_MODEL, FAST_MODEL } from '../../../shared/types';
import { config } from '../config';

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
  // All MiniMax now. Quality/agentic/designed work → M3 (Max). Quick/light turns →
  // the fast model (Flash). The runner falls M3 → Flash within MiniMax if M3 stalls.
  if (mode === 'code' || mode === 'report') return MAX_MODEL;
  if (tier === 'light') return FAST_MODEL;
  return MAX_MODEL; // standard + heavy → M3
};

const LABELS: Record<string, string> = {
  [FAST_MODEL]: 'ArksAI Flash',
  [MAX_MODEL]: 'ArksAI Max',
};

/** Pick a concrete model for a task. Pure + deterministic so it's testable. */
export function selectModel(task: string, mode: SessionMode, o: RouteOpts): { model: string; tier: Tier; reason: string } {
  const tier = complexityTier(task, mode);
  const model = tierModel(tier, mode, o);
  const why =
    model === MAX_MODEL && (mode === 'code' || mode === 'report')
      ? mode === 'code'
        ? 'coding'
        : 'a designed deliverable'
      : tier === 'light'
        ? 'a quick task'
        : tier === 'standard'
          ? 'a moderate task'
          : 'a complex task';
  return { model, tier, reason: `${LABELS[model] ?? model} — ${why}` };
}

/** Escalate one notch when verification keeps failing or the model stalls. */
export function escalateModel(current: string, _o: RouteOpts): string {
  if (current === FAST_MODEL) return MAX_MODEL;
  return current; // M3 is already the top
}

export type Provider = 'minimax';
export interface Resolved {
  provider: Provider;
  apiModel: string; // the id actually sent to the provider's API
  pricingId: string; // id used for cost lookup (branded, stable)
}

/** Map a branded/selectable model id to the MiniMax API model + a stable pricing id.
 *  Max → M3, Flash → the fast model; anything else defaults to M3. */
export function resolveProvider(modelId: string): Resolved {
  if (modelId === FAST_MODEL) {
    return { provider: 'minimax', apiModel: config.minimaxFallbackModel, pricingId: FAST_MODEL };
  }
  return { provider: 'minimax', apiModel: config.minimaxModel, pricingId: MAX_MODEL };
}
