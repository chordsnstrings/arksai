import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  autoMapSources,
  combineSources,
  dateOrderEvidence,
  detectHeaderRow,
  parseAmountStrict,
  parseDateValue,
  profileSource,
  type GridSource,
} from '../src/agent/sheetCombine';
import { combineSpreadsheetsTool } from '../src/agent/tools/combineSheets';

// ---------------------------------------------------------------------------
// COMBINE ENGINE (operator 2026-07-06: multiple bank/expense exports → one
// clean reconciled workbook). The model only maps columns; everything here is
// deterministic — these tests lock the data behaviour cell by cell.
// ---------------------------------------------------------------------------

test('parseAmountStrict: currency symbols, parens, thousands, CR/DR, junk', () => {
  assert.equal(parseAmountStrict(1234.5), 1234.5);
  assert.equal(parseAmountStrict('1,234.56'), 1234.56);
  assert.equal(parseAmountStrict('AED 1,250.00'), 1250);
  assert.equal(parseAmountStrict('$1,200'), 1200);
  assert.equal(parseAmountStrict('(1,200.00)'), -1200);
  assert.equal(parseAmountStrict('500 CR'), 500);
  assert.equal(parseAmountStrict('500 DR'), -500);
  assert.equal(parseAmountStrict('750-'), -750);
  assert.equal(parseAmountStrict('1234'), 1234);
  assert.equal(parseAmountStrict('Opening Balance'), null);
  assert.equal(parseAmountStrict(''), null);
  assert.equal(parseAmountStrict(null), null);
});

test('parseDateValue: ISO, serials, slash order, month names, garbage rejected', () => {
  assert.equal(parseDateValue('2024-03-12')?.toISOString().slice(0, 10), '2024-03-12');
  // Excel serial 45355 = 2024-03-04.
  assert.equal(parseDateValue(45355)?.toISOString().slice(0, 10), '2024-03-04');
  // Unambiguous day-first (31 > 12) regardless of the order hint.
  assert.equal(parseDateValue('31/01/2024', 'mdy')?.toISOString().slice(0, 10), '2024-01-31');
  // Ambiguous pair resolved by the order hint.
  assert.equal(parseDateValue('03/04/2024', 'dmy')?.toISOString().slice(0, 10), '2024-04-03');
  assert.equal(parseDateValue('03/04/2024', 'mdy')?.toISOString().slice(0, 10), '2024-03-04');
  assert.equal(parseDateValue('12 Mar 2024')?.toISOString().slice(0, 10), '2024-03-12');
  assert.equal(parseDateValue('Mar 12, 2024')?.toISOString().slice(0, 10), '2024-03-12');
  assert.equal(parseDateValue('12-Mar-24')?.toISOString().slice(0, 10), '2024-03-12');
  assert.equal(parseDateValue('31/02/2024'), null, 'rollover dates are rejected, not silently shifted');
  assert.equal(parseDateValue('not a date'), null);
  assert.equal(parseDateValue(1500), null, 'small numbers are amounts, not serials');
});

test('dateOrderEvidence: any day>12 disambiguates the corpus', () => {
  assert.equal(dateOrderEvidence(['01/02/2024', '15/02/2024']), 'dmy');
  assert.equal(dateOrderEvidence(['01/02/2024', '02/15/2024']), 'mdy');
  assert.equal(dateOrderEvidence(['01/02/2024', '03/04/2024']), 'unknown');
});

test('detectHeaderRow: finds the real header under bank preamble', () => {
  const grid = [
    ['Account Statement', null, null, null],
    ['Account: 0012-3456789', null, null, null],
    [null, null, null, null],
    ['Date', 'Description', 'Debit', 'Credit'],
    ['01/02/2024', 'POS Carrefour', '250.00', null],
  ];
  assert.equal(detectHeaderRow(grid), 3);
  assert.equal(detectHeaderRow([['Date', 'Item', 'Amount'], ['2024-01-01', 'x', 5]]), 0);
});

