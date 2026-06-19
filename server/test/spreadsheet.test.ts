import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as XLSX from 'xlsx';
import type { ToolCtx } from '../src/agent/tools/common';
import { readSpreadsheetTool } from '../src/agent/tools/spreadsheet';

const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-sheet-'));
const ctx = (): ToolCtx => ({
  session: { id: 's1' } as any,
  repoDir: ws,
  mode: 'chat',
  signal: new AbortController().signal,
  addCost: () => {},
});

// A workbook whose FIRST sheet is enormous and is followed by many more — the exact
// shape that broke the old flat-text extractor (the first sheet ate the char cap and
// 20+ later sheets were silently dropped). read_spreadsheet must surface ALL of them.
function makeBigWorkbook(file: string) {
  const wb = XLSX.utils.book_new();
  // sheet 1: 3,000 rows × 9 cols (huge)
  const big: any[][] = [['Date', 'Desc', 'Month', 'Year', 'Cat', 'Credit', 'Debit', 'Balance', 'Notes']];
  for (let i = 1; i <= 3000; i++) big.push([`2024-01-${i}`, `txn ${i} narration text`, 'Jan', '2024', '', i * 10, i * 3, i * 7, `note ${i}`]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(big), 'Ecosine Investments');
  // 24 more sheets, small
  for (let s = 2; s <= 25; s++) {
    const aoa = [['Col A', 'Col B'], [`s${s}-a`, `s${s}-b`], [`s${s}-c`, `s${s}-d`]];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), `Sheet ${s}`);
  }
  XLSX.writeFile(wb, path.join(ws, file));
}

test('read_spreadsheet manifest lists EVERY sheet (never silently drops one)', async () => {
  makeBigWorkbook('eco.xlsx');
  const out = await readSpreadsheetTool.run({ path: 'eco.xlsx' }, ctx());
  assert.doesNotMatch(out, /^Error/);
  assert.match(out, /25 sheets/);
  assert.match(out, /Ecosine Investments/);
  assert.match(out, /3001 rows × 9 cols/); // dims for the big sheet (header + 3000 data rows)
  // all 24 trailing sheets present by name — the regression we fixed
  for (let s = 2; s <= 25; s++) assert.match(out, new RegExp(`Sheet ${s}\\b`), `Sheet ${s} missing from manifest`);
  // it points to the raw-file/Python route for heavy work
  assert.match(out, /read_spreadsheet with sheet:|Python/);
});

test('read_spreadsheet reads exact values from one sheet, with a row range', async () => {
  makeBigWorkbook('eco2.xlsx');
  const out = await readSpreadsheetTool.run({ path: 'eco2.xlsx', sheet: 'Ecosine Investments', rows: '2-4' }, ctx());
  assert.match(out, /Showing rows 2–4 of 3001/); // header row + 3000 data rows
  assert.match(out, /txn 1 narration text/); // row 2 = first data row
  assert.match(out, /more rows below/); // paging hint to continue
});

test('read_spreadsheet accepts a 1-based sheet index', async () => {
  makeBigWorkbook('eco3.xlsx');
  const out = await readSpreadsheetTool.run({ path: 'eco3.xlsx', sheet: '3', rows: '1-3' }, ctx());
  assert.match(out, /Sheet 3\/25 "Sheet 3"/);
  assert.match(out, /s3-a/);
});

test('read_spreadsheet errors helpfully on a missing file or bad sheet', async () => {
  assert.match(await readSpreadsheetTool.run({ path: 'nope.xlsx' }, ctx()), /no file/i);
  makeBigWorkbook('eco4.xlsx');
  const bad = await readSpreadsheetTool.run({ path: 'eco4.xlsx', sheet: 'Ghost' }, ctx());
  assert.match(bad, /no sheet "Ghost"/);
  assert.match(bad, /Sheets:/); // lists the real ones
});

test('read_spreadsheet is available in every mode (incl. chat)', () => {
  for (const m of ['chat', 'plan', 'code', 'report'] as const) assert.ok(readSpreadsheetTool.modes.includes(m));
});
