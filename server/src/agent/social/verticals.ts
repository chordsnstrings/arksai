/**
 * The campaign brain's vertical intelligence (CAMPAIGN_CRAFT.md encoded) — pure + unit-tested.
 *
 * - ~12 industry profiles: benchmark priors (US-median CPL/CPA bands from the verified
 *   WordStream/LocaliQ + Triple Whale 2025 data — NOISY priors; the cross-vertical SPREAD is
 *   the load-bearing fact), visual style, emotional frame, scarcity category, compliance.
 * - COUNTRY COST INDEX: the priors are US-campaign medians; Meta auction costs scale hard by
 *   country (US CPM ≈ $20 vs UAE ≈ $6.5–16 vs India ≈ $2.6 — sources disagree, so TIERS with
 *   ranges, never points). Cross-checked against Lebesgue, AdAmigo.ai, Adligator and the
 *   GCC-specific 23HubLab CPM-by-country benchmarks (2025–2026 editions).
 * - Own-account history ALWAYS beats these priors — callers pass a real CPL when one exists.
 *
 * The meta-rule from the research: every universal constant was refuted in verification;
 * every conditional if/then rule survived. Keep everything here MODERATED (per vertical,
 * per country, per category) and honest about uncertainty (bands widen, never fake precision).
 */

export type VerticalId =
  | 'restaurant' | 'dental' | 'clinic' | 'fitness' | 'beauty' | 'realestate' | 'legal'
  | 'education' | 'homeservices' | 'ecom_fashion' | 'ecom_other' | 'generic';

export type VisualStyle = 'playful' | 'credibility' | 'demo';
export type AdFrame = 'gain' | 'loss';
export type ScarcityCategory = 'utilitarian' | 'experience' | 'high_involvement';

export interface BenchmarkPrior {
  /** What the money buys in this vertical's typical campaign. */
  metric: 'lead' | 'sale' | 'click';
  /** US-median cost band (USD) per result — scale by country before showing anyone. */
  lowUsd: number;
  highUsd: number;
}

export interface VerticalProfile {
  id: VerticalId;
  /** Plain language, shown to users ("Dental clinic" — never "vertical: dental"). */
  label: string;
  keywords: string[];
  prior: BenchmarkPrior | null; // null = generic: judged vs own history only
  visualStyle: VisualStyle;
  /** Emotional register for copy (research: match frame to emotion, never default to fear).
   *  Health-adjacent verticals are ALWAYS 'gain' — Meta bans negative self-perception copy. */
  frame: AdFrame;
  scarcity: ScarcityCategory;
  /** Meta special-ad-category / policy flags. */
  compliance: { specialCategory?: 'HOUSING' | 'EMPLOYMENT' | 'CREDIT'; healthRules?: boolean };
}

/** US-median priors from the verified benchmark data (leads campaigns unless metric says
 *  otherwise). Deliberately WIDE — subcategory medians are volatile year to year. */
