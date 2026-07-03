import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditFormulaRefs, formulaAuditLines, excelToWorkbook, auditExcelWorkbook } from '../src/agent/tools/sheetAudit';
import { financialModelScaffold } from '../src/agent/tools/excel';

const f = (formula: string, v?: number) => (v === undefined ? { f: formula } : { f: formula, v });

const sheets = (over: any = {}) => [
  {
    name: 'Assumptions',
    columns: [{ header: 'Driver' }, { header: 'Value' }],
    rows: [
      ['Growth', 0.1], // B2
      ['Base', 1000], // B3
    ],
  },
  {
    name: 'Income',
    columns: [{ header: 'Item' }, { header: 'Y1' }, { header: 'Y2' }],
    rows: [
      ['Revenue', f('Assumptions!$B$3', 1000), f('B2*(1+Assumptions!$B$2)', 1100)], // row 2
      ['Total', f('SUM(B2:B2)', 1000), f('SUM(C2:C2)', 1100)], // row 3
    ],
  },
  ...(over.extra ?? []),
];

test('clean model: no defects, formulas counted and computed', () => {
  const a = auditFormulaRefs(sheets());
  assert.deepEqual(a.refDefects, []);
  assert.deepEqual(a.mismatches, []);
  assert.equal(a.formulaCells, 4);
  assert.ok(a.computedCells >= 4);
});

test('the shipped financial-model scaffold audits clean (locks the template)', () => {
  const a = auditFormulaRefs(financialModelScaffold());
  assert.deepEqual(a.refDefects, []);
  assert.deepEqual(a.mismatches, [], JSON.stringify(a.mismatches));
});

test('missing sheet ref is a defect; near-miss suggests the real tab', () => {
  const s = sheets();
  s[1].rows[0][1] = f('Asumptions!$B$3', 1000); // typo'd sheet
  const a = auditFormulaRefs(s);
  assert.equal(a.refDefects.length, 1);
  assert.match(a.refDefects[0], /does not exist/);
  // near-miss (space/case variant) → suggestion
  const s2 = sheets();
  s2[1].rows[0][1] = { f: "'ASSUMPTIONS '!B3", v: 1000 };
  const a2 = auditFormulaRefs(s2);
  assert.match(a2.refDefects[0] ?? '', /tab is named "Assumptions"/);
});

test('dot-notation ref (the M3 quirk) is a defect with the exact fix', () => {
  const s = sheets();
  s[1].rows[0][1] = f('Assumptions.B3', 1000);
  const a = auditFormulaRefs(s);
  assert.equal(a.refDefects.length, 1);
  assert.match(a.refDefects[0], /DOT notation/);
  assert.match(a.refDefects[0], /Assumptions!B3/);
});

test('single-cell ref beyond the sheet extent is flagged; padded RANGES are not', () => {
  const s = sheets();
  s[1].rows[0][1] = f('Assumptions!$B$9', 1000); // Assumptions has 3 rows total
  const a = auditFormulaRefs(s);
  assert.equal(a.refDefects.length, 1);
  assert.match(a.refDefects[0], /EMPTY cell/);
  const s2 = sheets();
  s2[1].rows[1][1] = f('SUM(Assumptions!B2:B100)', 1000); // padded range = fine
  assert.deepEqual(auditFormulaRefs(s2).refDefects, []);
});

test('cached value disagreeing with the computed formula surfaces as a mismatch', () => {
  const s = sheets();
  s[1].rows[0][2] = f('B2*(1+Assumptions!$B$2)', 9999); // formula computes 1100
  const a = auditFormulaRefs(s);
  assert.equal(a.mismatches.length, 1);
  assert.equal(a.mismatches[0].cached, 9999);
  assert.ok(Math.abs(a.mismatches[0].computed - 1100) < 1e-6);
  const lines = formulaAuditLines(a);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /DISAGREES/);
  assert.match(lines[0], /Income!C2/);
});

test('unsupported functions are telemetry, not defects', () => {
  const s = sheets();
  s[1].rows[1][1] = f('NPV(0.1,B2:B2)+VLOOKUP(1,B2:C2,2)', 1000);
  const a = auditFormulaRefs(s);
  assert.deepEqual(a.unsupportedFns, ['NPV', 'VLOOKUP']);
  assert.deepEqual(a.refDefects, []);
});

test('excelToWorkbook + auditExcelWorkbook: a built workbook audits like the payload', async () => {
  const mod: any = await import('exceljs');
  const ExcelJS = mod.default ?? mod;
  const wb = new ExcelJS.Workbook();
  const a = wb.addWorksheet('Assumptions');
  a.addRow(['Driver', 'Value']);
  a.addRow(['Base', 1000]);
  const i = wb.addWorksheet('Income');
  i.addRow(['Item', 'Y1']);
  i.addRow(['Revenue', { formula: 'Asumptions!B2', result: 1000 }]); // typo'd sheet
  const audit = auditExcelWorkbook(wb);
  assert.equal(audit.refDefects.length, 1);
  assert.match(audit.refDefects[0], /does not exist|tab is named/);
  const map = excelToWorkbook(wb);
  assert.ok(map.get('Income')?.get('B2')?.f);
});
