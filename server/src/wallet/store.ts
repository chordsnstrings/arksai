import { randomUUID } from 'node:crypto';
import { q, qOne } from '../db';

/**
 * Org prepaid wallet + append-only ledger. ALL money is integer **micro-USD** (USD × 1e6) so
 * there's no float drift on balances; USD is the canonical accounting unit (provider costs are
 * billed in USD). The ledger is the source of truth; `org_wallets.balance_micros` is a cached,
 * reconcilable running total. `creditOrg`/`debitOrg` are the single chokepoint — a future
 * Stripe/PayPal webhook calls `creditOrg` with source:'stripe'|'paypal' + the gateway ref.
 */

export type LedgerType = 'topup' | 'usage' | 'adjustment' | 'refund';
export type LedgerSource = 'manual' | 'stripe' | 'paypal' | 'system';

export interface LedgerEntry {
  id: string;
  orgId: string;
  ts: number;
  type: LedgerType;
  amountMicros: number; // signed: + credit, − debit
  balanceAfterMicros: number;
  source: LedgerSource;
  ref: string | null;
  note: string | null;
  createdBy: string | null;
}

export const usdToMicros = (usd: number): number => Math.round((usd || 0) * 1e6);
export const microsToUsd = (micros: number): number => (micros || 0) / 1e6;

export async function walletBalanceMicros(orgId: string): Promise<number> {
  const r = await qOne<{ balance_micros: number }>('SELECT balance_micros FROM org_wallets WHERE org_id = $1', [orgId]);
  return r ? Number(r.balance_micros) : 0;
}

export async function walletBalanceUsd(orgId: string): Promise<number> {
  return microsToUsd(await walletBalanceMicros(orgId));
}

interface ApplyOpts {
  type?: LedgerType;
  source: LedgerSource;
  ref?: string | null;
  note?: string | null;
  by?: string | null;
}

/**
 * Apply a signed delta atomically-enough (a relative UPDATE so concurrent runs don't clobber
 * the balance), recording one ledger row. Idempotent on (org, source, ref) when a ref is given —
 * a retried top-up / re-fired run_finished can't double-charge. Returns the entry, or null if a
 * duplicate ref was skipped.
 */
async function apply(orgId: string, deltaMicros: number, defaultType: LedgerType, opts: ApplyOpts): Promise<LedgerEntry | null> {
  if (!orgId) return null;
  const ref = opts.ref ?? null;
  if (ref) {
    const dup = await qOne<{ id: string }>('SELECT id FROM wallet_ledger WHERE org_id = $1 AND source = $2 AND ref = $3', [orgId, opts.source, ref]);
    if (dup) return null;
  }
  const now = Date.now();
  // ensure the wallet row exists, then move the balance relative to its current value
  await q('INSERT INTO org_wallets(org_id, balance_micros, updated_at) VALUES ($1, 0, $2) ON CONFLICT(org_id) DO NOTHING', [orgId, now]);
  await q('UPDATE org_wallets SET balance_micros = balance_micros + $1, updated_at = $2 WHERE org_id = $3', [deltaMicros, now, orgId]);
  const after = await walletBalanceMicros(orgId);
  const entry: LedgerEntry = {
    id: randomUUID(),
    orgId,
    ts: now,
    type: opts.type ?? defaultType,
    amountMicros: deltaMicros,
    balanceAfterMicros: after,
    source: opts.source,
    ref,
    note: opts.note ?? null,
    createdBy: opts.by ?? null,
  };
  await q(
    'INSERT INTO wallet_ledger(id, org_id, ts, type, amount_micros, balance_after_micros, source, ref, note, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    [entry.id, orgId, now, entry.type, deltaMicros, after, opts.source, ref, entry.note, entry.createdBy],
  );
  return entry;
}

/** Add funds (top-up / refund / adjustment up). `micros` is treated as a positive amount. */
export async function creditOrg(orgId: string, micros: number, opts: ApplyOpts): Promise<LedgerEntry | null> {
  return apply(orgId, Math.abs(micros), 'topup', opts);
}

/** Deduct funds (usage / adjustment down). `micros` is treated as a positive amount. */
export async function debitOrg(orgId: string, micros: number, opts: ApplyOpts): Promise<LedgerEntry | null> {
  return apply(orgId, -Math.abs(micros), 'usage', opts);
}

function rowToEntry(r: any): LedgerEntry {
  return {
    id: r.id,
    orgId: r.org_id,
    ts: Number(r.ts),
    type: r.type,
    amountMicros: Number(r.amount_micros),
    balanceAfterMicros: Number(r.balance_after_micros),
    source: r.source,
    ref: r.ref ?? null,
    note: r.note ?? null,
    createdBy: r.created_by ?? null,
  };
}

export async function ledger(orgId: string, limit = 100): Promise<LedgerEntry[]> {
  const lim = Math.min(Math.max(limit, 1), 500);
  const rows = await q(`SELECT * FROM wallet_ledger WHERE org_id = $1 ORDER BY ts DESC LIMIT ${lim}`, [orgId]);
  return rows.map(rowToEntry);
}

/** Reconcile: the cached balance should equal the sum of all ledger amounts. For tests/audits. */
export async function ledgerSumMicros(orgId: string): Promise<number> {
  const r = await qOne<{ s: number }>('SELECT COALESCE(SUM(amount_micros),0) AS s FROM wallet_ledger WHERE org_id = $1', [orgId]);
  return r ? Number(r.s) : 0;
}