test('autoMap + combine: three messy sources → one clean reconciled set', () => {
  // Source A: preamble, DD/MM text dates, debit/credit pair, a repeated header
  // mid-file, a closing-balance footer, an empty row.
  const A: GridSource = {
    file: 'a.xlsx',
    tab: 'Sheet1',
    grid: [
      ['Statement of Account', null, null, null],
      ['Account: 001', null, null, null],
      ['Date', 'Description', 'Withdrawal', 'Deposit'],
      ['15/01/2024', 'POS Carrefour  Deira', '250.00', null],
      ['20/01/2024', 'Salary  ACME LLC', null, '12,000.00'],
      [null, null, null, null],
      ['Date', 'Description', 'Withdrawal', 'Deposit'], // repeated header
      ['28/01/2024', 'Balance transfer to savings', '1,000.00', null],
      [null, 'Closing Balance', null, '10,750.00'], // footer
    ],
  };
  // Source B: signed amounts with parens, ISO dates, one row OVERLAPPING A.
  const B: GridSource = {
    file: 'b.csv',
    tab: '',
    grid: [
      ['Transaction Date', 'Details', 'Amount', 'Reference'],
      ['2024-01-20', 'Salary ACME LLC', '12,000.00', 'SAL-01'], // dup of A row 2 (same date/desc/amount)
      ['2024-02-02', 'DEWA bill', '(430.50)', 'DEWA-9'],
      ['2024-02-10', 'Gym Total Fitness', '(199.00)', 'GYM-2'],
    ],
  };
  // Source C: Excel serial dates + AED-prefixed amounts.
  const C: GridSource = {
    file: 'c.xlsx',
    tab: 'Feb',
    grid: [
      ['Date', 'Description', 'Amount'],
      [45355, 'Groceries Lulu', 'AED 320.00'], // 2024-03-04
      [45360, 'Fuel ENOC', '(120.00)'],
    ],
  };
  const sources = [A, B, C];
  const profiles = sources.map(profileSource);
  assert.equal(profiles[0].headerRow, 2, 'preamble skipped');
  assert.equal(profiles[0].dateOrder, 'dmy', '15>12 and 20>12 prove day-first');

  const plan = autoMapSources(profiles);
  assert.ok(plan.confident, `plan should be confident: ${plan.notes.join(' | ')}`);
  const amount = plan.fields.find((f) => f.name === 'Amount')!;
  assert.deepEqual(amount.from['a.xlsx › Sheet1'], { debit: 2, credit: 3 }, 'debit/credit pair merged');

  const r = combineSources(sources, profiles, plan);
  // A: 6 data rows → 3 kept (1 empty, 1 repeated header, 1 footer).
  const ra = r.perSource[0];
  assert.equal(ra.rowsIn, 6);
  assert.deepEqual(
    { kept: ra.kept, ...ra.drops },
    { kept: 3, empty: 1, repeatedHeader: 1, footer: 1, nonData: 0, duplicate: 0 },
  );
  // B: 3 rows → 2 kept (salary row deduped against A).
  assert.equal(r.perSource[1].kept, 2);
  assert.equal(r.perSource[1].drops.duplicate, 1);
  // C: both kept, serial dates parsed.
  assert.equal(r.perSource[2].kept, 2);
  // Reconciliation invariant: total kept == emitted rows.
  assert.equal(r.rows.length, 3 + 2 + 2);
  // Amounts: A = -250 + 12000 - 1000; B kept = -430.5 - 199; C = 320 - 120.
  assert.ok(Math.abs(r.totalAmount - (10750 - 629.5 + 200)) < 1e-9);
  // Sorted by date, Source column stamped last.
  const dates = r.rows.map((row) => row[0] as Date);
  for (let i = 1; i < dates.length; i++) assert.ok(dates[i - 1].getTime() <= dates[i].getTime(), 'sorted by date');
  assert.equal(r.rows[0][r.rows[0].length - 1], 'a.xlsx › Sheet1');
});

