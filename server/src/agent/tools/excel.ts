import fs from 'node:fs';
import { resolveInWorkspace, type ToolDef } from './common';
import { recalcSheetData, recalcWorkbook } from './sheetcalc';
import { STRINGY_REF_RE } from '../deliverableCheck';

type ColType = 'text' | 'number' | 'currency' | 'percent' | 'date';
interface ColSpec {
  header: string;
  key?: string;
  width?: number;
  type?: ColType;
}

const NUM_FMT: Record<ColType, string | undefined> = {
  text: undefined,
  number: '#,##0.###',
  currency: '$#,##0.00',
  percent: '0.0%',
  date: 'yyyy-mm-dd',
};

/** Normalise a hex like "#4f46e5" / "4f46e5" to an ARGB string exceljs wants. */
function toArgb(hex: string | undefined, fallback: string): string {
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
function buildSheet(wb: any, s: any, accentArgb: string): { name: string; rows: number } {
  const name = String(s.name || 'Sheet').slice(0, 31);
  const cols: ColSpec[] = Array.isArray(s.columns) ? s.columns : [];
  const rows: any[] = Array.isArray(s.rows) ? s.rows : [];
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });

  ws.columns = cols.map((c, i) => ({
    header: c.header,
    key: c.key || c.header || `c${i}`,
    width: c.width && c.width > 0 ? c.width : Math.min(40, Math.max(12, String(c.header || '').length + 4)),
  }));

  // Header styling — branded, bold, readable.
  const head = ws.getRow(1);
  head.height = 22;
  head.eachCell((cell: any) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: accentArgb } };
    cell.alignment = { vertical: 'middle', horizontal: 'left' };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFFFFFFF' } } };
  });

  // Data rows (cells may be literal values OR formulas — see toCell/toRow).
  for (const r of rows) ws.addRow(toRow(r));

  // Number/date formats + right-align numerics.
  cols.forEach((c, i) => {
    const fmt = c.type ? NUM_FMT[c.type] : undefined;
    const col = ws.getColumn(i + 1);
    if (fmt) col.numFmt = fmt;
    if (c.type && c.type !== 'text' && c.type !== 'date') col.alignment = { horizontal: 'right' };
  });

  // Zebra banding.
  ws.eachRow((row: any, n: number) => {
    if (n > 1 && n % 2 === 1) {
      row.eachCell((cell: any) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7F7F5' } };
      });
    }
  });

  // Total/roll-up rows: bold + a hairline top rule so a model reads like a real statement.
  ws.eachRow((row: any, n: number) => {
    if (n === 1) return;
    if (!TOTAL_ROW_RE.test(firstCellLabel(row.getCell(1).value))) return;
    row.eachCell((cell: any) => {
      cell.font = { ...(cell.font || {}), bold: true };
      cell.border = { ...(cell.border || {}), top: { style: 'thin', color: { argb: 'FFB8B8B0' } } };
    });
  });

  // Auto width refinement.
  cols.forEach((_c, i) => {
    const col = ws.getColumn(i + 1);
    if (_c.width && _c.width > 0) return;
    let max = String(cols[i]?.header || '').length;
    col.eachCell({ includeEmpty: false }, (cell: any) => {
      const len = String(cell.value ?? '').length;
      if (len > max) max = len;
    });
    col.width = Math.min(48, Math.max(12, max + 3));
  });

  if (cols.length) {
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
    'DESIGN STANDARDS (judged like a finance pro): make it FORMULA-DRIVEN — never hard-code a derived number ' +
    '(totals via SUM, ratios/growth as formulas) so changing an assumption flows through; lead with a Summary/KPI ' +
    'sheet; give every column an explicit type (currency/percent/date) so numbers align and format consistently; ' +
    'keep the accent restrained; no orphan/empty columns. The output is auto re-opened, formula-error-checked, and ' +
    'design-reviewed — a broken or sloppy sheet is sent back to you to fix. ' +
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
      template: { type: 'string', enum: ['financial-model'], description: 'Seed a correct, fully-wired skeleton instead of building from scratch. "financial-model" → a 3-statement model (Assumptions → Income → CashFlow) with live cross-sheet formulas and a POPULATED cash-flow statement (never an empty tab). Call this FIRST for any multi-sheet/3-statement model, then customise: re-call generate_spreadsheet with append:true (or overwrite) to rename line items, tune the Assumptions, or add detail. Omit `sheets` when using a template.' },
      append: { type: 'boolean', description: 'When true, ADD these sheets to the existing file (same output name) instead of overwriting — for building a large multi-sheet model a few (2-3) sheets per call. A sheet whose name already exists is replaced. Default false (fresh file).' },
      accent: { type: 'string', description: 'Header accent colour as hex (e.g. "#4f46e5"). Use the brand accent if known.' },
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
  modes: ['code', 'report'],
  summarize: (a) => `spreadsheet ${String(a.output ?? 'data.xlsx')}`,
  async run(args, ctx) {
    const outName = String(args.output || 'data.xlsx').replace(/[^a-zA-Z0-9._-]/g, '-');
    const finalName = outName.toLowerCase().endsWith('.xlsx') ? outName : `${outName}.xlsx`;
    let sheets = Array.isArray(args.sheets) ? args.sheets : [];
    // template:"financial-model" → seed the correct, fully-wired 3-statement skeleton (the model
    // then customises via a follow-up append/overwrite call). Only seeds when no sheets are given.
    if (!sheets.length && String(args.template || '') === 'financial-model') sheets = financialModelScaffold();
    if (!sheets.length) return 'Error: provide at least one sheet (name, columns, rows), or set template:"financial-model".';
    // Recompute formula cells' cached values so the in-app PREVIEW shows correct numbers
    // (models often write a wrong/0 cached value; the formula itself is preserved + Excel
    // recalculates the download regardless, so this is a strictly-improving preview fix).
    recalcSheetData(sheets);

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
        expected.push(buildSheet(wb, s, accentArgb));
      }
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
    try {
      const XLSX: any = await import('xlsx');
      const buf = fs.readFileSync(absOut);
      const check = XLSX.read(buf, { type: 'buffer' });
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

    const sz = fs.existsSync(absOut) ? fs.statSync(absOut).size : 0;
    const total = expected.reduce((n, e) => n + e.rows, 0);
    const sheetNote = append
      ? `added ${expected.length} sheet(s) (${total} data row(s)), ${totalSheets} sheet(s) now in the workbook`
      : `${expected.length} sheet(s), ${total} data row(s)`;
    const more = append
      ? ' Call again with append:true to add the next sheet, or stop here if the model is complete.'
      : '';
    return `Generated ${finalName} (${Math.round(sz / 1024)} KB) — ${sheetNote}, styled and validated. Offered as a download; the canvas can preview it.${more}`;
  },
};
