import fs from 'node:fs';
import { resolveInWorkspace, type ToolDef } from './common';
import { recalcSheetData, recalcWorkbook } from './sheetcalc';
import { auditFormulaRefs, auditExcelWorkbook, formulaAuditLines } from './sheetAudit';
import { expandPatternSheets } from '../excelPattern';
import { EXCEL_SCAFFOLDS, applyScaffold } from '../excelScaffolds';
import { ToolError } from './common';
import { STRINGY_REF_RE } from '../deliverableCheck';

type ColType = 'text' | 'number' | 'currency' | 'percent' | 'date';
interface ColSpec {
  header: string;
  key?: string;
  width?: number;
  type?: ColType;
  /** Explicit Excel number-format override for this column (beats `type`). */
  numFmt?: string;
}

const NUM_FMT: Record<ColType, string | undefined> = {
  text: undefined,
  number: '#,##0.###',
  currency: '$#,##0.00', // default only — overridden by the workbook `currency` option
  percent: '0.0%',
  date: 'yyyy-mm-dd',
};

/** Build the currency numFmt from the brief's currency — a symbol prefixes directly
 *  ("$#,##0.00"), a 2–4 letter ISO code is quoted with a space ('"AED" #,##0.00').
 *  This is what stops every workbook defaulting to US dollars. */
export function currencyNumFmt(currency: string | undefined): string {
  const c = String(currency || '').trim();
  if (!c) return NUM_FMT.currency!;
  if (/^[A-Za-z]{2,4}$/.test(c)) return `"${c.toUpperCase()}" #,##0.00`;
  return `${c}#,##0.00`; // a symbol like $, €, £, ৳, ¥
}

/** Normalise a hex like "#4f46e5" / "4f46e5" to an ARGB string exceljs wants. */
export function toArgb(hex: string | undefined, fallback: string): string {
  const h = String(hex || '').replace('#', '').trim();
  if (/^[0-9a-fA-F]{6}$/.test(h)) return 'FF' + h.toUpperCase();
  return fallback;
}

/**
 * A row cell may be a literal value, a formula string like "=B2*C2", or
 * { f: "B2*C2", v: 1234 } (formula + cached result so the value shows before Excel
 * recalculates, and so the SheetJS validation/preview can read it). Converts those
 * into ExcelJS formula cells; leaves plain values untouched. This is what lets a
 * model be genuinely formula-driven (change one assumption → everything flows).
 */
/**
 * A model often emits a numeric metric AS TEXT (e.g. "480,000.", "$15,000", "49.6"). Stored as
 * text, Excel's SUM ignores it → dashboard totals read 0 (a real bug we saw). Coerce strings that
 * are CLEARLY a formatted number (thousands commas, a currency symbol, or a decimal point) to a
 * real number. Bare integer strings (possible IDs/codes/zips) and anything else are left as text.
 */
export function coerceNumeric(v: any): any {
  if (typeof v !== 'string') return v;
  const s = v.trim();
  const formatted =
    /^[-+]?[$£€]?\d{1,3}(,\d{3})+(\.\d+)?\.?$/.test(s) || // 480,000.  $15,000  1,580,000.
    /^[-+]?[$£€]\d+(\.\d+)?$/.test(s) ||                  // $48713
    /^[-+]?\d+\.\d+$/.test(s);                            // 49.6  3.13
  if (!formatted) return v;
  const n = Number(s.replace(/[$£€,\s]/g, '').replace(/\.$/, ''));
  return Number.isFinite(n) ? n : v;
}

export function toCell(v: any): any {
  if (typeof v === 'string') {
    const s = v.trim();
    // Some models (M3) emit a formula-cell OBJECT as a JSON STRING because the cell schema is
    // untyped — e.g. '{"f":"B2*C2","v":1234}'. Parse it back into a real formula cell, else it
    // gets stored as TEXT and the model isn't actually formula-driven (a real live bug).
    if (s.length > 3 && s[0] === '{' && s.includes('"f"')) {
      try {
        const o = JSON.parse(s);
        if (o && typeof o.f === 'string') return o.v !== undefined ? { formula: o.f, result: o.v } : { formula: o.f };
      } catch {
        /* not valid JSON — fall through and treat as text */
      }
    }
    if (s.length > 1 && s[0] === '=') return { formula: s.slice(1) };
    // A bare cross-sheet/cell reference written WITHOUT the leading "=" (a common model
    // mistake, e.g. "Assumptions!$B$10" typed as text). Coerce it to a LIVE formula so the
    // link works in Excel instead of sitting as inert text that breaks every dependent cell.
    if (STRINGY_REF_RE.test(s)) return { formula: s };
    return coerceNumeric(v);
  }
  if (v && typeof v === 'object' && typeof v.f === 'string') {
    return v.v !== undefined ? { formula: v.f, result: v.v } : { formula: v.f };
  }
  return coerceNumeric(v);
}
function toRow(r: any): any {
  if (Array.isArray(r)) return r.map(toCell);
  if (r && typeof r === 'object') {
    const o: Record<string, any> = {};
    for (const k of Object.keys(r)) o[k] = toCell(r[k]);
    return o;
  }
  return r;
}