export const VERTICALS: VerticalProfile[] = [
  {
    id: 'restaurant', label: 'Restaurant / café',
    keywords: ['restaurant', 'cafe', 'café', 'coffee', 'food', 'menu', 'dining', 'eatery', 'bakery', 'catering', 'shawarma', 'burger', 'pizza', 'biryani', 'brunch', 'buffet', 'iftar'],
    prior: { metric: 'lead', lowUsd: 2, highUsd: 17 },
    visualStyle: 'playful', frame: 'gain', scarcity: 'experience', compliance: {},
  },
  {
    id: 'dental', label: 'Dental clinic',
    keywords: ['dental', 'dentist', 'teeth', 'tooth', 'orthodont', 'braces', 'veneer', 'implant', 'whitening', 'smile clinic'],
    prior: { metric: 'lead', lowUsd: 40, highUsd: 90 },
    visualStyle: 'credibility', frame: 'gain', scarcity: 'high_involvement', compliance: { healthRules: true },
  },
  {
    id: 'clinic', label: 'Health clinic',
    keywords: ['clinic', 'doctor', 'medical', 'physio', 'dermatolog', 'health check', 'therapy', 'chiropract', 'hospital', 'polyclinic', 'aesthetic'],
    prior: { metric: 'lead', lowUsd: 30, highUsd: 75 },
    visualStyle: 'credibility', frame: 'gain', scarcity: 'high_involvement', compliance: { healthRules: true },
  },
  {
    id: 'fitness', label: 'Fitness / gym',
    keywords: ['gym', 'fitness', 'workout', 'personal train', 'yoga', 'pilates', 'crossfit', 'bootcamp', 'martial arts', 'swim class'],
    prior: { metric: 'lead', lowUsd: 25, highUsd: 70 },
    visualStyle: 'demo', frame: 'gain', scarcity: 'experience', compliance: { healthRules: true },
  },
  {
    id: 'beauty', label: 'Beauty & salon',
    keywords: ['salon', 'beauty', 'spa', 'hair', 'nails', 'makeup', 'lashes', 'barber', 'facial', 'massage', 'grooming'],
    prior: { metric: 'lead', lowUsd: 25, highUsd: 65 },
    visualStyle: 'playful', frame: 'gain', scarcity: 'experience', compliance: { healthRules: true },
  },
  {
    id: 'realestate', label: 'Real estate',
    keywords: ['real estate', 'property', 'apartment', 'villa', 'rent', 'rental', 'off-plan', 'broker', 'realtor', 'townhouse', 'penthouse', 'studio flat'],
    prior: { metric: 'lead', lowUsd: 12, highUsd: 35 },
    visualStyle: 'credibility', frame: 'gain', scarcity: 'high_involvement', compliance: { specialCategory: 'HOUSING' },
  },
  {
    id: 'legal', label: 'Legal services',
    keywords: ['legal', 'lawyer', 'attorney', 'law firm', 'visa services', 'immigration', 'notary', 'advocate', 'litigation'],
    prior: { metric: 'lead', lowUsd: 40, highUsd: 90 },
    visualStyle: 'credibility', frame: 'loss', scarcity: 'high_involvement', compliance: {},
  },
  {
    id: 'education', label: 'Education / courses',
    keywords: ['course', 'training', 'academy', 'school', 'tuition', 'coaching', 'certification', 'university', 'nursery', 'workshop', 'bootcamp class', 'learn'],
    prior: { metric: 'lead', lowUsd: 20, highUsd: 60 },
    visualStyle: 'credibility', frame: 'gain', scarcity: 'high_involvement', compliance: {},
  },
  {
    id: 'homeservices', label: 'Home services',
    keywords: ['cleaning', 'maintenance', 'plumb', 'electric', 'ac repair', 'hvac', 'pest control', 'moving', 'handyman', 'landscap', 'paint', 'renovation', 'deep clean'],
    prior: { metric: 'lead', lowUsd: 12, highUsd: 45 },
    visualStyle: 'demo', frame: 'gain', scarcity: 'utilitarian', compliance: {},
  },
  {
    id: 'ecom_fashion', label: 'Clothing & fashion shop',
    keywords: ['fashion', 'clothing', 'apparel', 'abaya', 'dress', 'streetwear', 'sneaker', 'jewelry', 'jewellery', 'accessories', 'boutique', 'modest wear', 'handbag'],
    prior: { metric: 'sale', lowUsd: 25, highUsd: 55 },
    visualStyle: 'playful', frame: 'gain', scarcity: 'experience', compliance: {},
  },
  {
    id: 'ecom_other', label: 'Online store (other)',
    keywords: ['online store', 'ecommerce', 'e-commerce', 'shop online', 'gadget', 'electronics', 'skincare products', 'supplement', 'home decor', 'toys', 'dropship'],
    prior: { metric: 'sale', lowUsd: 30, highUsd: 65 },
    visualStyle: 'demo', frame: 'gain', scarcity: 'utilitarian', compliance: {},
  },
  {
    id: 'generic', label: 'Something else',
    keywords: [],
    prior: null,
    visualStyle: 'credibility', frame: 'gain', scarcity: 'utilitarian', compliance: {},
  },
];

export const verticalById = (id: string | undefined | null): VerticalProfile =>
  VERTICALS.find((v) => v.id === id) ?? VERTICALS[VERTICALS.length - 1];

/** Pure keyword classifier — cheap enough to run per keystroke-debounce, no LLM.
 *  Confidence = share of the winning score over a small floor; ≥2 keyword hits reads firm. */
export function classifyVertical(product: string, topics: string[] = []): { profile: VerticalProfile; confidence: number } {
  const text = `${product} ${topics.join(' ')}`.toLowerCase();
  let best: VerticalProfile | null = null;
  let bestScore = 0;
  for (const v of VERTICALS) {
    if (!v.keywords.length) continue;
    let score = 0;
    for (const k of v.keywords) if (text.includes(k)) score += k.includes(' ') ? 2 : 1; // phrases weigh double
    if (score > bestScore) { best = v; bestScore = score; }
  }
  if (!best || bestScore === 0) return { profile: verticalById('generic'), confidence: 0 };
  return { profile: best, confidence: Math.min(1, bestScore / 3) };
}

// ─── Country cost index ──────────────────────────────────────────────────────────────────────
// Index RELATIVE TO US = 1.0, as {low, high} ranges because the public CPM-by-country sources
// genuinely disagree (UAE reads anywhere from ~0.35× to ~0.75× US costs across Lebesgue /
// AdAmigo / SuperAds / 23HubLab). Bands WIDEN honestly instead of faking precision.

export interface CostIndex { low: number; high: number }

const TIER: Record<string, CostIndex> = {
  tier1: { low: 0.9, high: 1.1 }, // US-priced auctions
  west_eu: { low: 0.55, high: 0.9 },
  uae: { low: 0.35, high: 0.75 },
  gcc: { low: 0.25, high: 0.6 },
  mid: { low: 0.12, high: 0.35 },
  south_asia: { low: 0.08, high: 0.2 },
};

