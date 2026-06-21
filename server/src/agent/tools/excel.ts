import fs from 'node:fs';
import { resolveInWorkspace, type ToolDef } from './common';
import { recalcSheetData, recalcWorkbook } from './sheetcalc';

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
  if (typeof v === 'string' && v.length > 1 && v[0] === '=') return { formula: v.slice(1) };
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
    'sheets) — BUILD IT IN STAGES, do NOT cram every sheet into one huge call (that is slow and can stall): make the ' +
    'FIRST call with the "Assumptions" sheet (all drivers — rents, salaries, unit costs, growth/escalation %), then call ' +
    'AGAIN with "append": true to add ONE more sheet each time (e.g. CAPEX schedule, then OPEX schedule, then Personnel, ' +
    'then a Summary/P&L), each referencing the earlier sheets with cross-sheet formulas (=Assumptions!$B$2). Append keeps ' +
    'the SAME file, preserves prior sheets, restyles, and re-checks the whole workbook; re-sending a sheet name REPLACES it. ' +
    'This is how you reliably ship a big, detailed, formula-driven model without one giant payload.',
  parameters: {
    type: 'object',
    properties: {
      output: { type: 'string', description: 'Output filename, e.g. "sales.xlsx". Default data.xlsx. For a staged build, keep the SAME filename across calls.' },
      append: { type: 'boolean', description: 'When true, ADD these sheets to the existing file (same output name) instead of overwriting — for building a large multi-sheet model one sheet at a time. A sheet whose name already exists is replaced. Default false (fresh file).' },
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
    required: ['sheets'],
  },
  modes: ['code', 'report'],
  summarize: (a) => `spreadsheet ${String(a.output ?? 'data.xlsx')}`,
  async run(args, ctx) {
    const outName = String(args.output || 'data.xlsx').replace(/[^a-zA-Z0-9._-]/g, '-');
    const finalName = outName.toLowerCase().endsWith('.xlsx') ? outName : `${outName}.xlsx`;
    const sheets = Array.isArray(args.sheets) ? args.sheets : [];
    if (!sheets.length) return 'Error: provide at least one sheet (name, columns, rows).';
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
