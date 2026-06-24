import { getSetting, setSetting } from '../db';
import { currencyOf } from '../../../shared/currency';

/**
 * Floating-rate resolver. GCC/USD are fixed pegs (exact). For a NON-pegged display currency
 * (BDT), the live units/USD is operator-set and stored in app_settings as JSON {rate, asOf, by};
 * the shared table `rate` is only a fallback default. A short in-memory cache avoids a DB read on
 * every cost format. A live daily FX feed can later populate the same store with the same shape.
 */

export interface ResolvedRate {
  code: string;
  rate: number; // units of this currency per 1 USD
  asOf: number | null; // epoch ms the rate was set (null for pegs / fallback)
  pegged: boolean;
  source: 'peg' | 'operator' | 'default';
}

const cache = new Map<string, { v: ResolvedRate; exp: number }>();
const TTL_MS = 60_000;

export async function getRate(code?: string | null): Promise<ResolvedRate> {
  const c = currencyOf(code);
  if (c.pegged) return { code: c.code, rate: c.rate, asOf: null, pegged: true, source: 'peg' };
  const cached = cache.get(c.code);
  const now = Date.now();
  if (cached && cached.exp > now) return cached.v;
  let v: ResolvedRate = { code: c.code, rate: c.rate, asOf: null, pegged: false, source: 'default' };
  try {
    const raw = await getSetting(`fx.${c.code}`);
    if (raw) {
      const j = JSON.parse(raw);
      if (typeof j.rate === 'number' && j.rate > 0) {
        v = { code: c.code, rate: j.rate, asOf: typeof j.asOf === 'number' ? j.asOf : null, pegged: false, source: 'operator' };
      }
    }
  } catch {
    /* fall back to the default */
  }
  cache.set(c.code, { v, exp: now + TTL_MS });
  return v;
}

/** Operator sets the units/USD for a floating currency. Throws on a pegged code or bad value. */
export async function setRate(code: string, rate: number, byUserId?: string | null): Promise<ResolvedRate> {
  const c = currencyOf(code);
  if (c.pegged) throw new Error(`${c.code} is USD-pegged — its rate is fixed and cannot be overridden.`);
  if (!(typeof rate === 'number' && rate > 0 && rate < 100000)) throw new Error('Rate must be a positive number (units per 1 USD).');
  const asOf = Date.now();
  await setSetting(`fx.${c.code}`, JSON.stringify({ rate, asOf, by: byUserId ?? null }));
  cache.delete(c.code);
  return { code: c.code, rate, asOf, pegged: false, source: 'operator' };
}
