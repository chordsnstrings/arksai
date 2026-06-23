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
  /** Units of this currency per 1 USD (fixed peg for the GCC set). */
  rate: number;
  name: string;
}

/** The platform default until an org chooses otherwise. */
export const DEFAULT_CURRENCY = 'AED';

/** Supported display currencies (USD base + USD-pegged GCC). */
export const CURRENCIES: Record<string, CurrencyDef> = {
  USD: { code: 'USD', symbol: '$', rate: 1, name: 'US Dollar' },
  AED: { code: 'AED', symbol: 'AED', rate: 3.6725, name: 'UAE Dirham' },
  SAR: { code: 'SAR', symbol: 'SAR', rate: 3.75, name: 'Saudi Riyal' },
  QAR: { code: 'QAR', symbol: 'QAR', rate: 3.64, name: 'Qatari Riyal' },
  BHD: { code: 'BHD', symbol: 'BHD', rate: 0.376, name: 'Bahraini Dinar' },
  OMR: { code: 'OMR', symbol: 'OMR', rate: 0.3845, name: 'Omani Rial' },
};

/** The currency codes in display order (USD first, then GCC). */
export const CURRENCY_CODES = Object.keys(CURRENCIES);

/** Resolve a code (case-insensitive) to its definition, falling back to the default. */
export function currencyOf(code?: string | null): CurrencyDef {
  return CURRENCIES[String(code || '').toUpperCase()] || CURRENCIES[DEFAULT_CURRENCY];
}

/** Convert a USD amount into the target currency. */
export function convertFromUsd(usd: number, code?: string | null): number {
  return (usd || 0) * currencyOf(code).rate;
}

/**
 * Format a USD amount in the target display currency. Sub-cent amounts keep 4 decimals
 * (so tiny per-call costs aren't shown as "0.00"); everything else uses 2.
 */
export function formatMoney(usd: number, code?: string | null): string {
  const c = currencyOf(code);
  const v = (usd || 0) * c.rate;
  const decimals = v !== 0 && Math.abs(v) < 0.01 ? 4 : 2;
  const num = v.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return c.symbol === '$' ? `$${num}` : `${c.symbol} ${num}`;
}