/** A row whose first-column label reads as a roll-up — bolded + top-ruled so models scan like finance. */
const TOTAL_ROW_RE = /\b(total|subtotal|grand total|net|gross|closing|opening|ending|balance|ebitda|profit|surplus|deficit|cumulative|runway)\b/i;
/** The BIG roll-ups (statement bottom lines) get the double top rule — the accounting convention. */
const GRAND_ROW_RE = /\b(grand total|net income|net profit|net cash|ending (cash|balance)|closing (cash|balance)|total (assets|liabilities|equity))\b/i;
/** Sheets whose literal numbers are USER INPUTS — they get the classic finance input-blue font. */
const INPUT_SHEET_RE = /\b(assumption|driver|input)s?\b/i;

// ---- PREMIUM THEME (deterministic — applied at build time, never a review pass) ----
// The look is baked in so a workbook is premium ON THE FIRST WRITE: Helvetica throughout
// (Excel substitutes Arial where absent — visually equivalent), gridlines hidden so the
// zebra banding + hairlines carry the structure, an accent-tinted band instead of generic
// grey, finance conventions (double rule under bottom lines, blue input font on assumption
// sheets, italic-muted check rows), and accent-coloured tabs.
const THEME_FONT = 'Helvetica';
const INK = 'FF1F1F1F'; // near-black data ink
const INPUT_BLUE = 'FF1F55C4'; // the finance convention: blue = hard-coded input
const CHECK_GREY = 'FF8A8F98'; // tie-out check rows read as audit furniture, not data

/** Blend the accent toward white for the zebra band (ratio = share of white). Exported for tests. */
export function accentTint(accentArgb: string, ratio = 0.93): string {
  const ch = (i: number) => parseInt(accentArgb.slice(i, i + 2), 16);
  const mix = (c: number) =>
    Math.round(255 * ratio + c * (1 - ratio))
      .toString(16)
      .padStart(2, '0')
      .toUpperCase();
  return `FF${mix(ch(2))}${mix(ch(4))}${mix(ch(6))}`;
}

function firstCellLabel(cell: any): string {
  if (typeof cell === 'string') return cell;
  if (cell && typeof cell === 'object') {
    if (typeof cell.text === 'string') return cell.text; // exceljs rich/formula cell
    if (Array.isArray(cell.richText)) return cell.richText.map((p: any) => p?.text || '').join('');
  }
  return '';
}

/**
 * A correct-by-construction 3-statement financial-model SKELETON (Assumptions → Income →
 * CashFlow), seeded by generate_spreadsheet's template:"financial-model". The cross-sheet wiring
 * is exactly right — every derived cell is a live {f,v} formula with ABSOLUTE refs, no banner/
 * section rows, and a FULLY-POPULATED Cash Flow — so it passes auditFormulaModel / detectBannerRows
 * / emptyStatementSheet / auditNumericSanity by construction (the empty-Cash-Flow gap can't recur).
 * The model then renames line items + tunes the Assumptions for its business; the formulas flow.
 * Single-word sheet names (no spaces/&) so refs need no quoting; names match the statement regexes.
 */
export function financialModelScaffold(): Array<{ name: string; columns: ColSpec[]; rows: any[] }> {
  const cur: ColSpec[] = [
    { header: 'Line item', type: 'text' },
    { header: 'Year 1', type: 'currency' },
    { header: 'Year 2', type: 'currency' },
    { header: 'Year 3', type: 'currency' },
  ];
  const f = (formula: string, v: number) => ({ f: formula, v }); // formula cell (no leading "=")
  return [
    {
      // INPUT sheet — hard-coded drivers are correct here (the model edits these numbers).
      name: 'Assumptions',
      columns: [{ header: 'Driver', type: 'text' }, { header: 'Value', type: 'number' }],
      rows: [
        ['Starting revenue', 500000],     // B2
        ['Revenue growth (yoy)', 0.15],   // B3
        ['COGS (% of revenue)', 0.4],     // B4
        ['Operating expenses (% of revenue)', 0.3], // B5
        ['Tax rate', 0.09],               // B6
        ['Depreciation per year', 10000], // B7
        ['Capex per year', 50000],        // B8
        ['Starting cash', 100000],        // B9
      ],
    },
    {
      name: 'Income',
      columns: cur,
      rows: [
        ['Revenue', f('Assumptions!$B$2', 500000), f('B2*(1+Assumptions!$B$3)', 575000), f('C2*(1+Assumptions!$B$3)', 661250)],
        ['Cost of goods sold', f('-B2*Assumptions!$B$4', -200000), f('-C2*Assumptions!$B$4', -230000), f('-D2*Assumptions!$B$4', -264500)],
        ['Gross profit', f('B2+B3', 300000), f('C2+C3', 345000), f('D2+D3', 396750)],
        ['Operating expenses', f('-B2*Assumptions!$B$5', -150000), f('-C2*Assumptions!$B$5', -172500), f('-D2*Assumptions!$B$5', -198375)],
        ['Depreciation', f('-Assumptions!$B$7', -10000), f('-Assumptions!$B$7', -10000), f('-Assumptions!$B$7', -10000)],
        ['EBIT', f('B4+B5+B6', 140000), f('C4+C5+C6', 162500), f('D4+D5+D6', 188375)],
        ['Tax', f('-B7*Assumptions!$B$6', -12600), f('-C7*Assumptions!$B$6', -14625), f('-D7*Assumptions!$B$6', -16953.75)],
        ['Net income', f('B7+B8', 127400), f('C7+C8', 147875), f('D7+D8', 171421.25)],
      ],
    },
    {
      name: 'CashFlow',
      columns: cur,
      rows: [
        ['Net income', f('Income!$B$9', 127400), f('Income!$C$9', 147875), f('Income!$D$9', 171421.25)],
        ['Add: depreciation', f('-Income!$B$6', 10000), f('-Income!$C$6', 10000), f('-Income!$D$6', 10000)],
        ['Less: capital expenditure', f('-Assumptions!$B$8', -50000), f('-Assumptions!$B$8', -50000), f('-Assumptions!$B$8', -50000)],
        ['Net change in cash', f('B2+B3+B4', 87400), f('C2+C3+C4', 107875), f('D2+D3+D4', 131421.25)],
        ['Beginning cash', f('Assumptions!$B$9', 100000), f('B7', 187400), f('C7', 295275)],
        ['Ending cash', f('B6+B5', 187400), f('C6+C5', 295275), f('D6+D5', 426696.25)],
      ],
    },
  ];
}

