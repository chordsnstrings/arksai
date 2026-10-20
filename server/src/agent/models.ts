import { config } from '../config';
import { AUTO_MODEL, FAST_MODEL, MAX_MODEL, pricingFor, type ModelInfo } from '../../../shared/types';
import { modelarkReady } from '../engines/modelark';

/** The selectable lineup — all ModelArk-backed. Auto leads (the default the chat uses), then the
 *  directly-selectable tiers: Max (DeepSeek-V4-Pro, full reasoning) and Flash (DeepSeek-V4-Pro,
 *  thinking off). Swift is the SAME lane as Flash, so it isn't offered twice — its id stays valid
 *  (isValidModel) for old rows and the router. Direct tiers appear once the ModelArk key is set. */
function lineup(): string[] {
  if (!modelarkReady()) return [AUTO_MODEL];
  return [AUTO_MODEL, MAX_MODEL, FAST_MODEL];
}

export async function listModels(): Promise<ModelInfo[]> {
  return lineup().map((id) => {
    const p = pricingFor(id);
    return { id, ...p, label: p.label === 'unknown' ? id : p.label };
  });
}

/** Validate a requested model id: Auto always; any branded ModelArk lane (incl. the heavy-tier
 *  coders reachable by id for bake-offs, not in the advertised lineup) once the key is set. */
export async function isValidModel(id: string): Promise<boolean> {
  if (!id) return false;
  if (id === AUTO_MODEL) return true;
  if (Object.prototype.hasOwnProperty.call(config.modelarkModels, id)) return modelarkReady();
  return false;
}
