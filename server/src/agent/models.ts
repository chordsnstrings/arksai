import { config } from '../config';
import { AUTO_MODEL, FAST_MODEL, MAX_MODEL, pricingFor, type ModelInfo } from '../../../shared/types';

/** The selectable lineup — all MiniMax-backed. Auto leads (the default the chat
 *  uses), then the directly-selectable tiers (Max = M3, Flash = M2.7-highspeed).
 *  Flash/Max only appear when the MiniMax key is configured. */
function lineup(): string[] {
  if (!config.minimaxApiKey) return [AUTO_MODEL];
  return [AUTO_MODEL, MAX_MODEL, FAST_MODEL];
}

export async function listModels(): Promise<ModelInfo[]> {
  return lineup().map((id) => {
    const p = pricingFor(id);
    return { id, ...p, label: p.label === 'unknown' ? id : p.label };
  });
}

/** Validate a requested model id against the lineup. */
export async function isValidModel(id: string): Promise<boolean> {
  if (!id) return false;
  if (id === AUTO_MODEL) return true;
  if (id === MAX_MODEL || id === FAST_MODEL) return !!config.minimaxApiKey;
  return false;
}
