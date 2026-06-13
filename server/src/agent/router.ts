import type { SessionMode } from '../../../shared/types';
import { MAX_MODEL } from '../../../shared/types';
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
  minimaxAvailable: boolean;
}

const tierModel = (tier: Tier, o: RouteOpts): string => {
  if (tier === 'light') return 'deepseek-v4-flash';
  if (tier === 'standard') return 'deepseek-v4-pro';
  // heavy: prefer MiniMax for the hardest tasks, else the strongest DeepSeek.
  return o.minimaxAvailable ? MAX_MODEL : 'deepseek-v4-pro';
};

const LABELS: Record<string, string> = {
  'deepseek-v4-flash': 'ArksAI Flash',
  'deepseek-v4-pro': 'ArksAI Pro',
  [MAX_MODEL]: 'ArksAI Max',
};

/** Pick a concrete model for a task. Pure + deterministic so it's testable. */
export function selectModel(task: string, mode: SessionMode, o: RouteOpts): { model: string; tier: Tier; reason: string } {
  const tier = complexityTier(task, mode);
  const model = tierModel(tier, o);
  const why = tier === 'light' ? 'a quick task' : tier === 'standard' ? 'a moderate task' : 'a complex task';
  return { model, tier, reason: `${LABELS[model] ?? model} — ${why}` };
}

/** Escalate one notch when verification keeps failing or the model stalls. */
export function escalateModel(current: string, o: RouteOpts): string {
  if (current === 'deepseek-v4-flash') return 'deepseek-v4-pro';
  if (current === 'deepseek-v4-pro') return o.minimaxAvailable ? MAX_MODEL : 'deepseek-v4-pro';
  return current; // already at the top
}

export type Provider = 'deepseek' | 'minimax';
export interface Resolved {
  provider: Provider;
  apiModel: string; // the id actually sent to the provider's API
  pricingId: string; // id used for cost lookup (branded, stable)
}

/** Map a branded/selectable model id to a provider + the real API model + a
 *  stable id for pricing. */
export function resolveProvider(modelId: string): Resolved {
  if (modelId === MAX_MODEL) {
    return { provider: 'minimax', apiModel: config.minimaxModel, pricingId: MAX_MODEL };
  }
  return { provider: 'deepseek', apiModel: modelId, pricingId: modelId };
}
