/**
 * SHEET COMBINE ENGINE — deterministic multi-file clean + merge + reconcile
 * (operator, 2026-07-06: "take multiple excel files, clean up data, combine…
 * multiple sheets of bank transactions into one, multiple sheets of expenses…
 * accurate output in the shortest time").
 *
 * Design rule (the same one that made the pattern/scaffold arc work): the MODEL
 * only ever decides a column MAPPING — every row of data is handled by THIS
 * deterministic engine. Accuracy is enforced by construction: per-source
 * reconciliation (rows in == kept + every counted drop; per-source amount sums)
 * is computed here and shipped INSIDE the output workbook as live formulas +
 * CHECK cells, so silent row loss is impossible to miss.
 *
 * Everything in this file is pure (no I/O) and unit-tested: header detection
 * (bank exports bury the real header under preamble rows), date parsing with
 * corpus-wide DD/MM vs MM/DD disambiguation, amount normalisation (currency
 * prefixes, thousands separators, parentheses negatives, CR/DR markers),
 * debit/credit → one signed amount, repeated-header/footer-total/empty-row
 * cleaning, and cross-file dedupe for overlapping statement exports.
 */

// ---------------------------------------------------------------- types

export interface GridSource {
  file: string; // repo-relative path (provenance label)
  tab: string;
  grid: any[][]; // raw cells: numbers, strings, Date instances, null
}

export interface ColumnProfile {
  header: string;
  index: number;
  type: 'date' | 'number' | 'text' | 'empty';
  nonEmpty: number;
  samples: string[];
}

export interface SourceProfile {
  key: string; // "file › tab" — the provenance stamp used in the Source column
  file: string;
  tab: string;
  headerRow: number; // index into grid
  /** 1 for a normal header; 2 when a two-row hierarchical header was composed. */
  headerRowCount: number;
  headers: string[];
  columns: ColumnProfile[];
  dataRows: number; // rows below the header (before cleaning)
  preamble: string[]; // non-empty pre-header lines (account metadata etc.)
  /** Corpus evidence for slash-date order on this source's date-typed columns. */
  dateOrder: 'dmy' | 'mdy' | 'unknown';
  /** Corpus evidence for number locale on this source's number-typed columns. */
  numberLocale: NumberLocale;
  /** Columns whose values look like Excel-corrupted IDs (1.23457E+15 — low digits GONE). */
  corruptIdColumns: string[];
}

/** One output column: either a canonical field mapped per source, or a passthrough extra. */
export interface FieldPlan {
  name: string; // output header
  kind: 'date' | 'amount' | 'balance' | 'text' | 'number';
  /** per source.key → source column index, or a debit/credit index pair merged to a signed amount. */
  from: Record<string, number | { debit?: number; credit?: number } | undefined>;
}

export interface CombinePlan {
  fields: FieldPlan[];
  /** true when every source mapped a date AND an amount (or debit/credit) — safe to run unattended. */
  confident: boolean;
  notes: string[];
  /** Per source: a column that carries EXISTING provenance (a "Source" column from a prior
   *  combine) — its value is used instead of the file key, so re-combining a combined file
   *  with a new export preserves original per-row provenance (the update-with-new-file mode). */
  provenanceFrom?: Record<string, number | undefined>;
}

export interface SourceRecon {
  key: string;
  rowsIn: number;
  kept: number;
  drops: { empty: number; repeatedHeader: number; footer: number; nonData: number; duplicate: number };
  amountSum: number; // over KEPT rows of this source
  /** Date coverage of the KEPT rows — a truncated export shows up as a short range. */
  dateMin: string | null; // ISO yyyy-mm-dd
  dateMax: string | null;
}

export interface CombineResult {
  fields: FieldPlan[];
  rows: any[][]; // unified rows, field order + trailing Source column handled by the caller
  perSource: SourceRecon[];
  totalAmount: number;
  warnings: string[];
}

// ---------------------------------------------------------------- cells

const isBlank = (v: any): boolean => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

const cellText = (v: any): string => (v === null || v === undefined ? '' : String(v).trim());

