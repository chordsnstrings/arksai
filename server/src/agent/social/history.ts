import { findForProvider } from '../../connectors/store';
import { fetchReport } from '../../connectors';
import { normalizeInsights, type NormalizedRow } from './insights';

/**
 * Account-history cost basis for the campaign brain — ingest the CONNECTED AD ACCOUNT's last
 * 30 days of real insights (whatever ran there, managed by us or not) and derive the observed
 * cost per lead/sale. This beats any industry prior the moment the account has real history:
 * the brief's brain line quotes "your ad account's last 30 days" instead of an estimate, and
 * the target-price suggestion becomes the account's own number.
 *
 * Honesty floors: a cost is only trusted with ≥3 results and ≥$20 spend in the window —
 * below that it's noise and the country-adjusted vertical prior stays the better guide.
 * Fail-soft everywhere: no connection / API error / thin data → null (callers fall back).
 */

export interface AccountCost {
  /** What the observed cost buys — matches BenchmarkPrior.metric so callers can compare. */
  metric: 'lead' | 'sale';
  costUsd: number;
  /** How many results back the number (shown to the user as proof of basis). */
  n: number;
  spendUsd: number;
}

const MIN_RESULTS = 3;
const MIN_SPEND_USD = 20;

/** Pure: derive the trustworthy cost basis from a normalized account rollup (or null). */
export function pickAccountCost(total: NormalizedRow): AccountCost | null {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  if (total.spend < MIN_SPEND_USD) return null;
  // Leads first (the campaign bot's main objective class), purchases as the sale basis.
  if (total.leads >= MIN_RESULTS) {
    return { metric: 'lead', costUsd: r2(total.spend / total.leads), n: total.leads, spendUsd: r2(total.spend) };
  }
  if (total.conversions >= MIN_RESULTS) {
    return { metric: 'sale', costUsd: r2(total.spend / total.conversions), n: total.conversions, spendUsd: r2(total.spend) };
  }
  return null;
}

// The brief's brain line calls classify-preview per keystroke-debounce — the Graph pull is
// cached per org (6h on success, 15min on null/failure) so Meta is hit at most a few times a day.
const cache = new Map<string, { at: number; value: AccountCost | null }>();
const TTL_HIT_MS = 6 * 3_600_000;
const TTL_MISS_MS = 15 * 60_000;

export function __clearAccountCostCacheForTest(): void {
  cache.clear();
}

const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);

/** The connected ad account's observed cost over the last 30 full days (through yesterday). */
export async function accountCostLast30d(orgId: string): Promise<AccountCost | null> {
  const hit = cache.get(orgId);
  if (hit && Date.now() - hit.at < (hit.value ? TTL_HIT_MS : TTL_MISS_MS)) return hit.value;
  let value: AccountCost | null = null;
  try {
    const conn = await findForProvider(orgId, 'meta');
    if (conn) {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 12_000);
      try {
        const rows = await fetchReport(conn, { accountId: conn.accountId, since: iso(31), until: iso(1), level: 'account' }, ac.signal);
        value = pickAccountCost(normalizeInsights(rows).total);
      } finally {
        clearTimeout(timer);
      }
    }
  } catch {
    value = null; // no connection / API error / abort → callers fall back to priors
  }
  cache.set(orgId, { at: Date.now(), value });
  return value;
}
