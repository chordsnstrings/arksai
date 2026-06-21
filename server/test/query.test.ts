import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as XLSX from 'xlsx';
import type { ToolCtx } from '../src/agent/tools/common';
import { sanitizeTableName, tableNamesFor, buildQueryScript, querySpreadsheetTool } from '../src/agent/tools/query';

test('sanitizeTableName: snake-cases, dedups, fixes leading digits', () => {
  const used = new Set<string>();
  assert.equal(sanitizeTableName('P&L 2024', used), 'p_l_2024');
  assert.equal(sanitizeTableName('Orders!!', used), 'orders');
  assert.equal(sanitizeTableName('Orders', used), 'orders_2'); // dedup
  assert.equal(sanitizeTableName('2023 Actuals', used), 't_2023_actuals'); // leading digit
  assert.equal(sanitizeTableName('   ', used), 'sheet'); // empty → fallback
});

test('tableNamesFor maps every sheet, stable + deduped', () => {
  const map = tableNamesFor(['Customers', 'Orders 2024', 'Orders 2024', 'P&L']);
  assert.deepEqual(map.map((m) => m.table), ['customers', 'orders_2024', 'orders_2024_2', 'p_l']);
});

test('buildQueryScript is self-contained Python (loads tabs into DuckDB, prints only results)', () => {
  const s = buildQueryScript();
  assert.match(s, /import pandas/);
  assert.match(s, /import duckdb/);
  assert.match(s, /read_excel\(path, sheet_name=None\)/); // ALL tabs at once
  assert.match(s, /con\.register/); // each tab → a table
  assert.match(s, /MISSING_DEPS/); // degrades cleanly when deps absent
});

const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-q-'));
const ctx = (): ToolCtx => ({ session: { id: 'q' } as any, repoDir: ws, mode: 'code', signal: new AbortController().signal, addCost: () => {} });

function makeBiz(file: string) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['id', 'city'], [1, 'Dubai'], [2, 'Abu Dhabi'], [3, 'Dubai']]), 'Customers');
  const orders: any[][] = [['order_id', 'cust_id', 'amount']];
  for (let i = 1; i <= 60; i++) orders.push([i, (i % 3) + 1, 100 + i]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(orders), 'Orders 2024');
  XLSX.writeFile(wb, path.join(ws, file));
}

test('query_spreadsheet errors cleanly on a missing file', async () => {
  assert.match(await querySpreadsheetTool.run({ path: 'nope.xlsx', sql: 'SELECT 1' }, ctx()), /no file/i);
});

test('query_spreadsheet runs a cross-tab JOIN (or degrades if duckdb absent)', async () => {
  makeBiz('biz.xlsx');
  const out = await querySpreadsheetTool.run(
    { path: 'biz.xlsx', sql: 'SELECT c.city, SUM(o.amount) rev FROM orders_2024 o JOIN customers c ON o.cust_id=c.id GROUP BY 1 ORDER BY rev DESC' },
    ctx(),
  );
  // Always advertises the table map.
  assert.match(out, /customers/);
  assert.match(out, /orders_2024/);
  if (out.includes('MISSING_DEPS')) return; // no pandas/duckdb in this env → acceptable degrade
  assert.match(out, /RESULT: 2 row/);
  assert.match(out, /Dubai/);
  assert.match(out, /Abu Dhabi/);
});

test('query_spreadsheet with empty sql lists the queryable tables', async () => {
  makeBiz('biz2.xlsx');
  const out = await querySpreadsheetTool.run({ path: 'biz2.xlsx', sql: '' }, ctx());
  assert.match(out, /TABLES/);
  assert.match(out, /orders_2024/);
});

test('query_spreadsheet is available in every mode', () => {
  for (const m of ['chat', 'plan', 'code', 'report'] as const) assert.ok(querySpreadsheetTool.modes.includes(m));
});