/** Collapse inner whitespace — bank narratives arrive with alignment padding. */
export const cleanText = (v: any): string => cellText(v).replace(/\s+/g, ' ');

// ---------------------------------------------------------------- amounts

const CR_DR_RE = /\s*(CR|DR)\.?\s*$/i;

export type NumberLocale = 'us' | 'eu' | 'unknown';

/**
 * Parse a money-ish cell to a signed number, or null when it isn't one.
 * Handles: 1,234.56 · $1,234 · AED 1,250.00 · (1,200.00) → -1200 · 500 DR → -500 ·
 * 500 CR → 500 · trailing "-" (SAP style) → negative · EU locale 1.234,56 when the
 * column's corpus evidence says so. Bare integers ARE parsed here (unlike excel.ts
 * coerceNumeric) because a mapped amount column is known-numeric.
 */
export function parseAmountStrict(v: any, locale: NumberLocale = 'us'): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  let s = v.trim();
  if (!s) return null;
  let sign = 1;
  const crdr = s.match(CR_DR_RE);
  if (crdr) {
    if (/^dr$/i.test(crdr[1])) sign = -1;
    s = s.replace(CR_DR_RE, '').trim();
  }
  if (/^\(.*\)$/.test(s)) {
    sign *= -1;
    s = s.slice(1, -1).trim();
  }
  if (/-$/.test(s)) {
    sign *= -1;
    s = s.slice(0, -1).trim();
  }
  // currency code prefix/suffix (AED / USD / BDT …) or symbol; NBSP/thin-space grouping.
  s = s.replace(/^[A-Za-z]{2,4}\s+/, '').replace(/\s+[A-Za-z]{2,4}$/, '');
  s = s.replace(/[$£€₹¥]/g, '').replace(/[  \s']/g, '').trim();
  if (locale === 'eu') {
    // 1.234.567,89 — dots group thousands, comma is the decimal mark.
    if (/^[-+]?\d{1,3}(\.\d{3})*(,\d+)?$/.test(s)) {
      const n = Number(s.replace(/\./g, '').replace(',', '.'));
      return Number.isFinite(n) ? sign * n : null;
    }
    // A plain integer or dot-decimal still parses (mixed exports).
  }
  if (/^[-+]?\d[\d,]*(\.\d+)?$/.test(s)) {
    const n = Number(s.replace(/,/g, ''));
    return Number.isFinite(n) ? sign * n : null;
  }
  return null;
}

/**
 * Corpus evidence for a column's number locale. "1.234,56" (dot-thousands + comma-decimal)
 * proves EU; "1,234.56" proves US. A value like "1.234" alone is AMBIGUOUS (1.234 US vs
 * 1234 EU) — only the unambiguous shapes vote, exactly like dateOrderEvidence.
 */
export function numberLocaleEvidence(values: any[]): NumberLocale {
  let eu = 0;
  let us = 0;
  for (const v of values) {
    if (typeof v !== 'string') continue;
    const s = v.trim().replace(/^[A-Za-z]{2,4}\s+|[$£€₹¥()]/g, '').trim();
    if (/^\d{1,3}(\.\d{3})+,\d+$/.test(s) || /,\d{1,2}$/.test(s)) eu++;
    else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s) || /\.\d{1,2}$/.test(s)) us++;
  }
  if (eu > 0 && us === 0) return 'eu';
  if (us > 0 && eu === 0) return 'us';
  return 'unknown';
}

/** Excel scientific-notation ID corruption: "1.23457E+15" — the low digits are GONE. */
export const CORRUPT_ID_RE = /^\d(\.\d+)?E\+1[2-9]$/i;

// ---------------------------------------------------------------- dates

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const SERIAL_MIN = 20000; // 1954 — anything below is more likely an amount
const SERIAL_MAX = 80000; // 2119

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

const utc = (y: number, m: number, d: number): Date | null => {
  if (m < 0 || m > 11 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m, d));
  // Reject rollovers (31 Feb → 3 Mar) so garbage never silently becomes a date.
  return dt.getUTCMonth() === m && dt.getUTCDate() === d ? dt : null;
};

