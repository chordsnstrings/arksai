import { config } from '../config';
import { FALLBACK_MODEL_IDS, KNOWN_MODELS, pricingFor, type ModelInfo } from '../../../shared/types';

const TTL_MS = 60 * 60 * 1000; // 1h
let cache: { ids: string[]; at: number } | null = null;

/** Live model ids from DeepSeek's /models endpoint, cached for an hour. */
export async function liveModelIds(): Promise<string[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.ids;
  try {
    const res = await fetch(`${config.deepseekBaseUrl}/models`, {
      headers: { Authorization: `Bearer ${config.deepseekApiKey}`, Accept: 'application/json' },
    });
    if (res.ok) {
      const data: any = await res.json();
      const ids: string[] = (data?.data ?? []).map((m: any) => m.id).filter(Boolean);
      if (ids.length) {
        cache = { ids, at: Date.now() };
        return ids;
      }
    }
  } catch {
    /* fall through to fallback */
  }
  return FALLBACK_MODEL_IDS;
}

export async function listModels(): Promise<ModelInfo[]> {
  const ids = await liveModelIds();
  return ids.map((id) => {
    const p = pricingFor(id);
    return { id, ...p, label: p.label === 'unknown' ? id : p.label };
  });
}

/** Validate a requested model id against the live list (falls back permissively). */
export async function isValidModel(id: string): Promise<boolean> {
  if (!id) return false;
  const ids = await liveModelIds();
  return ids.includes(id) || id in KNOWN_MODELS;
}
