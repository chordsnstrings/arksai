import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recalc, recalcSheetData, recalcWorkbook, type Workbook, type SheetGrid } from '../src/agent/tools/sheetcalc';

const grid = (cells: Record<string, { f?: string; v?: any }>): SheetGrid => new Map(Object.entries(cells));
const wbk = (sheets: Record<string, SheetGrid>): Workbook => new Map(Object.entries(sheets));

test('recalc: arithmetic + cell refs (corrects a wrong cached value)', () => {
  const g = grid({ A1: { v: 10 }, B1: { v: 20 }, C1: { f: 'A1+B1', v: 0 } });
  recalc(wbk({ S: g }));
  assert.equal(g.get('C1')!.v, 30);
});

test('recalc: operator precedence + parens + percent', () => {
  const g = grid({ A1: { v: 100 }, B1: { f: 'A1*(1+10%)', v: 0 } });
  recalc(wbk({ S: g }));
  assert.equal(g.get('B1')!.v, 110);
});

test('recalc: SUM over a range', () => {
  const g = grid({ A1: { v: 1 }, A2: { v: 2 }, A3: { v: 3 }, A4: { f: 'SUM(A1:A3)', v: 99 } });
  recalc(wbk({ S: g }));
  assert.equal(g.get('A4')!.v, 6);
});

test('recalc: cross-sheet reference', () => {
  const asum = grid({ B1: { v: 0.1 } });
  const calc = grid({ B2: { f: 'Assumptions!B1*1000', v: 0 } });
  recalc(wbk({ Assumptions: asum, Calc: calc }));
  assert.equal(calc.get('B2')!.v, 100);
});

test('recalc: IF() with a comparison condition (the KKLM software-cost row)', () => {
  // IF(C4>0, Assumptions!B19, 0) — comparisons must evaluate so the IF resolves,
  // else the net-savings chain that depends on it silently stays 0.
  const asum = grid({ B19: { v: 17628 } });
  const bk = grid({
    C4: { v: 76 },
    C9: { v: 1165080 },
    C10: { f: 'IF(C4>0,Assumptions!B19,0)', v: 0 },
    C11: { f: 'C9-C10', v: 0 },
  });
  recalc(wbk({ Assumptions: asum, Breakeven: bk }));
  assert.equal(bk.get('C10')!.v, 17628);
  assert.equal(bk.get('C11')!.v, 1147452); // the chain now resolves through the IF
});

test('recalc: comparison operators yield 1/0', () => {
  const g = grid({
    A1: { v: 5 }, A2: { v: 5 },
    B1: { f: 'A1>3', v: 0 },
    B2: { f: 'A1<3', v: 9 },
    B3: { f: 'A1>=A2', v: 0 },
    B4: { f: 'A1<>A2', v: 9 },
    B5: { f: 'IF(A1>=5, 100, 200)', v: 0 },
  });
  recalc(wbk({ S: g }));
  assert.equal(g.get('B1')!.v, 1);
  assert.equal(g.get('B2')!.v, 0);
  assert.equal(g.get('B3')!.v, 1);
  assert.equal(g.get('B4')!.v, 0);
  assert.equal(g.get('B5')!.v, 100);
});

test('recalc: roll-forward chain (Feb start = Jan end)', () => {
  // C2 ending = B2 start + 500; C3 start = C2 ending; resolves transitively
  const g = grid({ B2: { v: 1000 }, C2: { f: 'B2+500', v: 0 }, C3: { f: 'C2', v: 0 } });
  recalc(wbk({ S: g }));
  assert.equal(g.get('C2')!.v, 1500);
  assert.equal(g.get('C3')!.v, 1500);
});

test('recalc: leaves an unsupported formula (VLOOKUP) at the model value', () => {
  const g = grid({ A1: { v: 5 }, B1: { f: 'VLOOKUP(A1,X:Y,2)', v: 42 } });
  recalc(wbk({ S: g }));
  assert.equal(g.get('B1')!.v, 42); // untouched — formula preserved, Excel will compute
});