test('e2e: combine_spreadsheets writes a themed, reconciled workbook that passes the audits', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'combine-'));
  const mod: any = await import('exceljs');
  const ExcelJS = mod.default ?? mod;

  // Fixture 1: bank export with preamble + debit/credit + footer.
  const wb1 = new ExcelJS.Workbook();
  const ws1 = wb1.addWorksheet('Statement');
  ws1.addRow(['Account Statement — 001']);
  ws1.addRow([]);
  ws1.addRow(['Date', 'Description', 'Withdrawal', 'Deposit']);
  ws1.addRow(['15/01/2024', 'POS Carrefour', '250.00', null]);
  ws1.addRow(['20/01/2024', 'Salary ACME', null, '12,000.00']);
  ws1.addRow(['28/01/2024', 'Balance transfer to savings', '1,000.00', null]);
  ws1.addRow([null, 'Closing Balance', null, '10,750.00']);
  await wb1.xlsx.writeFile(path.join(dir, 'jan.xlsx'));

  // Fixture 2: csv with signed amounts + an overlapping row.
  fs.writeFileSync(
    path.join(dir, 'feb.csv'),
    'Transaction Date,Details,Amount,Reference\n' +
      '2024-01-20,Salary ACME,"12,000.00",SAL-01\n' +
      '2024-02-02,DEWA bill,"(430.50)",DEWA-9\n' +
      '2024-02-10,Gym Total Fitness,"(199.00)",GYM-2\n',
  );

  const ctx: any = { session: { id: 't', orgId: null }, repoDir: dir, mode: 'code', signal: new AbortController().signal, addCost: () => {} };
  const out = await combineSpreadsheetsTool.run(
    { inputs: ['jan.xlsx', 'feb.csv'], output: 'combined.xlsx', currency: 'AED', accent: '#1f5f8b' },
    ctx,
  );
  assert.match(out, /Combined 2 sheet\(s\)/, out.slice(0, 400));
  assert.match(out, /every tie check reads OK/);
  assert.match(out, /1 duplicate/);
  assert.match(out, /1 footer\/total/);

  // Re-open: theme + audit ties + monthly summary.
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(dir, 'combined.xlsx'));
  const combined = wb.getWorksheet('Combined');
  const audit = wb.getWorksheet('Audit');
  const monthly = wb.getWorksheet('Monthly');
  assert.ok(combined && audit && monthly, 'all three sheets present');
  assert.equal(combined.views?.[0]?.showGridLines, false, 'premium theme applied');
  assert.equal(combined.getRow(2).getCell(1).font?.name, 'Helvetica');
  // 3 kept from jan + 2 kept from feb (salary deduped) = 5 data rows.
  assert.equal(combined.rowCount, 6);
  // Dates are REAL date cells sorted ascending.
  const d2 = combined.getRow(2).getCell(1).value;
  assert.ok(d2 instanceof Date, 'date column holds real dates');
  // Audit tie checks read OK for every source row + TOTAL (live IF formulas, cached "OK").
  const val = (c: any) => (c && typeof c === 'object' && 'result' in c ? c.result : c);
  audit.eachRow((row: any, n: number) => {
    if (n === 1) return;
    assert.equal(val(row.getCell(12).value), 'OK', `Audit rows tie, row ${n}`);
    assert.equal(val(row.getCell(13).value), 'OK', `Audit sum ties, row ${n}`);
  });
  // Monthly totals: Jan = -250 + 12000 - 1000 = 10750; Feb = -629.50.
  const months: Record<string, number> = {};
  monthly.eachRow((row: any, n: number) => {
    if (n === 1) return;
    months[String(row.getCell(1).value)] = Number(val(row.getCell(3).value));
  });
  assert.equal(months['2024-01'], 10750);
  assert.equal(months['2024-02'], -629.5);

  // The deterministic quality audits must NOT flag imported data ("Balance transfer",
  // "Total Fitness", date serials next to small amounts were all false-positive traps).
  const XLSX: any = await import('xlsx');
  const { deterministicDeliverableDefects } = await import('../src/agent/deliverableCheck');
  const defects = deterministicDeliverableDefects({ wb: XLSX.read(fs.readFileSync(path.join(dir, 'combined.xlsx')), { type: 'buffer' }) });
  assert.deepEqual(defects, [], `combined workbook must be audit-clean: ${defects.join(' | ')}`);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('ambiguous sources return profiles + a proposed mapping instead of writing a file', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'combine-amb-'));
  // No recognisable date column → not confident.
  fs.writeFileSync(path.join(dir, 'odd.csv'), 'When,What,How much\nyesterday,thing,12\n');
  const ctx: any = { session: { id: 't', orgId: null }, repoDir: dir, mode: 'code', signal: new AbortController().signal, addCost: () => {} };
  const out = await combineSpreadsheetsTool.run({ inputs: ['odd.csv'] }, ctx);
  assert.match(out, /Could not auto-map/);
  assert.match(out, /PROPOSED mapping/);
  assert.ok(!fs.existsSync(path.join(dir, 'combined.xlsx')), 'no file written on the inspect path');
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// COMBINE v2 (BI hardening): locales, hierarchical headers, multi-table tabs,
// wide-format unpivot, corrupted IDs, update mode, missing-month honesty.
// ---------------------------------------------------------------------------

