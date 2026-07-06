import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { expandPatternSheets, isPatternSheet } from '../src/agent/excelPattern';
import { auditFormulaRefs, labelsOverlap } from '../src/agent/tools/sheetAudit';
import { generateSpreadsheetTool } from '../src/agent/tools/excel';

// The EXACT pattern payload seed-2-0-pro produced in the 2026-07-06 bake-off (round 2) —
// 4/4 semantic ground truth in 16s. Replayed here through the real expander + tool.
const BAKEOFF_SPEC = {
  output: 'model.xlsx',
  sheets: [
    {
      name: 'Assumptions',
      rows: [
        { label: 'monthly unit growth rate', value: 0.04 },
        { label: 'price per unit (AED)', value: 55 },
        { label: 'bean cost per unit (AED)', value: 18 },
        { label: 'rent per month (AED)', value: 25000 },
        { label: 'salaries per month (AED)', value: 38000 },
        { label: 'marketing (% of revenue)', value: 0.08 },
        { label: 'corporate tax rate', value: 0.09 },
        { label: 'opening cash (AED)', value: 150000 },
        { label: 'base units month 1', value: 1000 },
      ],
    },
    {
      name: 'Revenue',
      months: 24,
      rows: [
        { label: 'Units', first: '={ROW:Assumptions!base units month 1}', then: '={PREV}*(1+{ROW:Assumptions!monthly unit growth rate})' },
        { label: 'Revenue', each: '={ROW:Units}*{ROW:Assumptions!price per unit (AED)}' },
      ],
    },
    {
      name: 'Opex',
      months: 24,
      rows: [
        { label: 'bean cost', each: '={ROW:Revenue!Units}*{ROW:Assumptions!bean cost per unit (AED)}' },
        { label: 'rent', each: '={ROW:Assumptions!rent per month (AED)}' },
        { label: 'salaries', each: '={ROW:Assumptions!salaries per month (AED)}' },
        { label: 'marketing', each: '={ROW:Revenue!Revenue}*{ROW:Assumptions!marketing (% of revenue)}' },
        { label: 'Total opex', each: '={ROW:rent}+{ROW:salaries}+{ROW:marketing}' },
      ],
    },
    {
      name: 'PnL',
      months: 24,
      rows: [
        { label: 'Revenue', each: '={ROW:Revenue!Revenue}' },
        { label: 'COGS beans', each: '={ROW:Opex!bean cost}' },
        { label: 'Total opex', each: '={ROW:Opex!Total opex}' },
        { label: 'Profit before tax', each: '={ROW:Revenue}-{ROW:COGS beans}-{ROW:Total opex}' },
        { label: 'Tax', each: '=IF({ROW:Profit before tax}>0,{ROW:Profit before tax}*{ROW:Assumptions!corporate tax rate},0)' },
        { label: 'Net profit', each: '={ROW:Profit before tax}-{ROW:Tax}' },
        { label: 'Cumulative cash', first: '={ROW:Assumptions!opening cash (AED)}+{ROW:Net profit}', then: '={PREV}+{ROW:Net profit}' },
      ],
    },
  ],
};

// Independent arithmetic — the same ground truth the bake-off used.
function groundTruth() {
  const g = 0.04, price = 55, bean = 18, rent = 25000, sal = 38000, mkt = 0.08, tax = 0.09, open = 150000;
  let units = 1000, cum = open;
  const out = { units24: 0, cum24: 0 };
  for (let m = 1; m <= 24; m++) {
    if (m > 1) units *= 1 + g;
    const rev = units * price;
    const pbt = rev - units * bean - (rent + sal + mkt * rev);
    cum += pbt - (pbt > 0 ? pbt * tax : 0);
    if (m === 24) { out.units24 = units; out.cum24 = cum; }
  }
  return out;
}

