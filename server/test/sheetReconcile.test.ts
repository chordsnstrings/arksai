import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { autoKeys, normalizeEntityName, reconcileRecords, type RecRecord } from '../src/agent/sheetReconcile';
import { reconcileSpreadsheetsTool } from '../src/agent/tools/reconcileSheets';

const rec = (date: string | null, amount: number | null, description = '', reference = ''): RecRecord => ({
  date,
  amount,
  description,
  entity: normalizeEntityName(description),
  reference: reference.toLowerCase(),
  cells: [],
});

test('normalizeEntityName: case, punctuation, legal suffixes, &', () => {
  assert.equal(normalizeEntityName('Acme, Inc.'), 'acme');
  assert.equal(normalizeEntityName('ACME INC'), 'acme');
  assert.equal(normalizeEntityName('Bob & Sons LLC'), 'bob and sons');
  assert.equal(normalizeEntityName('  Gulf  Trading   FZ-LLC '), 'gulf trading');
  assert.ok(normalizeEntityName('Acme, Inc.') === normalizeEntityName('ACME INC'));
});

test('reconcileRecords: exact, mismatch, fuzzy, only — every row in exactly one bucket', () => {
  const A = [
    rec('2024-01-05', 100, 'Order 1', 'R1'),
    rec('2024-01-06', 200, 'Order 2', 'R2'),
    rec('2024-01-07', 300, 'Order 3', 'R3'),
    rec('2024-01-09', 400, 'Order 4', 'R4'),
  ];
  const B = [
    rec('2024-01-05', 100, 'Order 1', 'R1'), // exact
    rec('2024-01-06', 190, 'Order 2', 'R2'), // amount mismatch (fee taken)
    rec('2024-01-08', 300, 'Order 3', 'R5'), // fuzzy: same amount, +1 day
    rec('2024-01-20', 999, 'Order 9', 'R9'), // only in B
  ];
  const r = reconcileRecords(A, B, { keys: ['date', 'amount', 'description'] });
  assert.equal(r.matched.length, 1);
  assert.equal(r.mismatched.length, 1);
  assert.equal(r.mismatched[0].delta, -10);
  assert.equal(r.probable.length, 1);
  assert.equal(r.probable[0].daysApart, 1);
  assert.equal(r.onlyA.length, 1);
  assert.equal(r.onlyA[0].reference, 'r4');
  assert.equal(r.onlyB.length, 1);
});

test('autoKeys: a well-populated unique reference wins; else date+amount(+entity)', () => {
  const withRef = [rec('2024-01-01', 1, 'x', 'A1'), rec('2024-01-02', 2, 'y', 'A2')];
  assert.deepEqual(autoKeys(withRef, withRef), ['reference']);
  const noRef = [rec('2024-01-01', 1, 'Acme'), rec('2024-01-02', 2, 'Bulk')];
  assert.deepEqual(autoKeys(noRef, noRef), ['date', 'amount', 'description']);
});

test('reference matching pairs entities whose raw names differ', () => {
  const A = [rec('2024-01-05', 500, 'Acme, Inc.', 'INV-1')];
  const B = [rec('2024-01-05', 500, 'ACME INC', 'inv-1')];
  const r = reconcileRecords(A, B, { keys: ['reference'] });
  assert.equal(r.matched.length, 1);
});

test('e2e: reconcile_spreadsheets writes a themed workbook with fully-accounted CHECKs', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recon-'));
  // A: orders. B: payouts — one exact, one short-paid (fee), one paid 2 days late, one unpaid, one unknown payout.
  fs.writeFileSync(
    path.join(dir, 'orders.csv'),
    'Date,Description,Amount,Reference\n' +
      '2024-01-05,Order Alpha,100.00,ORD-1\n' +
      '2024-01-06,Order Beta,200.00,ORD-2\n' +
      '2024-01-07,Order Gamma,300.00,ORD-3\n' +
      '2024-01-09,Order Delta,400.00,ORD-4\n',
  );
  fs.writeFileSync(
    path.join(dir, 'payouts.csv'),
    'Date,Details,Amount,Reference\n' +
      '2024-01-05,Payout Alpha,100.00,ORD-1\n' +
      '2024-01-06,Payout Beta,194.20,ORD-2\n' +
      '2024-01-09,Payout Gamma,300.00,ORD-3\n' +
      '2024-01-22,Manual adjustment,55.00,ADJ-9\n',
  );
  const ctx: any = { session: { id: 't', orgId: null }, repoDir: dir, mode: 'code', signal: new AbortController().signal, addCost: () => {} };
  const out = await reconcileSpreadsheetsTool.run(
    { inputs: ['orders.csv', 'payouts.csv'], output: 'recon.xlsx', currency: 'AED' },
    ctx,
  );
  assert.match(out, /on reference/, out.slice(0, 300));
  assert.match(out, /Matched: 2/); // ORD-1 exact; ORD-3 same ref+amount (date is not in the ref key)
  assert.match(out, /Amount mismatches: 1/);
  assert.match(out, /Only in orders.csv: 1/);
  assert.match(out, /Only in payouts.csv: 1/);

  const mod: any = await import('exceljs');
  const ExcelJS = mod.default ?? mod;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(dir, 'recon.xlsx'));
  const names = wb.worksheets.map((w: any) => w.name);
  assert.ok(names.includes('Reconciliation') && names.includes('Matched') && names.includes('Mismatched'), String(names));
  const summary = wb.getWorksheet('Reconciliation');
  assert.equal(summary.views?.[0]?.showGridLines, false, 'themed');
  const val = (c: any) => (c && typeof c === 'object' && 'result' in c ? c.result : c);
  const checks: string[] = [];
  summary.eachRow((row: any) => {
    if (/^CHECK/.test(String(row.getCell(1).value))) checks.push(String(val(row.getCell(2).value)));
  });
  assert.deepEqual(checks, ['OK', 'OK'], 'both sides fully accounted');
  // The mismatch sheet carries the delta.
  const mm = wb.getWorksheet('Mismatched');
  assert.equal(Number(val(mm.getRow(2).getCell(6).value)), -5.8);

  // Audit-clean under the deterministic quality gates.
  const XLSX: any = await import('xlsx');
  const { deterministicDeliverableDefects } = await import('../src/agent/deliverableCheck');
  const defects = deterministicDeliverableDefects({ wb: XLSX.read(fs.readFileSync(path.join(dir, 'recon.xlsx')), { type: 'buffer' }) });
  assert.deepEqual(defects, [], defects.join(' | '));
  fs.rmSync(dir, { recursive: true, force: true });
});
