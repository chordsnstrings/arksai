import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ToolCtx } from '../src/agent/tools/common';
import { generateSpreadsheetTool } from '../src/agent/tools/excel';
import { generateDocTool } from '../src/agent/tools/docx';
import { generateComplianceFileTool } from '../src/agent/tools/compliance';
import { buildVlSpec } from '../src/agent/tools/chart';

/**
 * Systematic edge-case / malformed-input robustness for the deliverable generators.
 * Every user input must produce a CORRECT output OR a clean error — never a crash, never a
 * silent empty/garbage deliverable. These run the real generators (deterministic; no model)
 * against empty / null / special-char / boundary / huge / circular inputs.
 */
const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-edge-'));
const ctx = (): ToolCtx => ({ session: { id: 's-edge' } as any, repoDir: ws, mode: 'code', signal: new AbortController().signal, addCost: () => {} });
const run = (tool: any, args: any) => tool.run(args, ctx());

// ---------- generate_spreadsheet ----------
test('xlsx: empty sheets → clean error, not a crash', async () => {
  const r = await run(generateSpreadsheetTool, { output: 'e.xlsx', sheets: [] });
  assert.match(r, /^Error/);
});

test('xlsx: a sheet with columns but ZERO rows produces a valid file', async () => {
  const r = await run(generateSpreadsheetTool, { output: 'norows.xlsx', sheets: [{ name: 'Empty', columns: [{ header: 'A' }, { header: 'B' }], rows: [] }] });
  assert.doesNotMatch(r, /^Error/);
  assert.ok(fs.existsSync(path.join(ws, 'norows.xlsx')));
});

test('xlsx: null/undefined/emoji/very-long/huge/NaN cells do not crash', async () => {
  const big = 'x'.repeat(40000);
  const r = await run(generateSpreadsheetTool, {
    output: 'weird.xlsx',
    sheets: [{
      name: 'Wéìrd <&> name that is way too long to be a valid sheet name 12345',
      columns: [{ header: 'Tëxt 🚀' }, { header: 'Num', type: 'number' }],
      rows: [[null, NaN], [undefined, Infinity], ['😀<script>', 1e308], [big, -0], ['', { f: 'A2+B2' }]],
    }],
  });
  assert.equal(typeof r, 'string');
  assert.doesNotMatch(r, /^Error/);
});

test('xlsx: a formula referencing a missing cell + a circular formula do not crash', async () => {
  const r = await run(generateSpreadsheetTool, {
    output: 'badformula.xlsx',
    sheets: [{ name: 'M', columns: [{ header: 'K' }, { header: 'V', type: 'number' }], rows: [['a', { f: 'ZZ999*2', v: 0 }], ['b', { f: 'B4', v: 0 }], ['c', { f: 'B3', v: 0 }]] }],
  });
  assert.doesNotMatch(r, /^Error/);
});

test('xlsx: a blank spacer row does NOT fail validation (off-by-one trap)', async () => {
  // SheetJS trims the trailing blank row, so re-read count = sent − 1. The old strict check
  // failed here forever and drove the model off the tool. Must succeed now.
  const r = await run(generateSpreadsheetTool, {
    output: 'spacer.xlsx',
    sheets: [{
      name: 'A',
      columns: [{ header: 'Item' }, { header: 'Val', type: 'number' }],
      rows: [['Rent', 100], ['Utilities', 50], ['', ''], ['Total', { f: 'SUM(B2:B3)' }]],
    }],
  });
  assert.doesNotMatch(r, /^Error/, r);
  assert.match(r, /Generated/);
});

test('xlsx: STAGED build — append adds sheets, preserves prior ones, resolves cross-sheet formulas', async () => {
  // Stage 1: the Assumptions driver sheet.
  const r1 = await run(generateSpreadsheetTool, {
    output: 'model.xlsx',
    sheets: [{ name: 'Assumptions', columns: [{ header: 'Driver' }, { header: 'Value', type: 'number' }], rows: [['Monthly rent', 25000], ['Growth', 0.05]] }],
  });
  assert.doesNotMatch(r1, /^Error/);

  // Stage 2: append a schedule sheet that references Assumptions with live formulas.
  const r2 = await run(generateSpreadsheetTool, {
    output: 'model.xlsx',
    append: true,
    sheets: [{
      name: 'OPEX',
      columns: [{ header: 'Line' }, { header: 'M1', type: 'currency' }, { header: 'M2', type: 'currency' }],
      rows: [
        ['Rent', { f: 'Assumptions!B2' }, { f: 'Assumptions!B2*(1+Assumptions!B3)' }],
        ['Total', { f: 'SUM(B2:B2)' }, { f: 'SUM(C2:C2)' }],
      ],
    }],
  });
  assert.doesNotMatch(r2, /^Error/);
  assert.match(r2, /2 sheet\(s\) now in the workbook/);

  // Re-open: BOTH sheets present, and the cross-sheet formula's cached value was recalculated.
  const XLSX: any = await import('xlsx');
  const wb = XLSX.read(fs.readFileSync(path.join(ws, 'model.xlsx')), { type: 'buffer' });
  assert.deepEqual(wb.SheetNames, ['Assumptions', 'OPEX']);
  const opex = wb.Sheets['OPEX'];
  assert.equal(opex['B2'].f, 'Assumptions!B2');
  assert.equal(opex['B2'].v, 25000); // resolved across sheets
  assert.equal(opex['C2'].v, 26250); // 25000 * 1.05
});