test('recalc: a cycle is left untouched (no crash)', () => {
  const g = grid({ A1: { f: 'B1', v: 7 }, B1: { f: 'A1', v: 7 } });
  recalc(wbk({ S: g }));
  assert.equal(g.get('A1')!.v, 7);
});

test('recalcSheetData: corrects cached values in a sheets/columns/rows structure (array rows)', () => {
  const sheets = [
    {
      name: 'Calc',
      columns: [{ header: 'Item' }, { header: 'Val', type: 'number' }],
      rows: [
        ['Base', 10],
        ['Double', { f: 'B2*2', v: 0 }], // wrong cached 0 → should become 20
      ],
    },
  ];
  recalcSheetData(sheets);
  assert.equal((sheets[0].rows[1][1] as any).v, 20);
});

test('recalcSheetData: cross-sheet driver feeds a calc sheet', () => {
  const sheets = [
    { name: 'Assumptions', columns: [{ header: 'Driver' }, { header: 'Value', type: 'number' }], rows: [['Growth', 0.2]] },
    { name: 'Plan', columns: [{ header: 'Line' }, { header: 'Y1', type: 'number' }], rows: [['Revenue', { f: 'Assumptions!B2*1000', v: 0 }]] },
  ];
  recalcSheetData(sheets);
  assert.equal((sheets[1].rows[0][1] as any).v, 200);
});

test('recalcSheetData: never throws on a malformed structure', () => {
  assert.doesNotThrow(() => recalcSheetData([{ name: 'X', rows: [[null, undefined, { f: '###' }]] } as any]));
  assert.doesNotThrow(() => recalcSheetData(null as any));
});

test('recalcWorkbook: caches results on a BUILT ExcelJS workbook (the cafe bug)', async () => {
  const mod: any = await import('exceljs');
  const ExcelJS = mod.default ?? mod;
  const wb = new ExcelJS.Workbook();
  // Reproduce the real defect: a TITLE row in the header pushed data down, and the
  // formula cells were written with NO cached result → blank preview.
  const a = wb.addWorksheet('Assumptions');
  a.columns = [{ header: 'ASSUMPTIONS', key: 'a' }, { header: '', key: 'b' }, { header: '', key: 'c' }];
  a.addRow(['Label', 'Value', 'Unit']);
  a.addRow(['Opening Cash', 2000, '$']);
  a.addRow(['Monthly Revenue', 7500, '$']); // B4
  a.addRow(['COGS %', 0.28, '%']); // B5
  const cf = wb.addWorksheet('Cash Flow');
  cf.columns = [{ header: 'Line', key: 'l' }, { header: 'Jan', key: 'jan' }];
  cf.addRow(['REVENUE', { formula: 'Assumptions!$B$4' }]); // B2 = 7500
  cf.addRow(['COGS', { formula: 'B2*Assumptions!$B$5' }]); // B3 = 2100
  cf.addRow(['Gross Profit', { formula: 'B2-B3' }]); // B4 = 5400

  // before: no cached results
  assert.equal((cf.getCell('B2').value as any).result, undefined);
  recalcWorkbook(wb);
  // after: every formula cell carries a correct cached result, formula preserved
  assert.equal((cf.getCell('B2').value as any).result, 7500);
  assert.equal((cf.getCell('B2').value as any).formula, 'Assumptions!$B$4');
  assert.equal((cf.getCell('B3').value as any).result, 2100);
  assert.equal((cf.getCell('B4').value as any).result, 5400);
});

test('recalcWorkbook: never throws on a bad workbook', () => {
  assert.doesNotThrow(() => recalcWorkbook(null));
  assert.doesNotThrow(() => recalcWorkbook({ eachSheet: () => { throw new Error('x'); } }));
});
