import { config } from '../config';
import { AUTO_MODEL, FAST_MODEL, MAX_MODEL, pricingFor, type ModelInfo } from '../../../shared/types';

/** The selectable lineup — all MiniMax-backed. Auto leads (the default the chat
 *  uses), then the directly-selectable tiers (Max = M3, Flash = M2.7-highspeed).
 *  Flash/Max only appear when the MiniMax key is configured. */
function lineup(): string[] {
  const ids = [AUTO_MODEL];
  if (config.minimaxApiKey) ids.push(MAX_MODEL, FAST_MODEL);
  // ArksAI Pro = DeepSeek V4 (a different provider) — appears when the DeepSeek key is set.
  if (config.deepseekApiKey) ids.push('arksai-pro');
  return ids;
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
  if (id === 'arksai-pro') return !!config.deepseekApiKey;
  return false;
}