/**
 * Build ONE worksheet into the workbook with the full ArksAI styling pass: branded frozen
 * header, typed number/date formats, zebra banding, auto widths, auto-filter, and — for
 * finance — bold/ruled total rows. Pulled out so the fresh build AND the incremental
 * (append) path share identical styling, and so a large model assembled sheet-by-sheet still
 * looks designed, not like a raw script dump.
 */
export function buildSheet(wb: any, s: any, accentArgb: string, currencyFmt?: string): { name: string; rows: number } {
  const name = String(s.name || 'Sheet').slice(0, 31);
  const cols: ColSpec[] = Array.isArray(s.columns) ? s.columns : [];
  const rows: any[] = Array.isArray(s.rows) ? s.rows : [];
  // Gridlines OFF — the banding + hairlines carry the structure (the single biggest
  // "premium vs raw dump" visual). Wide time-series models also freeze the label column.
  const ws = wb.addWorksheet(name, {
    views: [{ state: 'frozen', ySplit: 1, xSplit: cols.length > 6 ? 1 : 0, showGridLines: false }],
  });
  ws.properties.tabColor = { argb: accentArgb };

  ws.columns = cols.map((c, i) => ({
    header: c.header,
    key: c.key || c.header || `c${i}`,
    width: c.width && c.width > 0 ? c.width : Math.min(40, Math.max(12, String(c.header || '').length + 4)),
  }));

  // Data rows (cells may be literal values OR formulas — see toCell/toRow).
  for (const r of rows) ws.addRow(toRow(r));

  // Base typography + number/date formats + right-align numerics, applied per COLUMN (one
  // pass over existing cells — the header is restyled after, so it keeps its own face).
  // Per-column numFmt beats type; the workbook currency option beats the $-default.
  cols.forEach((c, i) => {
    const fmt = c.numFmt || (c.type === 'currency' && currencyFmt ? currencyFmt : c.type ? NUM_FMT[c.type] : undefined);
    const col = ws.getColumn(i + 1);
    col.font = { name: THEME_FONT, size: 10, color: { argb: INK } };
    if (fmt) col.numFmt = fmt;
    if (c.type && c.type !== 'text' && c.type !== 'date') col.alignment = { horizontal: 'right' };
  });

  // Per-ROW number formats (pattern dialect `fmt`) — a model's rows are heterogeneous
  // (money vs ratio vs units), so these OVERRIDE the column format for that row's cells.
  const rowFmts = ((s as any).__rowFmts ?? {}) as Record<number, string>;
  const resolveFmt = (k: string): string | undefined =>
    k === 'currency'
      ? currencyFmt || '#,##0.00' // no workbook currency → neutral 2dp money, never assume $
      : k === 'percent'
        ? NUM_FMT.percent
        : k === 'number'
          ? NUM_FMT.number
          : k || undefined;
  for (const [riStr, key] of Object.entries(rowFmts)) {
    const fmt = resolveFmt(String(key));
    if (!fmt) continue;
    ws.getRow(Number(riStr) + 2).eachCell((cell: any, cn: number) => {
      if (cn > 1) cell.numFmt = fmt;
    });
  }

  // Header styling — branded, bold, readable. AFTER the column pass so it wins row 1.
  // Headers over numeric columns right-align with their numbers (finance convention).
  const head = ws.getRow(1);
  head.height = 24;
  head.eachCell((cell: any, cn: number) => {
    const t = cols[cn - 1]?.type;
    cell.font = { name: THEME_FONT, bold: true, color: { argb: 'FFFFFFFF' }, size: 10.5 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: accentArgb } };
    cell.alignment = { vertical: 'middle', horizontal: cn > 1 && t && t !== 'text' && t !== 'date' ? 'right' : 'left' };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFFFFFFF' } } };
  });

  // Cosmetic passes are per-cell object writes — O(rows × cols) allocations. On BIG DATA
  // sheets they dominate build time without adding information, so they cap out: zebra and
  // total-row detection stop past 5k rows (a 100k-row export is a dataset, not a statement),
  // and auto-width samples the first 500 rows (widths converge long before that).
  const BIG = rows.length > 5000;

  // Zebra banding — a light tint of the ACCENT, not generic grey, so the file reads branded.
  const bandArgb = accentTint(accentArgb);
  if (!BIG) {
    ws.eachRow((row: any, n: number) => {
      if (n > 1 && n % 2 === 1) {
        row.eachCell((cell: any) => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bandArgb } };
        });
      }
    });
  }

  // Total/roll-up rows: bold + a hairline top rule; statement BOTTOM LINES (net income,
  // ending cash, grand total…) get the accounting double rule.
  if (!BIG) {
    ws.eachRow((row: any, n: number) => {
      if (n === 1) return;
      const label = firstCellLabel(row.getCell(1).value);
      if (!TOTAL_ROW_RE.test(label)) return;
      const rule = GRAND_ROW_RE.test(label) ? 'double' : 'thin';
      row.eachCell((cell: any) => {
        cell.font = { ...(cell.font || {}), name: THEME_FONT, bold: true };
        cell.border = { ...(cell.border || {}), top: { style: rule, color: { argb: 'FFB8B8B0' } } };
      });
    });
  }

  // Tie-out CHECK rows: italic + muted — audit furniture, not data. Both the pattern
  // dialect's `check:` rows (__checkRows) and any row LABELLED as a check/tie-out (the
  // same convention deliverableCheck's zero-derived-row heuristic exempts).
  const checkRowNums = new Set<number>((((s as any).__checkRows ?? []) as number[]).map((ri) => ri + 2));
  if (!BIG) {
    ws.eachRow((row: any, n: number) => {
      if (n === 1) return;
      if (!checkRowNums.has(n) && !/^\s*check\b|tie.?out/i.test(firstCellLabel(row.getCell(1).value))) return;
      row.eachCell((cell: any) => {
        cell.font = { ...(cell.font || {}), name: THEME_FONT, italic: true, color: { argb: CHECK_GREY }, bold: false };
      });
    });
  }

  // Assumption/driver sheets: literal numbers are USER INPUTS → the classic finance
  // input-blue font, so anyone opening the model knows exactly which cells to edit.
  if (!BIG && INPUT_SHEET_RE.test(name)) {
    ws.eachRow((row: any, n: number) => {
      if (n === 1) return;
      row.eachCell((cell: any) => {
        if (typeof cell.value === 'number') {
          cell.font = { ...(cell.font || {}), name: THEME_FONT, color: { argb: INPUT_BLUE } };
        }
      });
    });
  }

  // Auto width refinement (sampled — widths converge within a few hundred rows).
  const WIDTH_SAMPLE = 500;
  cols.forEach((_c, i) => {
    const col = ws.getColumn(i + 1);
    if (_c.width && _c.width > 0) return;
    let max = String(cols[i]?.header || '').length;
    let seen = 0;
    col.eachCell({ includeEmpty: false }, (cell: any) => {
      if (seen++ > WIDTH_SAMPLE) return;
      // A Date cell renders ~10 chars ("2024-01-15") — String(Date) is a 60-char tz dump
      // that would balloon the column to the width cap.
      const len = cell.value instanceof Date ? 10 : String(cell.value ?? '').length;
      if (len > max) max = len;
    });
    col.width = Math.min(48, Math.max(12, max + 3));
  });

  // Auto-filter belongs on DATA TABLES; on a financial model/statement the header arrows
  // read as clutter, so pattern-expanded model sheets skip it.
  if (cols.length && !(s as any).__pattern) {
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
  }
  return { name, rows: rows.length };
}