test('pattern expansion: layout contract, {PREV}/{ROW} resolution, value-only sheets, tolerant labels', () => {
  const sheets = expandPatternSheets(structuredClone(BAKEOFF_SPEC.sheets));
  // Value-only sheet: Driver/Value columns, values in B, data from row 2 (no months header).
  const asm = sheets[0];
  assert.equal(asm.columns.length, 2);
  assert.deepEqual(asm.rows[0], ['monthly unit growth rate', 0.04]);
  // Months sheet: Item + M1..M24 columns; formulas resolve labels to real A1 refs.
  const rev = sheets[1];
  assert.equal(rev.columns.length, 25);
  assert.equal(rev.rows[0][1], "='Assumptions'!$B$10", 'base units = 9th assumption = row 10');
  assert.equal(rev.rows[0][2], "=B2*(1+'Assumptions'!$B$2)", '{PREV} + growth ref');
  assert.equal(rev.rows[0][24], "=X2*(1+'Assumptions'!$B$2)", 'M24 column math');
  assert.equal(rev.rows[1][5], "=F2*'Assumptions'!$B$3", 'same-sheet {ROW:Units} + price');
  // Tolerant label matching (abbreviated ref).
  const tol = expandPatternSheets([
    { name: 'A', rows: [{ label: 'opening cash (AED)', value: 5 }] },
    { name: 'S', months: 2, rows: [{ label: 'x', each: '={ROW:A!opening cash}' }] },
  ]);
  assert.equal(tol[1].rows[0][1], "='A'!$B$2");
  // Unknown label: honest error listing the available labels.
  assert.throws(
    () => expandPatternSheets([{ name: 'S', months: 2, rows: [{ label: 'x', each: '={ROW:nope}' }] }]),
    /no row labeled like "nope".*"x"/s,
  );
  // Non-pattern sheets pass through untouched; mixed workbooks work.
  const mixed = expandPatternSheets([{ name: 'Raw', columns: [{ header: 'A' }], rows: [['v', 1]] }, ...structuredClone(BAKEOFF_SPEC.sheets.slice(0, 1))]);
  assert.deepEqual(mixed[0].rows, [['v', 1]]);
  assert.ok(!isPatternSheet(mixed[0]) && isPatternSheet(BAKEOFF_SPEC.sheets[1]));
});

test('bake-off payload through the REAL tool: audit-clean + exact ground truth', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-xlsx-pattern-'));
  const ctx: any = { session: { id: 't', orgId: null }, repoDir: dir, mode: 'code', signal: new AbortController().signal, addCost: () => {} };
  try {
    const result = await generateSpreadsheetTool.run(structuredClone(BAKEOFF_SPEC), ctx);
    assert.match(result, /audit-clean/, `tool result: ${result.slice(0, 300)}`);
    // Re-open and score the M24 column against independent arithmetic.
    const ExcelJS = (await import('exceljs')).default ?? (await import('exceljs'));
    const wb = new (ExcelJS as any).Workbook();
    await wb.xlsx.readFile(path.join(dir, 'model.xlsx'));
    const val = (c: any) => (c && typeof c === 'object' && 'result' in c ? c.result : c);
    const find = (label: string) => {
      for (const ws of wb.worksheets)
        for (let r = 1; r <= ws.rowCount; r++)
          if (String(val(ws.getRow(r).getCell(1).value) ?? '').trim().toLowerCase() === label) return Number(val(ws.getRow(r).getCell(25).value));
      return NaN;
    };
    const gt = groundTruth();
    assert.ok(Math.abs(find('units') - gt.units24) < 0.01, 'compounding units M24 exact');
    assert.ok(Math.abs(find('cumulative cash') - gt.cum24) < 1, 'cumulative cash M24 exact');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('label-sanity audit catches the wrong-row passthrough the bake-off exposed', () => {
  // The seed-2-0-pro verbose failure, distilled: "Rent" passthrough points at the bean-cost
  // cell while a "rent per month" row exists — structurally valid, semantically wrong.
  const sheets = [
    {
      name: 'Assumptions',
      columns: [{ header: 'Driver' }, { header: 'Value' }],
      rows: [['bean cost per unit (AED)', 18], ['rent per month (AED)', 25000]],
    },
    {
      name: 'Opex',
      columns: [{ header: 'Item' }, { header: 'M1' }],
      rows: [['Rent', '=Assumptions!$B$2']],
    },
  ];
  const audit = auditFormulaRefs(sheets);
  assert.ok(
    audit.refDefects.some((d) => d.includes('"Rent"') && d.includes('bean cost') && d.includes('Did you mean Assumptions!$B$3')),
    `defects: ${JSON.stringify(audit.refDefects)}`,
  );
  // The CORRECT passthrough does not fire.
  sheets[1].rows = [['Rent', '=Assumptions!$B$3']];
  assert.equal(auditFormulaRefs(sheets).refDefects.length, 0);
  // Multi-term formulas are exempt (Revenue = Units*price legitimately crosses labels).
  sheets[1].rows = [['Revenue', '=B2*Assumptions!$B$2']];
  assert.equal(auditFormulaRefs(sheets).refDefects.length, 0);
  // Overlap helper: stems plurals, ignores glue words, never accuses unscoreable labels.
  assert.ok(labelsOverlap('Units', 'base units month 1'));
  assert.ok(labelsOverlap('Rent', 'rent per month (AED)'));
  assert.ok(!labelsOverlap('Rent', 'bean cost per unit (AED)'));
  assert.ok(labelsOverlap('—', 'anything'));
});
