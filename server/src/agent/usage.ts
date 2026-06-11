export class Usage {
  promptTokens = 0;
  completionTokens = 0;
  readonly startedAt = Date.now();

  add(u: { prompt_tokens?: number; completion_tokens?: number } | null | undefined) {
    if (!u) return;
    this.promptTokens += u.prompt_tokens ?? 0;
    this.completionTokens += u.completion_tokens ?? 0;
  }

  get totalTokens() {
    return this.promptTokens + this.completionTokens;
  }

  get elapsedSeconds() {
    return Math.floor((Date.now() - this.startedAt) / 1000);
  }
}
