import type { AdsRow } from '../../connectors/types';

/**
 * Pure, unit-tested normaliser for Meta ad insights. `fetchReport`/`normalizeMeta` flatten the
 * `actions[]` array into `action_<type>` columns (dotted keys included, e.g.
 * `action_offsite_conversion.fb_pixel_purchase`). There is NO single "conversions" column — this
 * maps the relevant action types into `leads`/`conversions` and derives the standard rate metrics,
 * so the report bot's numbers are deterministic (never LLM-authored).
 */

export interface NormalizedRow {
  name: string;
  impressions: number;
  reach: number;
  clicks: number;
  spend: number;
  ctr: number; // %
  cpc: number;
  cpm: number;
  frequency: number;
  leads: number;
  conversions: number;
  /** results = leads + conversions (the outcome the campaign optimises for). */
  results: number;
  costPerResult: number | null;
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

// Action-type fragments that count as a LEAD (in-app / lead-form) vs a CONVERSION (pixel/purchase).
const LEAD_KEYS = ['action_lead', 'lead_grouped', 'leadgen_grouped', 'onsite_conversion.lead'];
const CONVERSION_KEYS = ['fb_pixel_purchase', 'onsite_conversion.purchase', 'omni_purchase', 'action_purchase', 'offsite_conversion.fb_pixel_complete_registration'];

function sumMatching(row: AdsRow, fragments: string[]): number {
  let total = 0;
  for (const [k, v] of Object.entries(row)) {
    if (!k.startsWith('action_')) continue;
    if (fragments.some((f) => k.includes(f))) total += num(v);
  }
  return total;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Normalise ONE insights row (adds leads/conversions/derived rates). */
export function normalizeRow(row: AdsRow): NormalizedRow {
  const impressions = num(row.impressions);
  const reach = num(row.reach);
  const clicks = num(row.clicks);
  const spend = num(row.spend);
  const leads = sumMatching(row, LEAD_KEYS);
  const conversions = sumMatching(row, CONVERSION_KEYS);
  const results = leads + conversions;
  // Prefer Meta's own ctr/cpc when present, else derive.
  const ctr = row.ctr != null ? num(row.ctr) : impressions ? round2((clicks / impressions) * 100) : 0;
  const cpc = row.cpc != null ? num(row.cpc) : clicks ? round2(spend / clicks) : 0;
  const cpm = row.cpm != null ? num(row.cpm) : impressions ? round2((spend / impressions) * 1000) : 0;
  const frequency = row.frequency != null ? num(row.frequency) : reach ? round2(impressions / reach) : 0;
  const name = String(row.campaign_name ?? row.adset_name ?? row.ad_name ?? row.account_name ?? '');
  return {
    name, impressions, reach, clicks, spend, ctr, cpc, cpm, frequency,
    leads, conversions, results, costPerResult: results ? round2(spend / results) : null,
  };
}

/** Sum a set of normalized rows into one account/rollup total. */
export function sumRows(rows: NormalizedRow[]): NormalizedRow {
  const t = rows.reduce(
    (a, r) => {
      a.impressions += r.impressions; a.reach += r.reach; a.clicks += r.clicks; a.spend += r.spend;
      a.leads += r.leads; a.conversions += r.conversions;
      return a;
    },
    { impressions: 0, reach: 0, clicks: 0, spend: 0, leads: 0, conversions: 0 },
  );
  const results = t.leads + t.conversions;
  return {
    name: 'All campaigns',
    impressions: t.impressions, reach: t.reach, clicks: t.clicks, spend: round2(t.spend),
    ctr: t.impressions ? round2((t.clicks / t.impressions) * 100) : 0,
    cpc: t.clicks ? round2(t.spend / t.clicks) : 0,
    cpm: t.impressions ? round2((t.spend / t.impressions) * 1000) : 0,
    frequency: t.reach ? round2(t.impressions / t.reach) : 0,
    leads: t.leads, conversions: t.conversions, results,
    costPerResult: results ? round2(t.spend / results) : null,
  };
}

/** Normalise a whole insights pull → per-row + rollup. */
export function normalizeInsights(rows: AdsRow[]): { rows: NormalizedRow[]; total: NormalizedRow } {
  const norm = (rows ?? []).map(normalizeRow);
  return { rows: norm, total: sumRows(norm) };
}

/** The flat metric map to persist as a metric snapshot (for week-over-week deltas). */
export function toSnapshotMetrics(total: NormalizedRow): Record<string, number> {
  return {
    spend: total.spend, impressions: total.impressions, reach: total.reach, clicks: total.clicks,
    ctr: total.ctr, cpc: total.cpc, cpm: total.cpm, leads: total.leads,
    conversions: total.conversions, results: total.results,
    costPerResult: total.costPerResult ?? 0,
  };
}
