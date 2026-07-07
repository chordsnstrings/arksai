/**
 * SHEET RECONCILE ENGINE — match two spreadsheets and isolate every discrepancy
 * (BI arc, 2026-07-06). The #1 finance-adjacent chore: payment-processor payouts
 * vs. orders, GL vs. subledger, CRM export vs. billing. Deterministic and pure:
 * the model only picks which files (and optionally which key fields); every row
 * decision happens here and is CATEGORISED, never dropped — matched, mismatched
 * (same key, different amount), probable (fuzzy date), only-in-A, only-in-B.
 *
 * Reuses the combine engine's cleaning guarantees end to end: each side is run
 * through profileSource + autoMapSources + combineSources (header detection,
 * date/amount normalisation, footer/repeated-header/empty cleaning), so a messy
 * bank export reconciles as reliably as it combines.
 */

import {
  type CombinePlan,
  type GridSource,
  type SourceProfile,
  autoMapSources,
  cleanText,
  combineSources,
} from './sheetCombine';

// ---------------------------------------------------------------- records

export interface RecRecord {
  /** ISO date or null. */
  date: string | null;
  amount: number | null;
  description: string;
  entity: string; // normalized description for matching
  reference: string;
  /** The cleaned unified row (Date, Description, Amount, … Source) for output sheets. */
  cells: any[];
}

const LEGAL_SUFFIX_RE = /\b(incorporated|inc|llc|ltd|limited|corp|corporation|company|co|plc|gmbh|sarl|fzc?o?|fz-?llc|dmcc|llp|lp|pvt|pte)\b\.?/g;

/**
 * Normalize an entity/description for matching: case, punctuation, legal suffixes,
 * "&"→"and", collapsed whitespace — "Acme, Inc." and "ACME INC" become one key.
 * Exported: exact joins on raw names silently match ~60% of real-world files.
 */