test('v2: EU number locale — evidence + parsing', async () => {
  const { numberLocaleEvidence } = await import('../src/agent/sheetCombine');
  assert.equal(numberLocaleEvidence(['1.234,56', '999,00']), 'eu');
  assert.equal(numberLocaleEvidence(['1,234.56', '999.00']), 'us');
  assert.equal(numberLocaleEvidence(['1.234']), 'unknown', 'ambiguous alone');
  assert.equal(parseAmountStrict('1.234,56', 'eu'), 1234.56);
  assert.equal(parseAmountStrict('(1.200,00)', 'eu'), -1200);
  assert.equal(parseAmountStrict('1,234.56', 'us'), 1234.56);
});

test('v2: two-row hierarchical headers compose', async () => {
  const { composeHeaders } = await import('../src/agent/sheetCombine');
  const grid = [
    ['Revenue', null, 'Cost', null],
    ['Q1', 'Q2', 'Q1', 'Q2'],
    [100, 200, 50, 60],
  ];
  const c = composeHeaders(grid, 0);
  assert.equal(c.headerRowCount, 2);
  assert.deepEqual(c.headers, ['Revenue Q1', 'Revenue Q2', 'Cost Q1', 'Cost Q2']);
  // A normal header over a TEXT-heavy data row must NOT be mistaken for two rows.
  const bank = [
    ['Date', 'Description', 'Debit', 'Credit'],
    ['01/02/2024', 'POS Carrefour', '250.00', null],
  ];
  assert.equal(composeHeaders(bank, 0).headerRowCount, 1);
});

test('v2: multi-table tabs pick the largest block; preamble is not a table', async () => {
  const { splitTables } = await import('../src/agent/sheetCombine');
  const grid = [
    ['Budget', 'Amount'],
    ['Rent', 100],
    ['Food', 200],
    [null, null],
    [null, null],
    ['Date', 'Item', 'Value'],
    ['2024-01-01', 'a', 1],
    ['2024-01-02', 'b', 2],
    ['2024-01-03', 'c', 3],
  ];
  const tables = splitTables(grid);
  assert.equal(tables.length, 2);
  assert.equal(tables[0].rows.length, 4, 'largest block first');
  // One-cell preamble rows split from a table are NOT a second table.
  const pre = [
    ['Account Statement'],
    ['Account: 001'],
    [null],
    [null],
    ['Date', 'Description', 'Amount'],
    ['2024-01-01', 'x', 5],
    ['2024-01-02', 'y', 6],
  ];
  assert.equal(splitTables(pre).length, 1);
});

test('v2: wide (pivoted) layout unpivots to Date + Value', async () => {
  const { unpivotWide } = await import('../src/agent/sheetCombine');
  const src = {
    file: 'wide.xlsx',
    tab: '',
    grid: [
      ['Category', 'Jan-24', 'Feb-24', 'Mar-24', 'Apr-24'],
      ['Rent', 1000, 1000, 1100, 1100],
      ['Food', 400, 420, null, 460],
    ],
  };
  const un = unpivotWide(src as any);
  assert.ok(un, 'wide layout detected');
  assert.deepEqual(un!.src.grid[0], ['Category', 'Date', 'Value']);
  // 4 rent + 3 food values (the null Mar food cell is skipped).
  assert.equal(un!.src.grid.length - 1, 7);
  assert.ok(un!.src.grid[1][1] instanceof Date);
  // A normal transaction table must NOT be unpivoted.
  assert.equal(unpivotWide({ file: 'a', tab: '', grid: [['Date', 'Desc', 'Amount'], ['2024-01-01', 'x', 5]] } as any), null);
});