test('xlsx: a formula our evaluator cannot compute is PRESERVED, never dropped', async () => {
  // ExcelJS silently drops a formula cell that has no `result` — so an unsupported formula
  // (NPV/IRR/VLOOKUP/…) would vanish entirely. The recalc must stamp a placeholder result so
  // the formula survives (Excel recomputes on open). Regression guard for that fix.
  await run(generateSpreadsheetTool, {
    output: 'survive.xlsx',
    sheets: [{
      name: 'M',
      columns: [{ header: 'Line' }, { header: 'V', type: 'number' }],
      rows: [['cash', 100], ['npv', { f: 'NPV(0.1,B2,B2)' }], ['irr', '=IRR(B2:B3)']],
    }],
  });
  const XLSX: any = await import('xlsx');
  const wb = XLSX.read(fs.readFileSync(path.join(ws, 'survive.xlsx')), { type: 'buffer' });
  const sh = wb.Sheets['M'];
  assert.equal(sh['B3'].f, 'NPV(0.1,B2,B2)'); // object-form unsupported formula kept
  assert.equal(sh['B4'].f, 'IRR(B2:B3)'); // "=..." string-form unsupported formula kept
});

test('xlsx: total rows are bold + top-ruled (finance-grade styling)', async () => {
  await run(generateSpreadsheetTool, {
    output: 'totals.xlsx',
    sheets: [{ name: 'S', columns: [{ header: 'Item' }, { header: 'Amt', type: 'number' }], rows: [['Coffee', 10], ['Total', { f: 'SUM(B2:B2)' }]] }],
  });
  const ExcelJS: any = (await import('exceljs')).default ?? (await import('exceljs'));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(ws, 'totals.xlsx'));
  const ws2 = wb.getWorksheet('S');
  const totalRow = ws2.getRow(3); // header=1, Coffee=2, Total=3
  assert.equal(totalRow.getCell(1).font?.bold, true);
  assert.equal(totalRow.getCell(1).border?.top?.style, 'thin');
});

// ---------- generate_doc ----------
test('docx: empty/missing blocks does not crash', async () => {
  const r1 = await run(generateDocTool, { output: 'empty.docx', title: 'T', blocks: [] });
  assert.equal(typeof r1, 'string');
  const r2 = await run(generateDocTool, { output: 'noblocks.docx', title: 'T' });
  assert.equal(typeof r2, 'string');
});

test('docx: special chars, HTML-like text, malformed blocks do not crash', async () => {
  const r = await run(generateDocTool, {
    output: 'special.docx',
    title: '<b>Title</b> & "quotes" — 🚀 العربية',
    blocks: [
      { type: 'paragraph', text: '<script>alert(1)</script> & ünïcödé' },
      { type: 'bullets', items: ['', null, 'ok', 123] },
      { type: 'table', header: ['A'], rows: [['x', 'extra', 'cells'], []] },
      { type: 'heading' }, // missing text
      { type: 'totally-unknown-type', text: 'x' },
    ],
  });
  assert.equal(typeof r, 'string');
  assert.doesNotMatch(r, /^Error/);
});

// ---------- generate_compliance_file ----------
test('compliance: missing/unknown kind → clean error', async () => {
  assert.match(await run(generateComplianceFileTool, {}), /^Error|kind/i);
  assert.match(await run(generateComplianceFileTool, { kind: 'not_a_real_kind' }), /Error|kind/i);
});

test('compliance: wps_sif with no employees → clean error, not a crash', async () => {
  const r = await run(generateComplianceFileTool, { kind: 'wps_sif', employerId: '1234567890123', bankRoutingCode: '123456789', employees: [] });
  assert.equal(typeof r, 'string');
  assert.match(r, /Error|employee|EDR/i);
});

// ---------- render_chart (buildVlSpec — pure) ----------
test('chart: empty data, single point, unknown type, missing fields do not throw', () => {
  for (const args of [
    { type: 'bar', data: [], x: 'a', y: 'b' },
    { type: 'line', data: [{ a: 1, b: 2 }], x: 'a', y: 'b' },
    { type: 'totally-unknown' as any, data: [{ a: 1, b: 2 }], x: 'a', y: 'b' },
    { type: 'donut', data: [{ k: 'x', v: -5 }, { k: 'y', v: 0 }], x: 'k', y: 'v' },
    { type: 'heatmap', data: [{ x: 'a', y: 'b' }], x: 'x', y: 'y' } as any,
    { type: 'bar' } as any, // no data/fields at all
  ]) {
    assert.doesNotThrow(() => {
      const spec = buildVlSpec(args as any);
      assert.equal(typeof spec, 'object');
    }, `chart ${JSON.stringify(args.type)}`);
  }
});