const fixYear = (y: number): number => (y < 100 ? (y < 70 ? 2000 + y : 1900 + y) : y);

/**
 * Parse one date cell. `order` resolves the DD/MM vs MM/DD ambiguity for slash/dash
 * dates — pass the corpus-wide evidence from dateOrderEvidence(); 'unknown' defaults
 * to DMY (banks outside the US) and the caller records a warning.
 */
export function parseDateValue(v: any, order: 'dmy' | 'mdy' | 'unknown' = 'unknown'): Date | null {
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate())) : null;
  if (typeof v === 'number') {
    if (v < SERIAL_MIN || v > SERIAL_MAX) return null;
    return new Date(EXCEL_EPOCH_MS + Math.round(v) * 86_400_000);
  }
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s].*)?$/); // ISO-ish
  if (m) return utc(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/); // slash/dash/dot pair
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = fixYear(Number(m[3]));
    if (a > 12 && b <= 12) return utc(y, b - 1, a); // unambiguous DMY
    if (b > 12 && a <= 12) return utc(y, a - 1, b); // unambiguous MDY
    return order === 'mdy' ? utc(y, a - 1, b) : utc(y, b - 1, a);
  }
  m = s.match(/^(\d{1,2})[\s-]([A-Za-z]{3,})[\s-,]*(\d{2,4})$/); // 12 Mar 2024 / 12-Mar-24
  if (m && MONTHS[m[2].slice(0, 3).toLowerCase()] !== undefined)
    return utc(fixYear(Number(m[3])), MONTHS[m[2].slice(0, 3).toLowerCase()], Number(m[1]));
  m = s.match(/^([A-Za-z]{3,})[\s.]+(\d{1,2})[\s,]+(\d{2,4})$/); // Mar 12, 2024
  if (m && MONTHS[m[1].slice(0, 3).toLowerCase()] !== undefined)
    return utc(fixYear(Number(m[3])), MONTHS[m[1].slice(0, 3).toLowerCase()], Number(m[2]));
  return null;
}

const SLASH_DATE_RE = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/;
const DATEISH_RE = /^(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|\d{1,2}[\s-][A-Za-z]{3,}[\s-,]*\d{2,4}|[A-Za-z]{3,}[\s.]+\d{1,2}[\s,]+\d{2,4})$/;

/** Corpus-wide slash-date order: ANY first-part>12 proves day-first; any second-part>12 proves month-first. */
export function dateOrderEvidence(values: any[]): 'dmy' | 'mdy' | 'unknown' {
  let dmy = 0;
  let mdy = 0;
  for (const v of values) {
    if (typeof v !== 'string') continue;
    const m = v.trim().match(SLASH_DATE_RE);
    if (!m) continue;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a > 12 && b <= 12) dmy++;
    else if (b > 12 && a <= 12) mdy++;
  }
  if (dmy > 0 && mdy === 0) return 'dmy';
  if (mdy > 0 && dmy === 0) return 'mdy';
  return 'unknown';
}

// ---------------------------------------------------------------- profiling

const looksDate = (v: any, headerHintsDate: boolean): boolean => {
  if (v instanceof Date) return true;
  if (typeof v === 'string') return DATEISH_RE.test(v.trim());
  // A bare number is a date only when the HEADER says so (serials are ambiguous with amounts).
  if (typeof v === 'number') return headerHintsDate && v >= SERIAL_MIN && v <= SERIAL_MAX;
  return false;
};

/**
 * Detect the real header row: bank exports open with preamble lines ("Account:
 * 1234…", date ranges, blank rows) before the actual column header. The header is
 * the first row in the top 15 with the WIDEST run of short, mostly-unique TEXT
 * cells that has at least one data row somewhere below it.
 */
