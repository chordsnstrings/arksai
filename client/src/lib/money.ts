import { currencyOf, formatMoney, formatMoneyWithBasis } from '@shared/currency';

/**
 * Client money context for the CURRENT user's org. Set once from /api/auth/me so cost displays
 * use the honest, operator-set rate for a floating currency (BDT) instead of the table fallback.
 * For cross-org views (an operator inspecting another org), pass that org's rate explicitly.
 */
let _code = 'AED';
let _rate: number | null = null;
let _asOf: number | null = null;

export function setMoneyContext(currency?: string | null, rate?: number | null, asOf?: number | null): void {
  _code = currencyOf(currency).code;
  _rate = typeof rate === 'number' ? rate : null;
  _asOf = typeof asOf === 'number' ? asOf : null;
}

export function currentCurrency(): string {
  return _code;
}
export function fxAsOf(): number | null {
  return _asOf;
}

/** Format a USD cost in the current org's currency (uses the resolved rate when it's that currency). */
export function money(usd: number, currency?: string | null): string {
  const code = currency ?? _code;
  const useRate = currencyOf(code).code === _code ? _rate : null;
  return formatMoney(usd ?? 0, code, useRate);
}

/** Format with the conversion basis ("৳128 · 1 USD = ৳122 (24 Jun)") for the current currency. */
export function moneyBasis(usd: number): string {
  return formatMoneyWithBasis(usd ?? 0, _code, _rate, _asOf);
}
