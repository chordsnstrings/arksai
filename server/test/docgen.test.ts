import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ToolCtx } from '../src/agent/tools/common';
import { generateSpreadsheetTool } from '../src/agent/tools/excel';
import { generateDocTool } from '../src/agent/tools/docx';
import { auditFormulaModel } from '../src/agent/deliverableCheck';

const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-docgen-'));
const ctx = (): ToolCtx => ({
  session: { id: 's1' } as any,
  repoDir: ws,
  mode: 'code',
  signal: new AbortController().signal,
  addCost: () => {},
});

test('generate_spreadsheet writes a styled, validated xlsx', async () => {
  const res = await generateSpreadsheetTool.run(
    {
      output: 'sales.xlsx',
      accent: '#4f46e5',
      sheets: [
        {
          name: 'Q1',
          columns: [
            { header: 'Product', key: 'product', type: 'text' },
            { header: 'Revenue', key: 'revenue', type: 'currency' },
            { header: 'Growth', key: 'growth', type: 'percent' },
          ],
          rows: [
            { product: 'Widget', revenue: 12000, growth: 0.12 },
            { product: 'Gadget', revenue: 8400, growth: 0.34 },
          ],
        },
      ],
    },
    ctx(),
  );
  assert.match(res, /Generated sales\.xlsx/);
  assert.doesNotMatch(res, /^Error/);
  const file = path.join(ws, 'sales.xlsx');
  assert.ok(fs.existsSync(file));

  // Re-open and confirm the data + header landed.
  const XLSX: any = await import('xlsx');
  const wb = XLSX.read(fs.readFileSync(file), { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['Q1'], { header: 1 });
  assert.deepEqual(rows[0], ['Product', 'Revenue', 'Growth']);
  assert.equal(rows.length, 3); // header + 2 data rows
});

test('generate_spreadsheet rejects empty spec', async () => {
  const res = await generateSpreadsheetTool.run({ sheets: [] }, ctx());
  assert.match(res, /^Error/);
});

async function readWb(file: string): Promise<any> {
  const XLSX: any = await import('xlsx');
  return XLSX.read(fs.readFileSync(file), { type: 'buffer' });
}

test('auditFormulaModel: a formula-driven model is NOT flagged', async () => {
  await generateSpreadsheetTool.run(
    {
      output: 'model_good.xlsx',
      sheets: [
        { name: 'Assumptions', columns: [{ header: 'Driver' }, { header: 'Value', type: 'number' }], rows: [['Growth', 0.1], ['Start', 1000]] },
        {
          name: 'Cash Flow',
          columns: [{ header: 'Month' }, { header: 'Revenue', type: 'currency' }],
          rows: [
            ['M1', { f: 'Assumptions!B3', v: 1000 }],
            ['M2', { f: 'B2*(1+Assumptions!B2)', v: 1100 }],
            ['Total', { f: 'SUM(B2:B3)', v: 2100 }],
          ],
        },
      ],
    },
    ctx(),
  );
  const r = auditFormulaModel(await readWb(path.join(ws, 'model_good.xlsx')));
  assert.equal(r.isModel, false, r.reason);
});

test('auditFormulaModel: a hard-coded model (Total row, 0 formulas) IS flagged', async () => {
  await generateSpreadsheetTool.run(
    {
      output: 'model_bad.xlsx',
      sheets: [
        { name: 'Assumptions', columns: [{ header: 'Driver' }, { header: 'Value', type: 'number' }], rows: [['Growth', 0.1], ['Start', 1000]] },
        {
          name: 'Cash Flow',
          columns: [{ header: 'Month' }, { header: 'Revenue', type: 'currency' }],
          rows: [['M1', 1000], ['M2', 1100], ['M3', 1210], ['Total', 3310]],
        },
      ],
    },
    ctx(),
  );
  const r = auditFormulaModel(await readWb(path.join(ws, 'model_bad.xlsx')));
  assert.equal(r.isModel, true, r.reason);
});

test('auditFormulaModel: a plain data table is NOT flagged', async () => {
  await generateSpreadsheetTool.run(
    {
      output: 'plain.xlsx',
      sheets: [
        {
          name: 'Contacts',
          columns: [{ header: 'Name' }, { header: 'Email' }, { header: 'Age', type: 'number' }],
          rows: [['Ada', 'ada@x.com', 36], ['Alan', 'alan@x.com', 41]],
        },
      ],
    },
    ctx(),
  );
  const r = auditFormulaModel(await readWb(path.join(ws, 'plain.xlsx')));
  assert.equal(r.isModel, false, r.reason);
});

test('generate_doc writes a valid docx (zip/OOXML)', async () => {
  const res = await generateDocTool.run(
    {
      output: 'brief.docx',
      title: 'Quarterly Brief',
      subtitle: 'Internal — Q1',
      accent: '#4f46e5',
      blocks: [
        { type: 'heading', text: 'Summary' },
        { type: 'paragraph', text: 'Things went well this quarter.' },
        { type: 'bullets', items: ['Revenue up', 'Churn down'] },
        { type: 'table', header: ['Metric', 'Value'], rows: [['MRR', '$42k'], ['NPS', '61']] },
      ],
    },
    ctx(),
  );
  assert.match(res, /Generated brief\.docx/);
  const file = path.join(ws, 'brief.docx');
  assert.ok(fs.existsSync(file));
  const buf = fs.readFileSync(file);
  // OOXML docx is a zip — starts with "PK".
  assert.equal(buf[0], 0x50);
  assert.equal(buf[1], 0x4b);
  assert.ok(buf.length > 1000);
});
