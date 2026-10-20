export interface UsageChunk {
  prompt_tokens?: number;
  completion_tokens?: number;
  /** DeepSeek-native cache split. */
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
  /** ModelArk / OpenAI-style cache split. */
  prompt_tokens_details?: { cached_tokens?: number };
}

/** Cache hit/miss split from a usage chunk in EITHER shape (ModelArk reports cache hits as
 *  prompt_tokens_details.cached_tokens); all-miss when absent. PURE. */
export function cacheSplit(u: UsageChunk): { hit: number; miss: number } {
  const prompt = u.prompt_tokens ?? 0;
  const hit = u.prompt_cache_hit_tokens ?? u.prompt_tokens_details?.cached_tokens ?? 0;
  const miss = u.prompt_cache_miss_tokens ?? Math.max(0, prompt - hit);
  return { hit, miss };
}

export class Usage {
  promptTokens = 0;
  completionTokens = 0;
  cacheHitTokens = 0;
  cacheMissTokens = 0;
  readonly startedAt = Date.now();

  add(u: UsageChunk | null | undefined) {
    if (!u) return;
    this.promptTokens += u.prompt_tokens ?? 0;
    this.completionTokens += u.completion_tokens ?? 0;
    const { hit, miss } = cacheSplit(u);
    this.cacheHitTokens += hit;
    this.cacheMissTokens += miss;
  }

  get totalTokens() {
    return this.promptTokens + this.completionTokens;
  }

  get elapsedSeconds() {
    return Math.floor((Date.now() - this.startedAt) / 1000);
  }
}