export function normalizeEntityName(v: any): string {
  return cleanText(v)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(LEGAL_SUFFIX_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Run one side through the FULL combine cleaning pipeline → normalized records. */
export function extractRecords(src: GridSource, profile: SourceProfile, plan: CombinePlan): RecRecord[] {
  const result = combineSources([src], [profile], plan, { dedupe: false, sort: false });
  const idx = (name: string) => result.fields.findIndex((f) => f.name.toLowerCase() === name);
  const di = idx('date');
  const ai = idx('amount');
  const de = idx('description');
  const re = idx('reference');
  return result.rows.map((row) => {
    const d = di >= 0 ? row[di] : null;
    const desc = de >= 0 ? cleanText(row[de]) : '';
    return {
      date: d instanceof Date ? d.toISOString().slice(0, 10) : null,
      amount: ai >= 0 && typeof row[ai] === 'number' ? row[ai] : null,
      description: desc,
      entity: normalizeEntityName(desc),
      reference: re >= 0 ? cleanText(row[re]).toLowerCase() : '',
      cells: row,
    };
  });
}

// ---------------------------------------------------------------- matching

export type MatchKey = 'reference' | 'date' | 'amount' | 'description';

export interface ReconcileOptions {
  keys: MatchKey[];
  /** Fuzzy pass: same amount, dates within ±N days (default 3). 0 disables. */
  dateToleranceDays?: number;
  /** Amounts equal within this absolute tolerance (default 0.005 — cents). */
  amountTolerance?: number;
}

export interface ReconcileResult {
  keys: MatchKey[];
  matched: Array<{ a: RecRecord; b: RecRecord }>;
  /** Same identity key but a DIFFERENT amount — the classic fee/partial-payment gap. */
  mismatched: Array<{ a: RecRecord; b: RecRecord; delta: number }>;
  /** Fuzzy (date within tolerance) — for review, not certainty. */
  probable: Array<{ a: RecRecord; b: RecRecord; daysApart: number }>;
  onlyA: RecRecord[];
  onlyB: RecRecord[];
  warnings: string[];
}

const amountKey = (n: number | null): string => (n === null ? '∅' : n.toFixed(2));

/** Pick match keys automatically: a well-populated unique Reference wins; else date+amount(+entity). */
export function autoKeys(a: RecRecord[], b: RecRecord[]): MatchKey[] {
  const refUsable = (rs: RecRecord[]) => {
    const refs = rs.map((r) => r.reference).filter(Boolean);
    return refs.length >= rs.length * 0.8 && new Set(refs).size >= refs.length * 0.9;
  };
  if (a.length && b.length && refUsable(a) && refUsable(b)) return ['reference'];
  const hasDesc = (rs: RecRecord[]) => rs.filter((r) => r.entity).length >= rs.length * 0.6;
  return hasDesc(a) && hasDesc(b) ? ['date', 'amount', 'description'] : ['date', 'amount'];
}

const keyOf = (r: RecRecord, keys: MatchKey[]): string =>
  keys
    .map((k) => (k === 'reference' ? r.reference : k === 'date' ? (r.date ?? '∅') : k === 'amount' ? amountKey(r.amount) : r.entity))
    .join('|');

/** Identity WITHOUT the amount — two rows that agree on it but differ on amount = mismatch. */
const identityKeys = (keys: MatchKey[]): MatchKey[] => keys.filter((k) => k !== 'amount');

export function reconcileRecords(a: RecRecord[], b: RecRecord[], opts: ReconcileOptions): ReconcileResult {
  const keys = opts.keys;
  const tolDays = opts.dateToleranceDays ?? 3;
  const tol = opts.amountTolerance ?? 0.005;
  const warnings: string[] = [];
  const matched: ReconcileResult['matched'] = [];
  const mismatched: ReconcileResult['mismatched'] = [];
  const probable: ReconcileResult['probable'] = [];

  // Pair on IDENTITY (the key minus amount) when it discriminates rows — a reference, or
  // date+entity — then CLASSIFY each pair by amount: equal → matched, different → mismatched
  // with a delta (the fee/partial-payment gap). A weak identity (date alone) would pair
  // unrelated same-day rows, so those key sets pair on the FULL key (amount included) and
  // the mismatch class doesn't apply.
  const ik = identityKeys(keys);
  const discriminating = ik.includes('reference') || (ik.includes('date') && ik.includes('description'));
  const pairKeys = discriminating ? ik : keys;

  const bByKey = new Map<string, number[]>();
  b.forEach((r, i) => {
    const k = keyOf(r, pairKeys);
    if (!k.replace(/[∅|]/g, '')) return; // an all-empty identity matches everything — leave for later passes
    (bByKey.get(k) ?? bByKey.set(k, []).get(k)!).push(i);
  });
  const bUsed = new Set<number>();
  const aRest: RecRecord[] = [];
  for (const r of a) {
    const k = keyOf(r, pairKeys);
    const pool = (k.replace(/[∅|]/g, '') ? (bByKey.get(k) ?? []) : []).filter((i) => !bUsed.has(i));
    if (!pool.length) {
      aRest.push(r);
      continue;
    }
    // Prefer an equal-amount candidate so a duplicate identity doesn't mis-pair.
    const equal = pool.find((i) => r.amount !== null && b[i].amount !== null && Math.abs(b[i].amount! - r.amount!) <= tol);
    const hit = equal ?? pool[0];
    bUsed.add(hit);
    const ra = r.amount;
    const rb = b[hit].amount;
    if (ra !== null && rb !== null && Math.abs(rb - ra) > tol) {
      mismatched.push({ a: r, b: b[hit], delta: Math.round((rb - ra) * 100) / 100 });
    } else {
      matched.push({ a: r, b: b[hit] });
    }
  }
  let bRest = b.filter((_, i) => !bUsed.has(i));

  // Pass 3 — fuzzy: same amount (and entity when keyed), dates within ±N days.
  if (tolDays > 0 && keys.includes('date') && keys.includes('amount')) {
    const wantEntity = keys.includes('description');
    const bUsed3 = new Set<number>();
    const aRest3: RecRecord[] = [];
    for (const r of aRest) {
      let hit = -1;
      let hitDays = Infinity;
      if (r.date && r.amount !== null) {
        bRest.forEach((rb, i) => {
          if (bUsed3.has(i) || rb.date === null || rb.amount === null) return;
          if (amountKey(rb.amount) !== amountKey(r.amount)) return;
          if (wantEntity && rb.entity !== r.entity) return;
          const days = Math.abs((Date.parse(rb.date) - Date.parse(r.date!)) / 86_400_000);
          if (days <= tolDays && days < hitDays) {
            hit = i;
            hitDays = days;
          }
        });
      }
      if (hit >= 0) {
        bUsed3.add(hit);
        probable.push({ a: r, b: bRest[hit], daysApart: hitDays });
      } else aRest3.push(r);
    }
    aRest.length = 0;
    aRest.push(...aRest3);
    bRest = bRest.filter((_, i) => !bUsed3.has(i));
  }

  // Reconciliation invariant — every input row lands in exactly one bucket.
  const aCounted = matched.length + mismatched.length + probable.length + aRest.length;
  const bCounted = matched.length + mismatched.length + probable.length + bRest.length;
  if (aCounted !== a.length || bCounted !== b.length)
    throw new Error(`reconcile bug: A ${a.length}→${aCounted}, B ${b.length}→${bCounted}`);

  return { keys, matched, mismatched, probable, onlyA: aRest, onlyB: bRest, warnings };
}

/** Convenience: full pipeline for one side (profile → plan → records). */
export function sideRecords(src: GridSource, profile: SourceProfile): { records: RecRecord[]; plan: CombinePlan } {
  const plan = autoMapSources([profile]);
  return { records: extractRecords(src, profile, plan), plan };
}