test('v2: corrupted Excel IDs are detected and warned, never "fixed"', () => {
  const src: GridSource = {
    file: 'ids.csv',
    tab: '',
    grid: [
      ['Date', 'Description', 'Amount', 'Card No'],
      ['2024-01-01', 'x', 5, '4.51278E+15'],
      ['2024-01-02', 'y', 6, '4.51278E+15'],
    ],
  };
  const p = profileSource(src);
  assert.deepEqual(p.corruptIdColumns, ['Card No']);
  const plan = autoMapSources([p]);
  assert.ok(plan.notes.some((n) => /corrupted IDs/i.test(n)), plan.notes.join(' | '));
});

test('v2: update mode — a prior combined file keeps its per-row Source provenance', () => {
  const prior: GridSource = {
    file: 'combined.xlsx',
    tab: 'Combined',
    grid: [
      ['Date', 'Description', 'Amount', 'Source'],
      ['2024-01-15', 'POS Carrefour', -250, 'jan.xlsx'],
      ['2024-01-20', 'Salary ACME', 12000, 'jan.xlsx'],
    ],
  };
  const fresh: GridSource = {
    file: 'mar.csv',
    tab: '',
    grid: [
      ['Date', 'Details', 'Amount'],
      ['2024-01-20', 'Salary ACME', '12,000.00'], // duplicate of the prior row
      ['2024-03-05', 'DEWA bill', '(430.50)'],
    ],
  };
  const profiles = [prior, fresh].map(profileSource);
  const plan = autoMapSources(profiles);
  assert.ok(plan.confident);
  assert.equal(plan.provenanceFrom?.['combined.xlsx › Combined'], 3, 'Source column claimed as provenance');
  const r = combineSources([prior, fresh], profiles, plan);
  assert.equal(r.perSource[1].drops.duplicate, 1, 'overlap deduped against the prior combined');
  const salary = r.rows.find((row) => row[1] === 'Salary ACME')!;
  assert.equal(salary[salary.length - 1], 'jan.xlsx', 'original provenance preserved, not overwritten');
  // Date coverage recorded per source.
  assert.equal(r.perSource[0].dateMin, '2024-01-15');
  assert.equal(r.perSource[1].dateMax, '2024-03-05');
});

test('v2 e2e: missing month inside the range shows as "no data", never skipped', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'combine-gap-'));
  fs.writeFileSync(
    path.join(dir, 'gap.csv'),
    'Date,Details,Amount\n2024-01-10,Jan txn,100\n2024-03-10,Mar txn,300\n',
  );
  const ctx: any = { session: { id: 't', orgId: null }, repoDir: dir, mode: 'code', signal: new AbortController().signal, addCost: () => {} };
  const out = await combineSpreadsheetsTool.run({ inputs: ['gap.csv'], output: 'g.xlsx' }, ctx);
  assert.match(out, /Month 2024-02 has NO rows/);
  const mod: any = await import('exceljs');
  const ExcelJS = mod.default ?? mod;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(dir, 'g.xlsx'));
  const monthly = wb.getWorksheet('Monthly');
  const labels: string[] = [];
  monthly.eachRow((row: any, n: number) => {
    if (n > 1) labels.push(String(row.getCell(1).value));
  });
  assert.deepEqual(labels, ['2024-01', '2024-02 — no data', '2024-03']);
  // Audit carries per-source date coverage.
  const audit = wb.getWorksheet('Audit');
  assert.equal(String(audit.getRow(2).getCell(14).value), '2024-01-10');
  assert.equal(String(audit.getRow(2).getCell(15).value), '2024-03-10');
  fs.rmSync(dir, { recursive: true, force: true });
});
