/**
 * VARIANCE BRIDGE ENGINE — "why did X change?" answered deterministically
 * (BI arc, 2026-07-06). The single most common executive request: decompose a
 * metric's move between two periods (or actual vs plan) BY DIMENSION, rank the
 * movers, and write the driver sentence — "the 340K miss = EMEA −120K (35%),
 * APAC −90K (26%), offset by Latam +40K".
 *
 * Pure functions over row objects: aggregation, per-dimension contribution
 * deltas, mover ranking, new/disappeared segments, and deterministic commentary.
 * The additive identity holds by construction: Σ segment deltas == total delta
 * for every dimension — that's the bridge's own tie-out.
 */

import { cleanText, parseAmountStrict, type NumberLocale } from './sheetCombine';

export interface Mover {
  segment: string;
  prior: number;
  current: number;
  delta: number;
  /** Share of the TOTAL delta this segment explains (can exceed 1 with offsetting moves). */
  share: number | null;
  isNew: boolean; // segment absent in prior
  isGone: boolean; // segment absent in current
}

export interface DimensionBridge {
  dimension: string;
  movers: Mover[]; // sorted by |delta| desc
  /** How much of |total delta| the top two movers explain — the "explanatory power". */
  concentration: number | null;
}

export interface VarianceResult {
  metric: string;
  priorTotal: number;
  currentTotal: number;
  delta: number;
  deltaPct: number | null;
  byDimension: DimensionBridge[];
  commentary: string[];
  warnings: string[];
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Aggregate metric by one dimension. Blank segment values group as "(blank)". */
function aggregate(rows: Array<Record<string, any>>, dimension: string, metric: string, locale: NumberLocale, bad: { count: number }): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of rows) {
    const seg = cleanText(row[dimension]) || '(blank)';
    const v = parseAmountStrict(row[metric], locale);
    if (v === null) {
      if (row[metric] !== null && row[metric] !== undefined && String(row[metric]).trim() !== '') bad.count++;
      continue;
    }
    out.set(seg, (out.get(seg) ?? 0) + v);
  }
  return out;
}

const fmt = (n: number): string => {
  const abs = Math.abs(n);
  const s = abs >= 1000 ? Math.round(n).toLocaleString('en-US') : String(round2(n));
  return n > 0 ? `+${s}` : s;
};

export function computeVarianceBridge(
  current: Array<Record<string, any>>,
  prior: Array<Record<string, any>>,
  metric: string,
  dimensions: string[],
  locale: NumberLocale = 'us',
): VarianceResult {
  const warnings: string[] = [];
  const bad = { count: 0 };
  const totalOf = (rows: Array<Record<string, any>>): number => {
    let t = 0;
    for (const row of rows) {
      const v = parseAmountStrict(row[metric], locale);
      if (v !== null) t += v;
    }
    return t;
  };
  const priorTotal = round2(totalOf(prior));
  const currentTotal = round2(totalOf(current));
  const delta = round2(currentTotal - priorTotal);
  const deltaPct = priorTotal !== 0 ? round2((delta / Math.abs(priorTotal)) * 100) : null;

  const byDimension: DimensionBridge[] = dimensions.map((dimension) => {
    const cur = aggregate(current, dimension, metric, locale, bad);
    const pri = aggregate(prior, dimension, metric, locale, bad);
    const segs = new Set([...cur.keys(), ...pri.keys()]);
    const movers: Mover[] = [...segs].map((segment) => {
      const c = round2(cur.get(segment) ?? 0);
      const p = round2(pri.get(segment) ?? 0);
      return {
        segment,
        prior: p,
        current: c,
        delta: round2(c - p),
        share: delta !== 0 ? round2(((c - p) / delta) * 100) : null,
        isNew: !pri.has(segment),
        isGone: !cur.has(segment),
      };
    });
    movers.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    // The bridge identity — Σ segment deltas must equal the total delta (to the cent).
    const sumDeltas = round2(movers.reduce((n, m) => n + m.delta, 0));
    if (Math.abs(sumDeltas - delta) > 0.02)
      throw new Error(`variance bridge bug: "${dimension}" segment deltas ${sumDeltas} ≠ total delta ${delta}`);
    const top2 = movers.slice(0, 2).reduce((n, m) => n + Math.abs(m.delta), 0);
    return {
      dimension,
      movers,
      concentration: delta !== 0 ? round2((top2 / Math.abs(delta)) * 100) : null,
    };
  });
  if (bad.count) warnings.push(`${bad.count} cell(s) in "${metric}" could not be parsed as numbers and were excluded.`);

  // Deterministic commentary: headline + the strongest dimension's drivers + offsets.
  const commentary: string[] = [];
  const dir = delta > 0 ? 'rose' : delta < 0 ? 'fell' : 'was flat';
  const absAmt = Math.abs(delta) >= 1000 ? Math.round(Math.abs(delta)).toLocaleString('en-US') : String(round2(Math.abs(delta)));
  commentary.push(
    `${metric} ${dir}${delta !== 0 ? ` ${absAmt}` : ''}${deltaPct !== null && delta !== 0 ? ` (${delta > 0 ? '+' : '-'}${Math.abs(deltaPct)}%)` : ''}: from ${priorTotal.toLocaleString('en-US')} to ${currentTotal.toLocaleString('en-US')}.`,
  );
  for (const dim of byDimension) {
    const withDelta = dim.movers.filter((m) => m.delta !== 0);
    if (!withDelta.length) {
      commentary.push(`By ${dim.dimension}: no segment moved.`);
      continue;
    }
    const sameSign = withDelta.filter((m) => Math.sign(m.delta) === Math.sign(delta) || delta === 0).slice(0, 3);
    const offsets = withDelta.filter((m) => delta !== 0 && Math.sign(m.delta) === -Math.sign(delta)).slice(0, 2);
    const part = (m: Mover) =>
      `${m.segment} ${fmt(m.delta)}${m.share !== null ? ` (${Math.abs(m.share)}% of the change)` : ''}${m.isNew ? ' — NEW segment' : m.isGone ? ' — segment disappeared' : ''}`;
    let line = `By ${dim.dimension}: driven by ${sameSign.map(part).join(', ')}`;
    if (offsets.length) line += `; offset by ${offsets.map(part).join(', ')}`;
    commentary.push(line + '.');
  }

  return { metric, priorTotal, currentTotal, delta, deltaPct, byDimension, commentary, warnings };
}
