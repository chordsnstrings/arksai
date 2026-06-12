export class Usage {
  promptTokens = 0;
  completionTokens = 0;
  cacheHitTokens = 0;
  cacheMissTokens = 0;
  readonly startedAt = Date.now();

  add(
    u:
      | {
          prompt_tokens?: number;
          completion_tokens?: number;
          prompt_cache_hit_tokens?: number;
          prompt_cache_miss_tokens?: number;
        }
      | null
      | undefined,
  ) {
    if (!u) return;
    const prompt = u.prompt_tokens ?? 0;
    this.promptTokens += prompt;
    this.completionTokens += u.completion_tokens ?? 0;
    // DeepSeek reports the cache split; fall back to "all miss" if absent.
    const hit = u.prompt_cache_hit_tokens ?? 0;
    const miss = u.prompt_cache_miss_tokens ?? Math.max(0, prompt - hit);
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
