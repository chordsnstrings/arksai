import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { generateSpreadsheetTool, accentTint } from '../src/agent/tools/excel';

// ---------------------------------------------------------------------------
// PREMIUM THEME — deterministic, applied at BUILD time (operator, 2026-07-06):
// "the cosmetic verification in excel generation should be cut. instead the
// cosmetic should be applied from the get go." These tests lock the baked-in
// look (Helvetica, hidden gridlines, accent-tinted banding, finance
// conventions) AND that spreadsheets never enter the vision design-review.
// ---------------------------------------------------------------------------

test('accentTint: blends any accent to a light band colour', () => {
  const t = accentTint('FF4F46E5');
  assert.match(t, /^FF[0-9A-F]{6}$/);
  // Every channel must be LIGHT (≥ 0xE0) — a band, not a fill.
  for (const i of [2, 4, 6]) assert.ok(parseInt(t.slice(i, i + 2), 16) >= 0xe0, `channel at ${i} too dark in ${t}`);
  // And still carry a trace of the accent hue (blue channel > red for an indigo accent).
  assert.ok(parseInt(t.slice(6, 8), 16) > parseInt(t.slice(2, 4), 16));
});

test('premium theme is baked into the written workbook — no second pass needed', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xltheme-'));
  const ctx: any = { session: { id: 't', orgId: null }, repoDir: dir, mode: 'code', signal: new AbortController().signal, addCost: () => {} };
  const res = await generateSpreadsheetTool.run({ output: 'loan.xlsx', template: 'loan-amortization', months: 12, accent: '#4f46e5' }, ctx);
  assert.match(String(res), /audit-clean/);

  const mod: any = await import('exceljs');
  const ExcelJS = mod.default ?? mod;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(dir, 'loan.xlsx'));

  const names = wb.worksheets.map((w: any) => w.name);
  assert.ok(names.includes('Assumptions') && names.includes('Schedule'), `sheets: ${names}`);

  for (const ws of wb.worksheets) {
    // Gridlines OFF + frozen header on every sheet.
    assert.equal(ws.views?.[0]?.showGridLines, false, `${ws.name}: gridlines still on`);
    assert.equal(ws.views?.[0]?.state, 'frozen', `${ws.name}: header not frozen`);
    // Accent-coloured tab.
    assert.equal(String(ws.properties?.tabColor?.argb).toUpperCase(), 'FF4F46E5', `${ws.name}: tab not accent`);
    // Model sheets carry NO auto-filter arrows (pattern-expanded = statement, not data table).
    assert.ok(!ws.autoFilter, `${ws.name}: autoFilter should be off on a model sheet`);
    // Data typography is the theme face.
    const f = ws.getRow(2).getCell(1).font;
    assert.equal(f?.name, 'Helvetica', `${ws.name}: data font is ${f?.name}`);
  }

  // Per-row formats: money rows read as 2dp money (neutral — no $ unless a currency is
  // given), the compounding-factor ratio row keeps its precision format.
  const schedRows: Record<string, any> = {};
  wb.getWorksheet('Schedule').eachRow((row: any, n: number) => {
    if (n > 1) schedRows[String(row.getCell(1).value)] = row.getCell(2);
  });
  assert.equal(schedRows['Payment']?.numFmt, '#,##0.00', 'Payment row should be neutral 2dp money');
  assert.equal(schedRows['Compounding factor']?.numFmt, '0.0000', 'factor row keeps its ratio format');

  // Zebra band = accent tint (odd data rows), not generic grey.
  const sched = wb.getWorksheet('Schedule');
  const band = sched.getRow(3).getCell(1).fill;
  assert.equal(String(band?.fgColor?.argb).toUpperCase(), accentTint('FF4F46E5'), 'band is not the accent tint');

  // The tie-out CHECK row reads as audit furniture: italic + muted grey.
  let checkStyled = false;
  sched.eachRow((row: any, n: number) => {
    if (n === 1) return;
    const label = String(row.getCell(1).value ?? '');
    if (!/check/i.test(label)) return;
    const cf = row.getCell(2).font;
    assert.equal(cf?.italic, true, 'check row not italic');
    assert.equal(String(cf?.color?.argb).toUpperCase(), 'FF8A8F98', 'check row not muted');
    checkStyled = true;
  });
  assert.ok(checkStyled, 'no styled check row found on Schedule');

  // Assumption inputs wear the classic finance input-blue.
  const asm = wb.getWorksheet('Assumptions');
  let blue = 0;
  asm.eachRow((row: any, n: number) => {
    if (n === 1) return;
    row.eachCell((cell: any) => {
      if (typeof cell.value === 'number' && String(cell.font?.color?.argb).toUpperCase() === 'FF1F55C4') blue++;
    });
  });
  assert.ok(blue >= 3, `expected input-blue literals on Assumptions, found ${blue}`);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('xlsx never enters the vision design-review — deterministic audits are the gate', async () => {
  // Source lock: the early return must sit BEFORE the render/vision section, so no
  // spreadsheet can ever be re-authored for cosmetics by the design gate again.
  const src = fs.readFileSync(path.join(__dirname, '../src/agent/deliverableCheck.ts'), 'utf8');
  const cut = src.indexOf("if (kind === 'xlsx') {\n    base.ran = true;");
  const render = src.indexOf('// 2) Render to PNG(s).');
  assert.ok(cut > -1, 'xlsx early-return missing from checkDeliverable');
  assert.ok(render > -1 && cut < render, 'xlsx early-return must precede the render/vision section');

  // Functional lock: a real workbook through the real gate — zero vision calls, review ran.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xlgate-'));
  const ctx: any = { session: { id: 't', orgId: null }, repoDir: dir, mode: 'code', signal: new AbortController().signal, addCost: () => {} };
  await generateSpreadsheetTool.run({ output: 'm.xlsx', template: 'revenue-forecast', months: 6 }, ctx);
  const { checkDeliverable } = await import('../src/agent/deliverableCheck');
  const qc = await checkDeliverable(path.join(dir, 'm.xlsx'), 'xlsx', new AbortController().signal);
  assert.equal(qc.visionCalls, 0);
  assert.equal(qc.ran, true, 'deterministic review counts as the review (no skipped-gate warning)');
  assert.match(qc.detail, /no visual pass needed|deterministic audit/);
  fs.rmSync(dir, { recursive: true, force: true });
});
