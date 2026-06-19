import fs from 'node:fs';
import * as XLSX from 'xlsx';
import type { ToolDef } from './common';
import { resolveInWorkspace, ToolError } from './common';

// Per-call output budgets — keep a tool response bounded (token cost) while letting
// the agent page through any sheet via the `rows` range. The manifest ALWAYS lists
// every sheet (the whole point — a multi-sheet workbook can never silently lose a sheet).
const MANIFEST_SAMPLE_ROWS = 8; // sample rows shown per sheet in the manifest
const MAX_COLS = 40;
const MAX_OUTPUT = 60_000; // chars per call

function dims(ws: XLSX.WorkSheet): { rows: number; cols: number } {
  const ref = ws['!ref'];
  if (!ref) return { rows: 0, cols: 0 };
  const r = XLSX.utils.decode_range(ref);
  return { rows: r.e.r - r.s.r + 1, cols: r.e.c - r.s.c + 1 };
}

function aoa(ws: XLSX.WorkSheet): string[][] {
  // header:1 → array-of-arrays; blankrows:false drops fully-empty rows; defval keeps shape.
  const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, blankrows: false, defval: '' });
  return rows.map((r) => (Array.isArray(r) ? r.map((c) => (c == null ? '' : String(c))) : []));
}

function fmtRow(r: string[]): string {
  return r.slice(0, MAX_COLS).map((c) => c.replace(/\s+/g, ' ').trim()).join(' | ');
}

/** Parse a `rows` arg: "10-120" → [10,120] (1-based, inclusive) or "200" → [1,200]. */
function parseRange(spec: string | undefined, total: number): [number, number] {
  if (!spec) return [1, Math.min(total, 200)];
  const m = String(spec).trim().match(/^(\d+)\s*[-:]\s*(\d+)$/);
  if (m) return [Math.max(1, +m[1]), Math.min(total, +m[2])];
  const n = parseInt(String(spec), 10);
  if (!isNaN(n)) return [1, Math.min(total, n)];
  return [1, Math.min(total, 200)];
}

export const readSpreadsheetTool: ToolDef = {
  name: 'read_spreadsheet',
  description:
    'Read an uploaded spreadsheet (.xlsx/.xls/.csv) ACCURATELY and completely — use this instead of ' +
    'read_file for any spreadsheet (the plain-text extract is NOT generated for spreadsheets because it ' +
    'silently drops sheets). Call with just `path` to get a MANIFEST of EVERY sheet (name, dimensions, ' +
    'header row, and a few sample rows) — this is the right first step for "what is in this file?". Then ' +
    'call again with `sheet` (name or 1-based number) and an optional `rows` range (e.g. "1-200" or "500") ' +
    'to read exact values from one sheet, paging as needed. For heavy analysis (totals, P&L, pivots, ' +
    'charts) read the raw file with Python (pandas/openpyxl) in code mode — this tool is for reading, not ' +
    'computing.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Workspace path to the spreadsheet, e.g. "uploads/data.xlsx".' },
      sheet: {
        type: 'string',
        description: 'Optional: a sheet NAME or 1-based index. Omit for the full manifest of all sheets.',
      },
      rows: {
        type: 'string',
        description: 'Optional (with `sheet`): a 1-based row range "10-120", or a count "200". Default first 200.',
      },
    },
    required: ['path'],
  },
  modes: ['chat', 'plan', 'code', 'report'],
  summarize: (a) => `read_spreadsheet ${String(a.path ?? '').slice(0, 50)}${a.sheet ? ` · ${a.sheet}` : ''}`,
  async run(args, ctx) {
    const p = String(args.path ?? '').trim();
    if (!p) return 'Error: a `path` is required.';
    let abs: string;
    try {
      abs = resolveInWorkspace(ctx.repoDir, p);
    } catch (e) {
      return `Error: ${e instanceof ToolError ? e.message : String(e)}`;
    }
    if (!fs.existsSync(abs)) return `Error: no file at "${p}".`;

    let wb: XLSX.WorkBook;
    try {
      wb = XLSX.read(fs.readFileSync(abs), { type: 'buffer' });
    } catch (e: any) {
      return `Error: could not open the spreadsheet — ${String(e?.message ?? e).slice(0, 160)}`;
    }
    const names = wb.SheetNames;
    if (!names.length) return `"${p}" has no sheets.`;

    // ---- One specific sheet ----
    if (args.sheet != null && String(args.sheet).trim() !== '') {
      const sel = String(args.sheet).trim();
      const idx = /^\d+$/.test(sel) ? parseInt(sel, 10) - 1 : names.indexOf(sel);
      const name = names[idx];
      if (!name) return `Error: no sheet "${sel}". Sheets: ${names.map((n, i) => `${i + 1}. ${n}`).join(', ')}.`;
      const rows = aoa(wb.Sheets[name]);
      const total = rows.length;
      const [from, to] = parseRange(args.rows, total);
      const lines: string[] = [`Sheet ${idx + 1}/${names.length} "${name}" — ${total} rows`];
      lines.push(`Showing rows ${from}–${Math.min(to, total)} of ${total}:`);
      let out = lines.join('\n') + '\n';
      let shown = 0;
      for (let i = from - 1; i < to && i < total; i++) {
        const line = `${i + 1}: ${fmtRow(rows[i])}\n`;
        if (out.length + line.length > MAX_OUTPUT) {
          out += `… stopped at row ${i} (output cap) — request a narrower \`rows\` range for the rest.\n`;
          break;
        }
        out += line;
        shown++;
      }
      if (from + shown - 1 < total && out.length <= MAX_OUTPUT)
        out += `… ${total - (from + shown - 1)} more rows below — call again with rows:"${to + 1}-${Math.min(to + 200, total)}".\n`;
      return out.trimEnd();
    }

    // ---- Manifest of every sheet ----
    const head: string[] = [`Workbook "${p}" — ${names.length} sheet${names.length === 1 ? '' : 's'}:`];
    let out = '';
    for (let s = 0; s < names.length; s++) {
      const name = names[s];
      const ws = wb.Sheets[name];
      const d = dims(ws);
      const rows = aoa(ws);
      let block = `\n=== Sheet ${s + 1}/${names.length}: "${name}" — ${d.rows} rows × ${d.cols} cols ===\n`;
      const sample = rows.slice(0, MANIFEST_SAMPLE_ROWS);
      for (let i = 0; i < sample.length; i++) block += `${i + 1}: ${fmtRow(sample[i])}\n`;
      if (rows.length > MANIFEST_SAMPLE_ROWS)
        block += `… ${rows.length - MANIFEST_SAMPLE_ROWS} more rows — call read_spreadsheet with sheet:"${name}" (rows:"1-200") to read them.\n`;
      if (out.length + block.length > MAX_OUTPUT) {
        out += `\n[Manifest output cap reached after ${s} of ${names.length} sheets — call read_spreadsheet with sheet:"<name>" for any remaining sheet: ${names.slice(s).map((n) => `"${n}"`).join(', ')}.]\n`;
        break;
      }
      out += block;
    }
    return (
      head.join('\n') +
      out +
      `\n[This is a structured overview. For exact values read a sheet with sheet:"<name>"; for totals/P&L/pivots/charts crunch the raw file "${p}" with Python (pandas/openpyxl) in code mode.]`
    );
  },
};
