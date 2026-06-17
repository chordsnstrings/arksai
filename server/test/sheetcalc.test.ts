import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recalc, recalcSheetData, type Workbook, type SheetGrid } from '../src/agent/tools/sheetcalc';

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
