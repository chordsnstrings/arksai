import { computeCost, type SessionMeta } from '@shared/types';
import type { LiveState } from '../state/sessionStore';

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function fmtCost(n: number): string {
  if (n === 0) return '$0.00';
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

/** Persistent per-session usage + cost, shown at the very bottom. */
export function CostBar({ meta, live }: { meta: SessionMeta; live: LiveState }) {
  const running = live.running;
  const prompt = meta.promptTokens + (running ? live.promptTokens : 0);
  const completion = meta.completionTokens + (running ? live.completionTokens : 0);
  const total = meta.totalTokens + (running ? live.tokens : 0);
  const liveCost = running
    ? computeCost(meta.model, {
        cacheHit: live.cacheHitTokens,
        cacheMiss: live.cacheMissTokens,
        completion: live.completionTokens,
      }) + live.engineCostUsd // + external-engine spend (e.g. Suno) this run
    : 0;
  const cost = meta.costUsd + liveCost;

  return (
    <div className="cost-bar">
      <span className="seg">
        <span className="lbl">in</span> {fmtTokens(prompt)}
      </span>
      <span className="seg">
        <span className="lbl">out</span> {fmtTokens(completion)}
      </span>
      <span className="seg">
        <span className="lbl">tokens</span> {fmtTokens(total)}
      </span>
      <span className="spacer" />
      <span className="seg cost" title="Estimated cost for this session (DeepSeek pricing)">
        {fmtCost(cost)}
        {running && <span className="live-dot" />}
      </span>
    </div>
  );
}