const COUNTRY_TIER: Record<string, keyof typeof TIER> = {
  US: 'tier1', CA: 'tier1', GB: 'tier1', UK: 'tier1', AU: 'tier1', NZ: 'tier1', SG: 'tier1',
  DE: 'west_eu', FR: 'west_eu', NL: 'west_eu', SE: 'west_eu', NO: 'west_eu', DK: 'west_eu',
  CH: 'west_eu', AT: 'west_eu', IE: 'west_eu', BE: 'west_eu', FI: 'west_eu', IT: 'west_eu', ES: 'west_eu',
  AE: 'uae',
  SA: 'gcc', QA: 'gcc', KW: 'gcc', BH: 'gcc', OM: 'gcc',
  EG: 'mid', JO: 'mid', LB: 'mid', TR: 'mid', ZA: 'mid', MA: 'mid', BR: 'mid', MX: 'mid',
  MY: 'mid', TH: 'mid', PH: 'mid', VN: 'mid', ID: 'mid', NG: 'mid', KE: 'mid',
  IN: 'south_asia', PK: 'south_asia', BD: 'south_asia', LK: 'south_asia', NP: 'south_asia',
};

/** Blend the index across the audience countries (mean of tier bounds). Unknown/empty →
 *  US-priced with `global: true` so the UI can label it "global estimate". */
export function countryCostIndex(countries: string[] = []): CostIndex & { global: boolean } {
  const known = countries.map((c) => COUNTRY_TIER[c.trim().toUpperCase()]).filter(Boolean) as (keyof typeof TIER)[];
  if (!known.length) return { ...TIER.tier1, global: true };
  const low = known.reduce((s, t) => s + TIER[t].low, 0) / known.length;
  const high = known.reduce((s, t) => s + TIER[t].high, 0) / known.length;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return { low: r2(low), high: r2(high), global: known.length < countries.filter((c) => c.trim()).length };
}

/** Display-only local currency (engine stays USD-canonical — house rule). Rough rates,
 *  rounded hard in the UI; shown only for single-country audiences. */
export const DISPLAY_CURRENCY: Record<string, { code: string; perUsd: number }> = {
  AE: { code: 'AED', perUsd: 3.67 },
  SA: { code: 'SAR', perUsd: 3.75 },
  QA: { code: 'QAR', perUsd: 3.64 },
  KW: { code: 'KWD', perUsd: 0.31 },
  BH: { code: 'BHD', perUsd: 0.38 },
  OM: { code: 'OMR', perUsd: 0.38 },
  EG: { code: 'EGP', perUsd: 48 },
  IN: { code: 'INR', perUsd: 84 },
  PK: { code: 'PKR', perUsd: 280 },
  GB: { code: 'GBP', perUsd: 0.78 },
  UK: { code: 'GBP', perUsd: 0.78 },
};

export interface AdjustedBenchmark {
  metric: 'lead' | 'sale' | 'click';
  lowUsd: number;
  highUsd: number;
  /** True when no audience country mapped — the band is a global (US-priced) estimate. */
  global: boolean;
  /** Where the numbers came from — the UI phrases each differently. */
  basis: 'industry-estimate' | 'your-own-results';
  local?: { code: string; low: number; high: number };
}

/** Country-adjust a vertical's US prior — or wrap the account's OWN result when one exists
 *  (own history always beats the prior; it needs no country scaling, it IS local truth). */
export function adjustedBenchmark(
  profile: VerticalProfile,
  countries: string[],
  ownCprUsd?: number | null,
): AdjustedBenchmark | null {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const localize = (low: number, high: number) => {
    const codes = [...new Set(countries.map((c) => c.trim().toUpperCase()).filter(Boolean))];
    if (codes.length !== 1) return undefined;
    const cur = DISPLAY_CURRENCY[codes[0]];
    if (!cur) return undefined;
    return { code: cur.code, low: Math.round(low * cur.perUsd), high: Math.round(high * cur.perUsd) };
  };
  if (ownCprUsd && ownCprUsd > 0) {
    // A real observed cost: a tight ±30% band around what THIS account actually pays.
    const low = r2(ownCprUsd * 0.7);
    const high = r2(ownCprUsd * 1.3);
    return { metric: profile.prior?.metric ?? 'lead', lowUsd: low, highUsd: high, global: false, basis: 'your-own-results', local: localize(low, high) };
  }
  if (!profile.prior) return null;
  const idx = countryCostIndex(countries);
  const low = r2(profile.prior.lowUsd * idx.low);
  const high = r2(profile.prior.highUsd * idx.high);
  return { metric: profile.prior.metric, lowUsd: low, highUsd: high, global: idx.global, basis: 'industry-estimate', local: localize(low, high) };
}

/** The target-price suggestion: own history first, else the country-adjusted midpoint. */
export function suggestTargetCpr(bench: AdjustedBenchmark | null): number | null {
  if (!bench) return null;
  const mid = (bench.lowUsd + bench.highUsd) / 2;
  return Math.round(mid * 100) / 100;
}

/** Honesty guard for user-set targets: below ~half the plausible low reads "ambitious". */
export function targetAmbition(targetUsd: number, bench: AdjustedBenchmark | null): 'ok' | 'ambitious' {
  if (!bench || !(targetUsd > 0)) return 'ok';
  return targetUsd < bench.lowUsd * 0.5 ? 'ambitious' : 'ok';
}
