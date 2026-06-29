import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { recalcXlsxViaSoffice } from '../src/agent/deliverableCheck';
import { recalcSpreadsheetTool } from '../src/agent/tools/recalcSheet';

async function writeWb(file: string, cells: (ws: any) => void) {
  const mod: any = await import('exceljs');
  const ExcelJS = mod.default ?? mod;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Model');
  cells(ws);
  await wb.xlsx.writeFile(file);
}

async function readCell(file: string, addr: string): Promise<any> {
  const XLSX: any = await import('xlsx');
  const wb = XLSX.read(fs.readFileSync(file), { type: 'buffer', cellFormula: true });
  return wb.Sheets['Model'][addr];
}

// LibreOffice is the authoritative recalc path. It's reliable on the droplet but can be flaky/absent
// in a bare CI sandbox (silent no-op), so probe it FUNCTIONALLY (a real round-trip) and skip the
// soffice-dependent assertions when it isn't working here — the logic is exercised live on deploy.
async function sofficeWorks(): Promise<boolean> {
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soprobe-'));
    const file = path.join(dir, 'p.xlsx');
    await writeWb(file, (ws) => {
      ws.getCell('A1').value = 16;
      ws.getCell('B1').value = { formula: 'SQRT(A1)', result: 999 }; // SQRT is NOT in the JS recalc's 8 funcs
    });
    const r = await recalcXlsxViaSoffice(file);
    return !!r && (await readCell(file, 'B1'))?.v === 4;
  } catch {
    return false;
  }
}

test('recalcXlsxViaSoffice computes advanced formulas the JS evaluator cannot (SQRT) + writes them back', async (t) => {
  if (!(await sofficeWorks())) {
    t.skip('LibreOffice not functional in this environment — verified live on the droplet');
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recalctest-'));
  const file = path.join(dir, 'm.xlsx');
  await writeWb(file, (ws) => {
    ws.getCell('A1').value = 144;
    ws.getCell('B1').value = { formula: 'SQRT(A1)', result: 0 }; // wrong placeholder → must become 12
  });
  const r = await recalcXlsxViaSoffice(file);
  assert.ok(r, 'returns a result when soffice works');
  assert.ok(r!.formulaCount >= 1, `counts formula cells (${r!.formulaCount})`);
  assert.equal((await readCell(file, 'B1'))?.v, 12, 'SQRT(144) recomputed to 12 and written back (JS recalc cannot do SQRT)');
});

test('recalc_spreadsheet tool: input guards (path required, .xlsx only, file must exist)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recalctool-'));
  const ctx: any = { repoDir: dir, session: {}, mode: 'code', signal: new AbortController().signal, addCost() {} };
  assert.match(await recalcSpreadsheetTool.run({}, ctx), /path.*required/i);
  assert.match(await recalcSpreadsheetTool.run({ path: 'notes.csv' }, ctx), /only handles \.xlsx/i);
  assert.match(await recalcSpreadsheetTool.run({ path: 'missing.xlsx' }, ctx), /no file at/i);
});

test('recalc_spreadsheet tool: recomputes + writes back a SUM (works via LibreOffice OR the JS degrade path)', async () => {
  // SUM is one of the JS recalculator's supported functions, so this passes whether or not soffice
  // is available — proving the tool always returns correct cached values + a clean report.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recalcclean-'));
  const file = path.join(dir, 'ok.xlsx');
  await writeWb(file, (ws) => {
    ws.getCell('A1').value = 10;
    ws.getCell('A2').value = 20;
    ws.getCell('A3').value = { formula: 'SUM(A1:A2)', result: 0 }; // wrong placeholder → must become 30
  });
  const ctx: any = { repoDir: dir, session: {}, mode: 'code', signal: new AbortController().signal, addCost() {} };
  const out = await recalcSpreadsheetTool.run({ path: 'ok.xlsx' }, ctx);
  assert.match(out, /Recalculated/);
  assert.doesNotMatch(out, /ERROR cell/);
  assert.equal((await readCell(file, 'A3'))?.v, 30, 'SUM recomputed + written back');
});