export function detectHeaderRow(grid: any[][]): number {
  const LIMIT = Math.min(grid.length, 15);
  let best = 0;
  let bestScore = -1;
  for (let r = 0; r < LIMIT; r++) {
    const row = grid[r] ?? [];
    const cells = row.filter((c) => !isBlank(c));
    if (cells.length < 2) continue;
    const texty = cells.filter((c) => typeof c === 'string' && c.trim().length <= 60 && parseAmountStrict(c) === null && !looksDate(c, false));
    const uniq = new Set(texty.map((c) => String(c).trim().toLowerCase()));
    if (texty.length < Math.max(2, Math.ceil(cells.length * 0.6))) continue; // data rows are number/date-heavy
    if (uniq.size !== texty.length) continue; // headers don't repeat
    const hasDataBelow = grid.slice(r + 1).some((rr) => (rr ?? []).some((c) => !isBlank(c)));
    if (!hasDataBelow) continue;
    const score = texty.length;
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return bestScore >= 0 ? best : 0;
}

/**
 * Split a grid that holds MULTIPLE independent tables (separated by ≥2 fully-blank rows)
 * into blocks. Returns the blocks largest-first; the caller keeps the biggest and warns
 * about the rest — reading "budget at A1 + headcount at A20" as one ragged blob corrupts
 * both tables.
 */
export function splitTables(grid: any[][]): Array<{ start: number; rows: any[][] }> {
  const blocks: Array<{ start: number; rows: any[][] }> = [];
  let cur: any[][] = [];
  let curStart = 0;
  let blanks = 0;
  grid.forEach((row, i) => {
    const blank = (row ?? []).every((c) => isBlank(c));
    if (blank) {
      blanks++;
      if (blanks >= 2 && cur.some((r) => (r ?? []).some((c) => !isBlank(c)))) {
        blocks.push({ start: curStart, rows: cur });
        cur = [];
        curStart = i + 1;
      } else if (cur.length) cur.push(row);
      return;
    }
    if (!cur.length) curStart = i;
    blanks = 0;
    cur.push(row);
  });
  if (cur.some((r) => (r ?? []).some((c) => !isBlank(c)))) blocks.push({ start: curStart, rows: cur });
  // Only blocks that look like TABLES: ≥2 rows carrying ≥2 cells each (a preamble block of
  // one-cell metadata lines must not count as a "second table"). Largest first.
  const tables = blocks.filter((b) => b.rows.filter((r) => (r ?? []).filter((c) => !isBlank(c)).length >= 2).length >= 2);
  return tables.sort((a, b) => b.rows.length - a.rows.length);
}

/**
 * Two-row hierarchical header ("Revenue | (blank) | Cost | (blank)" over "Q1 | Q2 | Q1 | Q2")
 * → composed names (Revenue Q1, Revenue Q2, …). Detected when the row AFTER the header is
 * ALSO header-ish (short unique-ish text) AND the header row has spanning blanks — a data
 * row under a real header is number/date-heavy so it never qualifies.
 */
export function composeHeaders(grid: any[][], headerRow: number): { headers: string[]; headerRowCount: number } {
  const top = (grid[headerRow] ?? []).map(cellText);
  const next = grid[headerRow + 1] ?? [];
  const nextCells = next.filter((c: any) => !isBlank(c));
  const nextTexty = nextCells.filter(
    (c: any) => typeof c === 'string' && c.trim().length <= 30 && parseAmountStrict(c) === null && !looksDate(c, false),
  );
  const topBlanks = top.filter((t) => !t).length;
  const twoRow =
    nextCells.length >= 2 &&
    nextTexty.length >= Math.ceil(nextCells.length * 0.8) &&
    topBlanks >= 1 && // spanning parents leave gaps
    grid.length > headerRow + 2; // data must exist below
  if (!twoRow) return { headers: top, headerRowCount: 1 };
  const width = Math.max(top.length, next.length);
  let parent = '';
  const headers: string[] = [];
  for (let i = 0; i < width; i++) {
    if (top[i]) parent = cleanText(top[i]);
    const child = cleanText(cellText(next[i]));
    headers.push([parent, child].filter(Boolean).join(' ').trim());
  }
  return { headers, headerRowCount: 2 };
}

/**
 * WIDE (pivoted) layout: periods live as COLUMNS ("Jan-24 | Feb-24 | …"). Detected when
 * ≥4 headers parse as dates; melted to long format (label columns + Date + Value) so the
 * combine pipeline can treat it like any other transaction table.
 */
export function unpivotWide(src: GridSource): { src: GridSource; note: string } | null {
  const headerRow = detectHeaderRow(src.grid);
  const headers = (src.grid[headerRow] ?? []).map(cellText);
  const dateCols: Array<{ index: number; date: Date }> = [];
  headers.forEach((h, i) => {
    const d = parseDateValue(h) ?? parseMonthHeader(h);
    if (d) dateCols.push({ index: i, date: d });
  });
  if (dateCols.length < 4) return null;
  const labelCols = headers.map((h, i) => ({ h, i })).filter(({ i }) => !dateCols.some((d) => d.index === i) && headers[i]);
  const out: any[][] = [[...labelCols.map(({ h }) => h), 'Date', 'Value']];
  for (const row of src.grid.slice(headerRow + 1)) {
    const cells = row ?? [];
    if (cells.every((c: any) => isBlank(c))) continue;
    for (const dc of dateCols) {
      const v = cells[dc.index];
      if (isBlank(v)) continue;
      out.push([...labelCols.map(({ i }) => cells[i]), dc.date, v]);
    }
  }
  return {
    src: { ...src, grid: out },
    note: `"${src.file}${src.tab ? ` › ${src.tab}` : ''}": wide (pivoted) layout detected — unpivoted ${dateCols.length} period columns into Date + Value rows.`,
  };
}

const MONTH_HEADER_RE = /^([A-Za-z]{3,})[\s-]?['’]?(\d{2,4})$/;

/** "Jan-24" / "March 2024" style period headers → the first of that month. */
function parseMonthHeader(h: string): Date | null {
  const m = cellText(h).match(MONTH_HEADER_RE);
  if (!m) return null;
  const mon = MONTHS[m[1].slice(0, 3).toLowerCase()];
  if (mon === undefined) return null;
  return new Date(Date.UTC(fixYear(Number(m[2])), mon, 1));
}

export function profileSource(src: GridSource): SourceProfile {
  const headerRow = detectHeaderRow(src.grid);
  const composed = composeHeaders(src.grid, headerRow);
  const raw = composed.headers;
  const width = raw.length;
  const seen = new Map<string, number>();
  const headers = Array.from({ length: width }, (_, i) => {
    let h = cleanText(raw[i]) || `Column ${i + 1}`;
    const n = (seen.get(h.toLowerCase()) ?? 0) + 1;
    seen.set(h.toLowerCase(), n);
    if (n > 1) h = `${h} (${n})`;
    return h;
  });
  const data = src.grid.slice(headerRow + composed.headerRowCount);
  const columns: ColumnProfile[] = headers.map((header, index) => {
    const hintsDate = /date/i.test(header);
    let dates = 0;
    let nums = 0;
    let texts = 0;
    let nonEmpty = 0;
    const samples: string[] = [];
    for (const row of data.slice(0, 200)) {
      const v = (row ?? [])[index];
      if (isBlank(v)) continue;
      nonEmpty++;
      if (samples.length < 4) samples.push(cellText(v).slice(0, 40));
      if (looksDate(v, hintsDate)) dates++;
      else if (parseAmountStrict(v) !== null) nums++;
      else texts++;
    }
    const type: ColumnProfile['type'] =
      nonEmpty === 0 ? 'empty' : dates >= nonEmpty * 0.6 ? 'date' : nums >= nonEmpty * 0.6 ? 'number' : 'text';
    return { header, index, type, nonEmpty, samples };
  });
  const dateVals: any[] = [];
  for (const col of columns) if (col.type === 'date') for (const row of data) dateVals.push((row ?? [])[col.index]);
  const numVals: any[] = [];
  for (const col of columns) if (col.type === 'number') for (const row of data.slice(0, 200)) numVals.push((row ?? [])[col.index]);
  const corruptIdColumns = columns
    .filter((c) => data.slice(0, 200).some((row) => typeof (row ?? [])[c.index] === 'string' && CORRUPT_ID_RE.test(String((row ?? [])[c.index]).trim())))
    .map((c) => c.header);
  return {
    key: `${src.file}${src.tab ? ` › ${src.tab}` : ''}`,
    file: src.file,
    tab: src.tab,
    headerRow,
    headerRowCount: composed.headerRowCount,
    headers,
    columns,
    dataRows: data.length,
    preamble: src.grid
      .slice(0, headerRow)
      .map((r) => (r ?? []).filter((c) => !isBlank(c)).map(cellText).join(' | '))
      .filter(Boolean)
      .slice(0, 6),
    dateOrder: dateOrderEvidence(dateVals),
    numberLocale: numberLocaleEvidence(numVals),
    corruptIdColumns,
  };
}

// ---------------------------------------------------------------- auto-mapping

const norm = (h: string): string => h.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const CANON: Array<{ field: string; kind: FieldPlan['kind']; re: RegExp; not?: RegExp }> = [
  { field: 'Date', kind: 'date', re: /\b(date|posted|posting|booking)\b/, not: /\bvalue date\b/ },
  { field: 'Description', kind: 'text', re: /\b(description|details|narrative|particulars|memo|payee|merchant|remarks|item|expense|vendor|supplier)\b/ },
  { field: 'Debit', kind: 'amount', re: /\b(debit|debits|withdrawals?|paid out|money out|dr)\b/ },
  { field: 'Credit', kind: 'amount', re: /\b(credit|credits|deposits?|paid in|money in|cr)\b/ },
  { field: 'Amount', kind: 'amount', re: /\b(amount|amt|value|total)\b/, not: /\bvalue date\b/ },
  { field: 'Balance', kind: 'balance', re: /\bbalance\b/ },
  { field: 'Reference', kind: 'text', re: /\b(reference|ref|cheque|check no|receipt|transaction id|txn id|voucher)\b/ },
  { field: 'Category', kind: 'text', re: /\b(category|type|classification|class|account)\b/ },
];

/**
 * Cluster every source's headers into a unified plan. Canonical fields match by
 * synonym; a debit/credit pair merges into ONE signed Amount; every unmatched
 * source column becomes a passthrough output column (data is NEVER silently
 * dropped — pass an explicit mapping to trim). Confident ⇔ every source found a
 * date and an amount (or debit/credit) — the one-call unattended path.
 */
export function autoMapSources(profiles: SourceProfile[]): CombinePlan {
  const notes: string[] = [];
  const fields = new Map<string, FieldPlan>();
  const provenanceFrom: Record<string, number | undefined> = {};
  const ensure = (name: string, kind: FieldPlan['kind']): FieldPlan => {
    let f = fields.get(name.toLowerCase());
    if (!f) {
      f = { name, kind, from: {} };
      fields.set(name.toLowerCase(), f);
    }
    return f;
  };
  let confident = true;

  for (const p of profiles) {
    const claimed = new Set<number>();
    // A column literally named "Source" is a prior combine's provenance stamp — carry its
    // VALUES through instead of overwriting them with this file's key (update mode).
    const srcCol = p.columns.find((c) => norm(c.header) === 'source' && c.type === 'text');
    if (srcCol) {
      provenanceFrom[p.key] = srcCol.index;
      claimed.add(srcCol.index);
    }
    if (p.corruptIdColumns.length)
      notes.push(
        `"${p.key}": column(s) ${p.corruptIdColumns.join(', ')} contain Excel-corrupted IDs (scientific notation like 1.23457E+15 — the low digits are permanently lost). The values are carried through AS-IS; recover them from the original system export if joins depend on them.`,
      );
    const byField = new Map<string, number>();
    for (const canon of CANON) {
      let bestIdx = -1;
      for (const col of p.columns) {
        if (claimed.has(col.index) || col.type === 'empty') continue;
        const h = norm(col.header);
        if (canon.not?.test(h) || !canon.re.test(h)) continue;
        // A date field must be date-typed; amount/balance must be number-or-date-serial-free.
        if (canon.kind === 'date' && col.type !== 'date') continue;
        if ((canon.kind === 'amount' || canon.kind === 'balance') && col.type === 'text') continue;
        if (bestIdx === -1) bestIdx = col.index;
        // Prefer the plain/transaction date over anything longer-named.
        if (canon.field === 'Date' && /^(transaction |txn |posting |post )?date$/.test(h)) bestIdx = col.index;
      }
      if (bestIdx >= 0) {
        claimed.add(bestIdx);
        byField.set(canon.field, bestIdx);
      }
    }
    const hasDate = byField.has('Date');
    const debit = byField.get('Debit');
    const credit = byField.get('Credit');
    const amount = byField.get('Amount');
    if (debit !== undefined || credit !== undefined) {
      ensure('Amount', 'amount').from[p.key] = { debit, credit };
    } else if (amount !== undefined) {
      ensure('Amount', 'amount').from[p.key] = amount;
    }
    if (hasDate) ensure('Date', 'date').from[p.key] = byField.get('Date');
    for (const f of ['Description', 'Balance', 'Reference', 'Category'] as const) {
      if (byField.has(f)) ensure(f, f === 'Balance' ? 'balance' : 'text').from[p.key] = byField.get(f);
    }
    if (!hasDate || (debit === undefined && credit === undefined && amount === undefined)) {
      confident = false;
      notes.push(`"${p.key}": could not auto-map ${!hasDate ? 'a date column' : 'an amount (or debit/credit) column'} — headers: ${p.headers.join(', ')}`);
    }
    // Passthrough extras — merged across sources by identical normalized header.
    for (const col of p.columns) {
      if (claimed.has(col.index) || col.type === 'empty') continue;
      ensure(cleanText(col.header), col.type === 'number' ? 'number' : 'text').from[p.key] = col.index;
    }
    if (p.dateOrder === 'unknown' && p.columns.some((c) => c.type === 'date' && c.samples.some((s) => SLASH_DATE_RE.test(s))))
      notes.push(`"${p.key}": slash-date order is ambiguous in the sample — assuming day-first (DD/MM); pass a mapping note if this source is US-format.`);
  }

  // Field order: canonical first, then extras in first-seen order.
  const ordered: FieldPlan[] = [];
  for (const name of ['Date', 'Description', 'Amount', 'Balance', 'Reference', 'Category']) {
    const f = fields.get(name.toLowerCase());
    if (f) {
      ordered.push(f);
      fields.delete(name.toLowerCase());
    }
  }
  ordered.push(...fields.values());
  return { fields: ordered, confident, notes, provenanceFrom };
}

// ---------------------------------------------------------------- combine

const FOOTER_RE = /\b(sub)?totals?\b|closing balance|opening balance|balance (brought|carried) forward|grand total|end of (statement|report)/i;

export interface CombineOptions {
  dedupe?: boolean; // default true
  sort?: boolean; // default true (by date, undated last)
}

export function combineSources(
  sources: GridSource[],
  profiles: SourceProfile[],
  plan: CombinePlan,
  options: CombineOptions = {},
): CombineResult {
  const dedupe = options.dedupe !== false;
  const sort = options.sort !== false;
  const warnings: string[] = [...plan.notes];
  const perSource: SourceRecon[] = [];
  const out: Array<{ cells: any[]; date: Date | null; source: string; order: number }> = [];
  const seenKeys = new Set<string>();
  let unparsedDates = 0;
  let order = 0;

  for (let si = 0; si < sources.length; si++) {
    const src = sources[si];
    const p = profiles[si];
    const recon: SourceRecon = {
      key: p.key,
      rowsIn: p.dataRows,
      kept: 0,
      drops: { empty: 0, repeatedHeader: 0, footer: 0, nonData: 0, duplicate: 0 },
      amountSum: 0,
      dateMin: null,
      dateMax: null,
    };
    const data = src.grid.slice(p.headerRow + (p.headerRowCount ?? 1));
    const headerLower = p.headers.map((h) => h.toLowerCase());
    const provIdx = plan.provenanceFrom?.[p.key];
    for (const row of data) {
      const cells = row ?? [];
      if (cells.every((c: any) => isBlank(c))) {
        recon.drops.empty++;
        continue;
      }
      // Repeated in-file header (concatenated exports re-print it mid-stream).
      const matchHeader = cells.filter((c: any, i: number) => typeof c === 'string' && headerLower[i] && cleanText(c).toLowerCase() === headerLower[i]).length;
      if (matchHeader >= 2 && matchHeader >= cells.filter((c: any) => !isBlank(c)).length - 1) {
        recon.drops.repeatedHeader++;
        continue;
      }
      // Build the unified row.
      const unified: any[] = [];
      let date: Date | null = null;
      let amount: number | null = null;
      let descText = '';
      for (const f of plan.fields) {
        const from = f.from[p.key];
        if (from === undefined) {
          unified.push(null);
          continue;
        }
        if (typeof from === 'object') {
          // debit/credit pair → one signed amount (credit +, debit −)
          const d = from.debit !== undefined ? parseAmountStrict(cells[from.debit], p.numberLocale) : null;
          const c = from.credit !== undefined ? parseAmountStrict(cells[from.credit], p.numberLocale) : null;
          const merged = c !== null || d !== null ? (c ?? 0) - Math.abs(d ?? 0) : null;
          unified.push(merged);
          if (f.kind === 'amount') amount = merged;
          continue;
        }
        const v = cells[from];
        if (f.kind === 'date') {
          date = parseDateValue(v, p.dateOrder);
          if (date === null && !isBlank(v)) {
            unparsedDates++;
            unified.push(cleanText(v)); // keep the raw text — never silently blank a cell
          } else unified.push(date);
        } else if (f.kind === 'amount' || f.kind === 'balance' || f.kind === 'number') {
          const n = parseAmountStrict(v, p.numberLocale);
          unified.push(n !== null ? n : isBlank(v) ? null : cleanText(v));
          if (f.kind === 'amount') amount = n;
        } else {
          const t = cleanText(v);
          unified.push(t || null);
          if (f.name === 'Description') descText = t;
        }
      }
      // Footer/total rows: no parsed date + a total-ish label — metadata, not a transaction.
      if (date === null && FOOTER_RE.test(descText || cells.map(cellText).join(' '))) {
        recon.drops.footer++;
        continue;
      }
      // A row with neither a date nor an amount isn't a record (stray notes, ruler rows).
      if (date === null && amount === null) {
        recon.drops.nonData++;
        continue;
      }
      if (dedupe && date !== null && amount !== null) {
        const key = `${date.toISOString().slice(0, 10)}|${(descText || '').toLowerCase()}|${amount.toFixed(2)}`;
        if (seenKeys.has(key)) {
          recon.drops.duplicate++;
          continue;
        }
        seenKeys.add(key);
      }
      recon.kept++;
      if (amount !== null) recon.amountSum += amount;
      if (date !== null) {
        const iso = date.toISOString().slice(0, 10);
        if (!recon.dateMin || iso < recon.dateMin) recon.dateMin = iso;
        if (!recon.dateMax || iso > recon.dateMax) recon.dateMax = iso;
      }
      const prov = provIdx !== undefined ? cleanText(cells[provIdx]) : '';
      out.push({ cells: unified, date, source: prov || p.key, order: order++ });
    }
    // Internal invariant — reconciliation MUST balance or the engine itself is broken.
    const counted = recon.kept + recon.drops.empty + recon.drops.repeatedHeader + recon.drops.footer + recon.drops.nonData + recon.drops.duplicate;
    if (counted !== recon.rowsIn) throw new Error(`combine reconciliation bug: "${p.key}" ${recon.rowsIn} rows in vs ${counted} accounted`);
    perSource.push(recon);
  }

  if (unparsedDates > 0) warnings.push(`${unparsedDates} row(s) had a date that could not be parsed — the raw text was kept in the Date column (review them).`);
  if (sort) out.sort((a, b) => (a.date && b.date ? a.date.getTime() - b.date.getTime() || a.order - b.order : a.date ? -1 : b.date ? 1 : a.order - b.order));

  return {
    fields: plan.fields,
    rows: out.map((r) => [...r.cells, r.source]),
    perSource,
    totalAmount: perSource.reduce((n, s) => n + s.amountSum, 0),
    warnings,
  };
}
