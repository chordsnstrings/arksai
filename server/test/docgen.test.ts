import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ToolCtx } from '../src/agent/tools/common';
import { generateSpreadsheetTool } from '../src/agent/tools/excel';
import { generateDocTool } from '../src/agent/tools/docx';

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
