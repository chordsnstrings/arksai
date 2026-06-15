import fs from 'node:fs';
import { resolveInWorkspace, type ToolDef } from './common';

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
export function toCell(v: any): any {
  if (typeof v === 'string' && v.length > 1 && v[0] === '=') return { formula: v.slice(1) };
  if (v && typeof v === 'object' && typeof v.f === 'string') {
    return v.v !== undefined ? { formula: v.f, result: v.v } : { formula: v.f };
  }
  return v;
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
    'over hand-writing a script when the deliverable is a spreadsheet. Cells may be values OR ' +
    'formulas ("=B2*C2" or {"f":"B2*C2","v":<result>}) — use formulas to build genuinely formula-driven models.',
  parameters: {
    type: 'object',
    properties: {
      output: { type: 'string', description: 'Output filename, e.g. "sales.xlsx". Default data.xlsx.' },
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
              description: 'Rows as arrays (cell values in column order) OR objects keyed by column key. A cell may be a literal value, a formula string like "=B2*C2", or {"f":"B2*C2","v":1234} (formula + cached result). USE FORMULAS for models (cash-flow, budget, scenario) so changing one assumption flows through — never hard-code derived numbers.',
              items: {},
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
    const expected: { name: string; rows: number }[] = [];
    try {
      const wb = new ExcelJS.Workbook();
      wb.creator = 'ArksAI';
      for (const s of sheets) {
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

        // Zebra banding + auto width refinement.
        ws.eachRow((row: any, n: number) => {
          if (n > 1 && n % 2 === 1) {
            row.eachCell((cell: any) => {
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7F7F5' } };
            });
          }
        });
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
        expected.push({ name, rows: rows.length });
      }
      await wb.xlsx.writeFile(absOut);
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
        if (dataRows < e.rows) {
          return `Error: validation failed — sheet "${e.name}" has ${dataRows} data rows, expected ${e.rows}.`;
        }
      }
    } catch (e: any) {
      return `Error: wrote the file but validation could not re-open it — ${e?.message ?? e}`;
    }

    const sz = fs.existsSync(absOut) ? fs.statSync(absOut).size : 0;
    const total = expected.reduce((n, e) => n + e.rows, 0);
    return `Generated ${finalName} (${Math.round(sz / 1024)} KB) — ${expected.length} sheet(s), ${total} data row(s), styled and validated. Offered as a download; the canvas can preview it.`;
  },
};