/**
 * Generate a styled, validated .xlsx spreadsheet from a high-level spec — so a
 * non-technical user gets a genuinely designed sheet (branded header, number/
 * date formats, zebra banding, frozen header, auto-filter), not a raw dump.
 * Validates by re-opening the file and checking the rows actually wrote.
 */
export const generateSpreadsheetTool: ToolDef = {
  name: 'generate_spreadsheet',
  description:
    'Create a polished, professionally styled Excel (.xlsx) file from a high-level spec — branded ' +
    'header row, number/currency/percent/date formatting, auto column widths, zebra banding, frozen ' +
    'header and auto-filter are applied for you. Provide one or more sheets, each with typed columns ' +
    'and rows. The file is validated after writing and offered to the user as a download. Prefer this ' +
    'over hand-writing a script when the deliverable is a spreadsheet. Cells may be values OR formulas — ' +
    'REQUIRED for any model: make every DERIVED number a LIVE formula, passed as {"f":"C5*(1+Assumptions!B5)","v":<result>} ' +
    '(formula + cached result, so the preview and first open show the number) or as a "=B2*C2" string; totals via =SUM(...). ' +
    'A finance/cash-flow/budget/forecast/model sheet that hard-codes its totals, balances or growth WILL BE REJECTED by the ' +
    'automated review and sent back to you. ' +
    'CLEAN CALC STRUCTURE (so your formula references are correct): the COLUMNS are row 1 and DATA starts at row 2 — ' +
    'do NOT put a decorative title/banner/section row (e.g. "── CASH FLOW ──" or a merged caption) INSIDE a sheet\'s ' +
    'rows: it shifts every cell down and breaks absolute references like Assumptions!$B$4 (a recurring bug — REVENUE ends ' +
    'up pointing at the wrong row). Put the sheet title in the TAB NAME, keep one clean header row, and reference cells by ' +
    'their real position (header=row1, first data=row2). ' +
    'STYLING IS FULLY AUTOMATIC — a premium theme (Helvetica typography, hidden gridlines, accent-tinted banded rows, ' +
    'finance rules under totals, blue input font on assumption sheets, coloured tabs) is applied at build time. Do NOT ' +
    'spend calls on cosmetics and NEVER add decorative banner/section/title rows or hand styling — your job is CONTENT ' +
    'AND FORMULAS only. STANDARDS: make it FORMULA-DRIVEN — never hard-code a derived number ' +
    '(totals via SUM, ratios/growth as formulas) so changing an assumption flows through; lead with a Summary/KPI ' +
    'sheet; give every column an explicit type (currency/percent/date) so numbers align and format consistently; ' +
    'no orphan/empty columns. The output is auto re-opened, recalculated and formula-error-checked — a broken or ' +
    'untied model is sent back to you to fix (there is no cosmetic review pass; the numbers gate, the look is baked in). ' +
    'TIME-SERIES / FINANCIAL MODELS — USE PATTERN SHEETS (the DEFAULT for any month-by-month or projection model; ' +
    '~10x faster and immune to wrong-row references): write each sheet as {"name":"Revenue","months":24,"rows":[ROW,...]} ' +
    'where ROW is {"label":"...","value":N} (a single assumption), {"label":"...","each":"=F"} (formula every month), or ' +
    '{"label":"...","first":"=F1","then":"=F"} (M1 uses first; later months use then, where {PREV} is this row\'s ' +
    'previous-month cell). In formulas NEVER write cell addresses — reference rows BY LABEL: {ROW:Label} (same sheet, ' +
    'current month\'s column), {ROW:Sheet!Label} (another sheet; an assumptions/value-only sheet resolves absolutely). ' +
    'Example: {"label":"Units","first":"={ROW:Assumptions!base units}","then":"={PREV}*(1+{ROW:Assumptions!growth rate})"}. ' +
    'Give each pattern row a "fmt" — "currency" (uses the workbook currency), "percent", "number", or an explicit Excel ' +
    'format like "0.0000" / "#,##0" — model rows are heterogeneous (money vs ratio vs units) and the right per-row format ' +
    'is what makes the sheet read professionally. ' +
    'The server expands patterns into all columns deterministically and the full audit runs on the result. One call ' +
    'usually fits the WHOLE model — no staging needed. Verbose cell rows below remain for ad-hoc data tables. ' +
    'LARGE / GRANULAR MODELS (e.g. a 3-year MONTH-BY-MONTH CAPEX+OPEX with many line items, or any model with many ' +
    'sheets) — BUILD IT IN A FEW STAGES. Avoid BOTH extremes: cramming EVERY sheet into one giant call (slow, can ' +
    'stall or hit the output limit and truncate) AND one sheet per call (needlessly slow — each call is a full ' +
    'round-trip). The sweet spot is 2-3 SHEETS PER CALL: make the FIRST call with the "Assumptions" sheet plus the ' +
    'first 1-2 schedules (drivers — rents, salaries, unit costs, growth/escalation %), then call AGAIN with ' +
    '"append": true adding the next 2-3 sheets each time (e.g. CAPEX+OPEX, then Personnel+Summary/P&L), each ' +
    'referencing the earlier sheets with cross-sheet formulas (=Assumptions!$B$2). Append keeps ' +
    'the SAME file, preserves prior sheets, restyles, and re-checks the whole workbook; re-sending a sheet name REPLACES it. ' +
    'This ships a big, detailed, formula-driven model in ~half the round-trips, without a single giant payload. ' +
    'EXTRACTING FROM SOURCE DOCUMENTS (PDFs/scans → a spreadsheet): NEVER pivot straight to the final grid. First ' +
    'transcribe EVERY line item into a flat audit-trail sheet (one row per source line, with its OWN date/month read ' +
    'from the row — never inferred — plus which document it came from); build the summary/pivot sheet FROM that with ' +
    'live formulas; then RECONCILE each source document\'s extracted total back to its printed total and surface any ' +
    'mismatch; and DE-DUPE identical documents. Dropping a row, a supplier, or a whole document — or mis-filing a row ' +
    'into the wrong month — is the #1 failure here; the reconciliation is what catches it, so always include it. For a ' +
    'SCANNED PDF read the page IMAGES with see_image (its text layer is unreliable). ' +
    'WHEN TO ESCALATE TO openpyxl: this tool is the default and is validated for you, but for a model it ' +
    'genuinely can\'t express cleanly — a true 3-statement model with circular links (interest↔debt↔cash), ' +
    'NPV/IRR/XIRR, VLOOKUP/INDEX-MATCH, dynamic period logic — you MAY build it by hand with a Python/openpyxl ' +
    'script (write REAL formulas into the cells, never dumped literals), then call recalc_spreadsheet ONCE to ' +
    'compute every value authoritatively and check for error cells. A correct one-shot model is worth a longer ' +
    'build; don\'t hand-loop soffice to re-verify — recalc_spreadsheet is the single trustworthy check.',
  parameters: {
    type: 'object',
    properties: {
      output: { type: 'string', description: 'Output filename, e.g. "sales.xlsx". Default data.xlsx. For a staged build, keep the SAME filename across calls.' },
      template: {
        type: 'string',
        enum: [
          'financial-model', 'revenue-forecast', 'three-statement', 'dcf-valuation', 'loan-amortization', 'saas-mrr', 'headcount-plan',
          'forecast-trend', 'scenario-forecast', 'budget-vs-actual', 'cash-runway', 'break-even', 'unit-economics', 'npv-project',
          'capex-depreciation', 'working-capital', 'sales-pipeline', 'sales-commission', 'marketing-funnel', 'kpi-dashboard',
          'cohort-retention', 'ab-test', 'inventory-planning', 'project-budget', 'attrition-headcount', 'personal-budget',
          'savings-goal', 'rental-property', 'ecommerce-pnl',
        ],
        description:
          'Seed a correct, fully-wired, CHECK-ROW-carrying model skeleton instead of building from scratch — THE FASTEST, MOST ACCURATE path for any standard model; ' +
          'PREFER a template whenever one fits the ask. ' +
          'FINANCE: revenue-forecast · three-statement · dcf-valuation · loan-amortization · saas-mrr · headcount-plan · budget-vs-actual · cash-runway (burn/runway) · ' +
          'break-even · unit-economics (CAC/LTV) · npv-project (appraisal) · capex-depreciation · working-capital (DSO/DIO/DPO, CCC). ' +
          'PREDICTION: forecast-trend (least-squares + smoothing) · scenario-forecast (bear/base/bull). ' +
          'SALES & MARKETING: sales-pipeline (funnel) · sales-commission (tiered) · marketing-funnel (spend→customers, CAC/ROAS). ' +
          'BI & ANALYTICS: kpi-dashboard (actual vs target, MoM, flags) · cohort-retention (decay + LTV) · ab-test (z-score significance). ' +
          'OPERATIONS: inventory-planning (EOQ/reorder) · project-budget (planned vs actual). HR: attrition-headcount. ' +
          'PERSONAL & PROPERTY: personal-budget · savings-goal (compounding) · rental-property (NOI/cap rate/DSCR). E-COMMERCE: ecommerce-pnl. ' +
          'Plus financial-model (legacy verbose 3-statement). CUSTOMISE by passing your own pattern sheets in the SAME call — a sheet with the same name (e.g. "Assumptions" ' +
          'with the user\'s real numbers/labels) REPLACES the scaffold\'s; extra sheets are added. Rows labelled "…(replace with your data)" are example series to overwrite. ' +
          'Set months to size the projection. The built-in CHECK rows must compute to 0 — the tool rejects a model that does not tie.',
      },
      months: { type: 'number', description: 'Projection length for a template (periods/columns). Defaults per template.' },
      append: { type: 'boolean', description: 'When true, ADD these sheets to the existing file (same output name) instead of overwriting — for building a large multi-sheet model a few (2-3) sheets per call. A sheet whose name already exists is replaced. Default false (fresh file).' },
      accent: { type: 'string', description: 'Header accent colour as hex (e.g. "#4f46e5"). Use the brand accent if known.' },
      currency: { type: 'string', description: 'The workbook\'s currency for ALL currency-typed columns — an ISO code ("AED", "USD", "BDT") or a symbol ("$", "€", "£"). ALWAYS set this from the brief\'s market (an AED brief must NOT show $ — the default is $ only when nothing is specified).' },
      sheets: {
        type: 'array',
        description: 'One or more worksheets.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Sheet tab name.' },
            columns: {
              type: 'array',
              description: 'Column definitions in order.',
              items: {
                type: 'object',
                properties: {
                  header: { type: 'string', description: 'Column header label.' },
                  key: { type: 'string', description: 'Key matching row-object fields (optional if rows are arrays).' },
                  width: { type: 'number', description: 'Column width (chars). Auto-sized if omitted.' },
                  type: { type: 'string', enum: ['text', 'number', 'currency', 'percent', 'date'] },
                  numFmt: { type: 'string', description: 'Explicit Excel number format for this column (beats `type`), e.g. "#,##0", "0.0%", "\\"AED\\" #,##0". Use for special cases like 0-decimal currency or negatives-in-parens: "#,##0;(#,##0)".' },
                },
                required: ['header'],
              },
            },
            rows: {
              type: 'array',
              description: 'Rows. PREFER the ARRAY form: each row is an array of cell values in column order (e.g. ["Rent", 2775, "=B2*12"]). Objects keyed by column key also work. A cell may be a literal value, a formula string like "=B2*C2", or {"f":"B2*C2","v":1234} (formula + cached result). USE FORMULAS for models (cash-flow, budget, scenario) so changing one assumption flows through — never hard-code derived numbers.',
              items: { type: 'array', description: 'One row = an array of cell values in column order.', items: {} },
            },
          },
          required: ['name', 'columns', 'rows'],
        },
      },
    },
  },
  modes: ['chat', 'code', 'report'],
  // Live failure mode (2026-07-06): a model dictated one giant verbose `sheets` payload,
  // mangled the JSON three times, then abandoned the tool for openpyxl — losing the theme
  // and the audits. The recovery is ALWAYS a smaller call, never a retry of the same blob.
  badJsonHint:
    'your payload was probably too large to serialize. Do NOT retry the same giant sheets array. ' +
    'Call again with template:"<id>" — a matching ready model (e.g. kpi-dashboard, budget-vs-actual, cash-runway, ' +
    'loan-amortization, cohort-retention, ab-test, revenue-forecast…) is the WHOLE build in one small call — ' +
    'or write COMPACT pattern sheets ({label, first/then/each} rows referenced BY LABEL), never verbose cell arrays. ' +
    'Do not fall back to a hand-written script: the tool applies the premium styling and the accuracy audits.',
  summarize: (a) => `spreadsheet ${String(a.output ?? 'data.xlsx')}`,
  async run(args, ctx) {
    const outName = String(args.output || 'data.xlsx').replace(/[^a-zA-Z0-9._-]/g, '-');
    const finalName = outName.toLowerCase().endsWith('.xlsx') ? outName : `${outName}.xlsx`;
    let sheets = Array.isArray(args.sheets) ? args.sheets : [];
    // template:"financial-model" → seed the correct, fully-wired 3-statement skeleton (the model
    // then customises via a follow-up append/overwrite call). Only seeds when no sheets are given.
    if (!sheets.length && String(args.template || '') === 'financial-model') sheets = financialModelScaffold();
    // Pattern-scaffold templates: a correct, check-row-carrying model skeleton the caller
    // customises by passing same-name sheets (they REPLACE the scaffold's before expansion).
    if (args.template && String(args.template) !== 'financial-model') {
      const merged = applyScaffold(String(args.template), Number(args.months) || undefined, sheets);
      if (!merged)
        return `Error: unknown template "${args.template}". Available: financial-model, ${EXCEL_SCAFFOLDS.map((s) => s.id).join(', ')}.`;
      sheets = merged;
    }
    if (!sheets.length)
      return (
        'Error: provide at least one sheet, or set a template — for any standard model, template:"<id>" (+ months/currency/accent) ' +
        `is the WHOLE call. Ready self-checking models: financial-model, ${EXCEL_SCAFFOLDS.map((s) => s.id).join(', ')}. ` +
        'For a custom model use compact pattern sheets ({label, first/then/each} rows referenced BY LABEL) — never a giant verbose cells array.'
      );
    // PATTERN sheets (the fast, structurally-safe dialect for time-series models) expand
    // HERE, so every audit below — refs, cached-vs-computed, plausibility — runs on the
    // exact cells that reach the workbook. Bad label refs fail with the available labels.
    try {
      sheets = expandPatternSheets(sheets);
    } catch (e: any) {
      if (e instanceof ToolError) return `Error: ${e.message}`;
      throw e;
    }
    // ACCURACY audit part 1 — cached-vs-computed MISMATCHES, captured from the RAW payload
    // BEFORE any recalc pass overwrites the model's cached values: where {f,v} disagree
    // materially, the model's arithmetic and its formula tell two different stories — which
    // usually marks a WRONG formula (wrong row/sign/term). Surfaced in the result below.
    const payloadAudit = auditFormulaRefs(sheets);
    // Recompute formula cells' cached values so the in-app PREVIEW shows correct numbers
    // (models often write a wrong/0 cached value; the formula itself is preserved + Excel
    // recalculates the download regardless, so this is a strictly-improving preview fix).
    recalcSheetData(sheets);
    // CHECK ROWS (pattern dialect): tie-outs shipped INSIDE the model — Anthropic-skill
    // practice ("Assets − L − E = 0", cash tie-outs) — must compute to ~0 every period.
    // A non-zero check is a hard defect naming the first offending period.
    const checkDefects: string[] = [];
    for (const s of sheets) {
      for (const ri of ((s as any).__checkRows ?? []) as number[]) {
        const row: any[] = Array.isArray(s.rows?.[ri]) ? s.rows[ri] : [];
        for (let ci = 1; ci < row.length; ci++) {
          const v = row[ci]?.v;
          if (Number.isFinite(v) && Math.abs(v) > 0.01) {
            if (checkDefects.length < 6)
              checkDefects.push(
                `CHECK row "${row[0]}" on "${s.name}" is non-zero in period ${ci} (${Number(v).toFixed(2)}) — the model does not tie; fix the formulas it references (a check row must equal 0 everywhere).`,
              );
            break;
          }
        }
      }
    }

    let absOut: string;
    try {
      absOut = resolveInWorkspace(ctx.repoDir, finalName);
    } catch (e: any) {
      return `Error: ${e?.message ?? e}`;
    }

    let ExcelJS: any;
    try {
      const mod: any = await import('exceljs');
      ExcelJS = mod.default ?? mod;
    } catch {
      return 'Error: exceljs is not available in this environment.';
    }

    const accentArgb = toArgb(args.accent, 'FF4F46E5');
    const append = args.append === true;
    const currencyFmt = args.currency ? currencyNumFmt(String(args.currency)) : undefined;
    const expected: { name: string; rows: number }[] = [];
    let totalSheets = 0;
    try {
      const wb = new ExcelJS.Workbook();
      wb.creator = 'ArksAI';
      // Force Excel/Sheets to fully recompute every formula on open, so the user always
      // sees correct numbers even if our cached values are imperfect for an exotic formula.
      wb.calcProperties.fullCalcOnLoad = true;
      // Incremental build: load the existing file so we ADD to it (a large model assembled
      // one sheet per call). Cross-sheet formulas to earlier sheets then resolve in recalc.
      if (append && fs.existsSync(absOut)) {
        try {
          await wb.xlsx.readFile(absOut);
        } catch {
          /* unreadable prior file → start fresh rather than fail the whole build */
        }
      }
      for (const s of sheets) {
        const name = String(s.name || 'Sheet').slice(0, 31);
        // Re-sending a sheet name replaces it (so a corrected stage overwrites cleanly).
        const prior = wb.getWorksheet(name);
        if (prior) wb.removeWorksheet(prior.id);
        expected.push(buildSheet(wb, s, accentArgb, currencyFmt));
      }
      // ACCURACY audit part 2 — REFERENCE defects, checked on the BUILT workbook so a staged
      // (append) build sees EVERY sheet in the file: dangling sheet names (with the intended
      // tab suggested on a near-miss), dot-notation refs, and single-cell refs beyond a
      // sheet's real extent (the banner-shift off-by-one). Runs BEFORE recalcWorkbook.
      const builtAudit = auditExcelWorkbook(wb);
      // Built-workbook refs replace the payload's (they see appended sheets too) — but the
      // pattern dialect's CHECK-row defects always ride along.
      payloadAudit.refDefects = [...builtAudit.refDefects, ...checkDefects];
      // AUTHORITATIVE pass: compute + cache every formula cell's result on the BUILT
      // workbook (real coordinates), so the in-app preview never shows blank formula
      // cells — even when the model's structure defeated the pre-write recalc.
      recalcWorkbook(wb);
      await wb.xlsx.writeFile(absOut);
      totalSheets = wb.worksheets.length;
    } catch (e: any) {
      return `Error: failed to build the spreadsheet — ${e?.message ?? e}`;
    }

    // Validate: re-open with SheetJS and confirm the sheets + row counts landed.
    let auditDefects: string[] = [];
    try {
      const XLSX: any = await import('xlsx');
      const buf = fs.readFileSync(absOut);
      const check = XLSX.read(buf, { type: 'buffer' });
      // FIRST-GO audit: run the exact deterministic checks the pre-completion self-audit and
      // the verify gate run (formula-driven model, empty statement sheets, banner rows,
      // error cells, impossible numbers) HERE, in the tool result — so the model fixes a
      // defect in the same turn instead of after a gate round-trip.
      try {
        const { deterministicDeliverableDefects } = await import('../deliverableCheck');
        auditDefects = deterministicDeliverableDefects({ wb: check }) || [];
      } catch {
        /* audit is best-effort — never block the write on it */
      }
      for (const e of expected) {
        const ws = check.Sheets[e.name];
        if (!ws) return `Error: validation failed — sheet "${e.name}" missing from the written file.`;
        const json = XLSX.utils.sheet_to_json(ws, { header: 1 });
        const dataRows = Math.max(0, json.length - 1); // minus header
        // sheet_to_json TRIMS trailing/blank rows, so a blank spacer row legitimately doesn't
        // round-trip (re-read count = sent − 1). A strict exact-match produced a perpetual
        // off-by-one the model couldn't satisfy → it abandoned this tool for a buggy hand-written
        // openpyxl script and burned the run. So only fail on a GROSS shortfall = a real broken
        // write (nothing wrote, or under half did); a small shortfall is just trimmed blanks.
        if (e.rows > 0 && dataRows === 0) {
          return `Error: the spreadsheet wrote 0 of ${e.rows} rows to sheet "${e.name}" — the rows didn't land. Re-send this sheet with its data rows.`;
        }
        if (e.rows >= 4 && dataRows < Math.ceil(e.rows * 0.5)) {
          return `Error: sheet "${e.name}" only wrote ${dataRows} of ${e.rows} rows — re-send it. (A blank/spacer row is fine and doesn't count; this is a real shortfall.)`;
        }
      }
    } catch (e: any) {
      return `Error: wrote the file but validation could not re-open it — ${e?.message ?? e}`;
    }

    // Merge the formula-accuracy findings (refs from the built workbook, mismatches from the
    // raw payload) into the same defect channel as the deterministic audit.
    auditDefects = [...auditDefects, ...formulaAuditLines(payloadAudit)];

    const sz = fs.existsSync(absOut) ? fs.statSync(absOut).size : 0;
    const total = expected.reduce((n, e) => n + e.rows, 0);
    const sheetNote = append
      ? `added ${expected.length} sheet(s) (${total} data row(s)), ${totalSheets} sheet(s) now in the workbook`
      : `${expected.length} sheet(s), ${total} data row(s)`;
    const more = append
      ? ' Call again with append:true to add the next sheet, or stop here if the model is complete.'
      : '';
    if (auditDefects.length) {
      // The file is written, but it would NOT pass the quality gate — say so now, with the
      // exact defects, so the fix happens in this turn (minimal targeted re-call).
      return (
        `Wrote ${finalName} (${sheetNote}), BUT the automatic audit found defect(s) the quality gate will reject — ` +
        `fix them NOW with a minimal targeted re-call (only the affected sheet(s)):\n- ${auditDefects.join('\n- ')}` +
        (append
          ? `\n(If your NEXT append:true call adds the sheet/formulas named above, just continue — this audit re-runs after every call and clears once the workbook is complete.)`
          : '')
      );
    }
    return `Generated ${finalName} (${Math.round(sz / 1024)} KB) — ${sheetNote}, styled, validated, and audit-clean (formulas, statements, numbers). Offered as a download; the canvas can preview it.${more}`;
  },
};
