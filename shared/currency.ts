/**
 * Currency layer for cost display. All costs are computed and stored in USD (the base);
 * this converts + formats them into a per-org display currency. Starting with AED.
 *
 * GCC currencies are pegged to the USD at FIXED rates (no floating), so the rates below
 * are exact and need no live feed. AED has been pegged at 3.6725 since 1997. Non-pegged
 * currencies (EUR/GBP/INR …) would need a rate feed before they can be added safely.
 */

export interface CurrencyDef {
  code: string;
  /** Prefix shown before the amount. '$' renders tight ("$1.20"); codes render spaced ("AED 1.20"). */
  symbol: string;
  /** Units of this currency per 1 USD. Fixed peg for the GCC set; a fallback default for floating ones. */
  rate: number;
  name: string;
  /** True = a fixed USD peg (exact). False = floating → `rate` is only a fallback; resolve a live/operator-set rate (see server/lib/fx). */
  pegged: boolean;
}

/** The platform default until an org chooses otherwise. */
export const DEFAULT_CURRENCY = 'AED';

/** Supported display currencies: USD base + USD-pegged GCC (exact) + floating (BDT, indicative). */
export const CURRENCIES: Record<string, CurrencyDef> = {
  USD: { code: 'USD', symbol: '$', rate: 1, name: 'US Dollar', pegged: true },
  AED: { code: 'AED', symbol: 'AED', rate: 3.6725, name: 'UAE Dirham', pegged: true },
  SAR: { code: 'SAR', symbol: 'SAR', rate: 3.75, name: 'Saudi Riyal', pegged: true },
  QAR: { code: 'QAR', symbol: 'QAR', rate: 3.64, name: 'Qatari Riyal', pegged: true },
  BHD: { code: 'BHD', symbol: 'BHD', rate: 0.376, name: 'Bahraini Dinar', pegged: true },
  OMR: { code: 'OMR', symbol: 'OMR', rate: 0.3845, name: 'Omani Rial', pegged: true },
  // Floating — NOT pegged. `rate` is a fallback default; the real rate is operator-set (server/lib/fx),
  // and BDT is always shown as an indicative figure with its rate + "as of" date, alongside USD.
  BDT: { code: 'BDT', symbol: '৳', rate: 122, name: 'Bangladeshi Taka', pegged: false },
};

/** The currency codes in display order (USD first, then GCC). */
export const CURRENCY_CODES = Object.keys(CURRENCIES);

/** Resolve a code (case-insensitive) to its definition, falling back to the default. */
export function currencyOf(code?: string | null): CurrencyDef {
  return CURRENCIES[String(code || '').toUpperCase()] || CURRENCIES[DEFAULT_CURRENCY];
}

/** Effective units/USD: a caller-resolved rate (e.g. operator-set BDT) wins over the table default. */
function effectiveRate(code?: string | null, rateOverride?: number | null): number {
  if (typeof rateOverride === 'number' && rateOverride > 0) return rateOverride;
  return currencyOf(code).rate;
}

/** Convert a USD amount into the target currency. `rateOverride` supplies a live/operator-set rate. */
export function convertFromUsd(usd: number, code?: string | null, rateOverride?: number | null): number {
  return (usd || 0) * effectiveRate(code, rateOverride);
}

/**
 * Format a USD amount in the target display currency. Sub-cent amounts keep 4 decimals
 * (so tiny per-call costs aren't shown as "0.00"); everything else uses 2. `rateOverride`
 * supplies a live/operator-set rate for floating currencies.
 */
export function formatMoney(usd: number, code?: string | null, rateOverride?: number | null): string {
  const c = currencyOf(code);
  const v = (usd || 0) * effectiveRate(code, rateOverride);
  const decimals = v !== 0 && Math.abs(v) < 0.01 ? 4 : 2;
  const num = v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return c.symbol === '$' ? `$${num}` : `${c.symbol} ${num}`;
}

/**
 * Format with the conversion BASIS for honesty on a FLOATING currency, e.g.
 * "৳128.40 · 1 USD = ৳122 (24 Jun)". Pegged currencies (exact) return just the amount.
 * `asOf` is an epoch-ms timestamp of when the rate was set (omitted for pegs).
 */
export function formatMoneyWithBasis(usd: number, code?: string | null, rateOverride?: number | null, asOf?: number | null): string {
  const c = currencyOf(code);
  const amount = formatMoney(usd, code, rateOverride);
  if (c.pegged) return amount;
  const rate = effectiveRate(code, rateOverride);
  const rateStr = rate.toLocaleString(undefined, { maximumFractionDigits: 2 });
  let when = '';
  if (asOf) {
    try {
      when = ` (${new Date(asOf).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })})`;
    } catch {
      /* ignore */
    }
  }
  return `${amount} · 1 USD = ${c.symbol}${rateStr}${when}`;
}
