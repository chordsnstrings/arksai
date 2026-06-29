import fs from 'node:fs';
import { resolveInWorkspace, ToolError, type ToolDef } from './common';
import { recalcWorkbook } from './sheetcalc';
import { deterministicDeliverableDefects, recalcXlsxViaSoffice } from '../deliverableCheck';

/**
 * The authoritative "are my numbers right?" step for any .xlsx — the keystone that lets the agent
 * escalate to openpyxl for a model generate_spreadsheet can't express, then VERIFY in ONE call
 * instead of hand-looping LibreOffice. It (1) recalculates every formula via LibreOffice (NPV/IRR/
 * VLOOKUP/dates/iterative-circular included), (2) writes the real computed values back as the cached
 * result so the preview + first open show the truth, and (3) reports every error cell plus the
 * deterministic sanity findings. Degrades to the built-in JS recalculator when LibreOffice is absent.
 */
export const recalcSpreadsheetTool: ToolDef = {
  name: 'recalc_spreadsheet',
  description:
    'Recalculate and VERIFY an .xlsx authoritatively with LibreOffice — the final correctness check for any ' +
    'spreadsheet/model before you finish, and the verify step for a model you built by hand (openpyxl). It ' +
    'recomputes EVERY formula (including ones the styled generate_spreadsheet preview can\'t — NPV, IRR, ' +
    'VLOOKUP, INDEX/MATCH, dates, iterative/circular like interest↔debt↔cash), writes the real values back ' +
    'into the file so the preview and first open show correct numbers, and reports any ERROR cells ' +
    '(#REF!/#VALUE!/#DIV0!/#NAME?) plus impossible-number warnings. Call it ONCE after building or editing a ' +
    'model — do NOT hand-loop `soffice` yourself. A clean report means the numbers are trustworthy and you\'re ' +
    'done; error cells or warnings tell you the exact cells to fix.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Workspace path to the .xlsx to recalculate and verify, e.g. "model.xlsx".' },
    },
    required: ['path'],
  },
  modes: ['code', 'report'],
  summarize: (a) => `recalc_spreadsheet ${String(a.path ?? '').slice(0, 50)}`,
  async run(args, ctx) {
    const p = String(args.path ?? '').trim();
    if (!p) return 'Error: a `path` is required.';
    if (!/\.xlsx$/i.test(p)) return 'Error: recalc_spreadsheet only handles .xlsx files.';
    let abs: string;
    try {
      abs = resolveInWorkspace(ctx.repoDir, p);
    } catch (e) {
      return `Error: ${e instanceof ToolError ? e.message : String(e)}`;
    }
    if (!fs.existsSync(abs)) return `Error: no file at "${p}".`;

    const XLSX: any = await import('xlsx');

    // ---- Authoritative path: LibreOffice recalc + value writeback ----
    const r = await recalcXlsxViaSoffice(abs);
    if (r) {
      let sanity: string[] = [];
      try {
        sanity = deterministicDeliverableDefects({ wb: XLSX.read(fs.readFileSync(abs), { type: 'buffer' }) });
      } catch {
        /* best-effort */
      }
      const lines = [`Recalculated "${p}" with LibreOffice — ${r.formulaCount} formula cell(s), ${r.wroteBack} cached value(s) refreshed.`];
      if (r.errorCells.length) {
        lines.push(
          `⚠ ${r.errorCells.length} ERROR cell(s) — these formulas are broken and MUST be fixed: ` +
            `${r.errorCells.slice(0, 15).join(', ')}${r.errorCells.length > 15 ? ', …' : ''}. ` +
            `An error cell is almost always a mis-reference (wrong cell/sheet/row) or a divide-by-zero — re-check each one's formula.`,
        );
      }
      if (sanity.length) {
        lines.push(`⚠ Sanity check flagged ${sanity.length} issue(s):`);
        for (const d of sanity.slice(0, 6)) lines.push(`- ${d}`);
      }
      if (!r.errorCells.length && !sanity.length) {
        lines.push('✓ No error cells, no impossible numbers — the values are verified and trustworthy. The model is done.');
      }
      return lines.join('\n');
    }

    // ---- Degrade path: LibreOffice unavailable → the built-in JS recalculator ----
    let sanity: string[] = [];
    let formulaCount = 0;
    try {
      const mod: any = await import('exceljs');
      const ExcelJS = mod.default ?? mod;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(abs);
      wb.calcProperties.fullCalcOnLoad = true;
      wb.eachSheet((ws: any) =>
        ws.eachRow({ includeEmpty: false }, (row: any) =>
          row.eachCell({ includeEmpty: false }, (cell: any) => {
            const v = cell.value;
            if (v && typeof v === 'object' && typeof v.formula === 'string') formulaCount++;
          }),
        ),
      );
      recalcWorkbook(wb); // covers SUM/IF/arithmetic/refs; leaves advanced formulas' supplied values
      await wb.xlsx.writeFile(abs);
      sanity = deterministicDeliverableDefects({ wb: XLSX.read(fs.readFileSync(abs), { type: 'buffer' }) });
    } catch (e: any) {
      return `Error: could not recalculate "${p}" — ${String(e?.message ?? e).slice(0, 160)}`;
    }
    const lines = [
      `Recalculated "${p}" with the built-in calculator (LibreOffice not available here) — ${formulaCount} formula cell(s). ` +
        `This covers SUM/IF/arithmetic/cross-sheet refs; advanced formulas (NPV/IRR/VLOOKUP/dates) keep the cached value you supplied, ` +
        `and error cells can't be detected without LibreOffice — so supply a correct cached "v" for those.`,
    ];
    if (sanity.length) {
      lines.push(`⚠ Sanity check flagged ${sanity.length} issue(s):`);
      for (const d of sanity.slice(0, 6)) lines.push(`- ${d}`);
    } else {
      lines.push('✓ No impossible numbers detected.');
    }
    return lines.join('\n');
  },
};
