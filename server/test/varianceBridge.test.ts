import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { computeVarianceBridge } from '../src/agent/varianceBridge';
import { analyzeVarianceTool } from '../src/agent/tools/varianceTool';

// ---------------------------------------------------------------------------
// VARIANCE BRIDGE (BI arc): "why did X change" answered deterministically.
// The bridge identity — Σ segment deltas == total delta — is the engine's own
// tie-out and throws when violated.
// ---------------------------------------------------------------------------

test('computeVarianceBridge: deltas decompose exactly, movers ranked, new/gone flagged', () => {
  const prior = [
    { Region: 'EMEA', Channel: 'Web', Revenue: 500 },
    { Region: 'EMEA', Channel: 'Store', Revenue: 300 },
    { Region: 'APAC', Channel: 'Web', Revenue: 400 },
    { Region: 'LATAM', Channel: 'Web', Revenue: 100 }, // disappears
  ];
  const current = [
    { Region: 'EMEA', Channel: 'Web', Revenue: 380 }, // -120
    { Region: 'EMEA', Channel: 'Store', Revenue: 300 }, // flat
    { Region: 'APAC', Channel: 'Web', Revenue: 310 }, // -90
    { Region: 'US', Channel: 'Web', Revenue: 40 }, // NEW
  ];
  const r = computeVarianceBridge(current, prior, 'Revenue', ['Region', 'Channel']);
  assert.equal(r.priorTotal, 1300);
  assert.equal(r.currentTotal, 1030);
  assert.equal(r.delta, -270);
  const region = r.byDimension[0];
  assert.equal(region.movers[0].segment, 'EMEA');
  assert.equal(region.movers[0].delta, -120);
  // Bridge identity: Σ segment deltas == total delta.
  assert.equal(Math.round(region.movers.reduce((n, m) => n + m.delta, 0) * 100) / 100, -270);
  assert.ok(region.movers.find((m) => m.segment === 'US')?.isNew);
  assert.ok(region.movers.find((m) => m.segment === 'LATAM')?.isGone);
  // Commentary: headline + one line per dimension, with shares.
  assert.match(r.commentary[0], /Revenue fell 270/);
  assert.match(r.commentary[1], /By Region: driven by EMEA -120 \(44\.44% of the change\)/);
  // String metrics parse (currency text) and share handles offsetting moves.
  const r2 = computeVarianceBridge(
    [{ S: 'a', M: 'AED 1,100.00' }, { S: 'b', M: '(100.00)' }],
    [{ S: 'a', M: '1,000.00' }, { S: 'b', M: '100.00' }],
    'M',
    ['S'],
  );
  assert.equal(r2.delta, -100);
  assert.equal(r2.byDimension[0].movers.find((m) => m.segment === 'b')?.delta, -200);
});

test('e2e two-file mode: actuals vs budget → bridge workbook, OK tie, audit-clean', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'var-'));
  fs.writeFileSync(
    path.join(dir, 'budget.csv'),
    'Region,Channel,Revenue\nEMEA,Web,500\nEMEA,Store,300\nAPAC,Web,400\n',
  );
  fs.writeFileSync(
    path.join(dir, 'actuals.csv'),
    'Region,Channel,Revenue\nEMEA,Web,380\nEMEA,Store,310\nAPAC,Web,350\n',
  );
  const ctx: any = { session: { id: 't', orgId: null }, repoDir: dir, mode: 'code', signal: new AbortController().signal, addCost: () => {} };
  const out = await analyzeVarianceTool.run(
    { current: 'actuals.csv', prior: 'budget.csv', metric: 'Revenue', dimensions: ['Region', 'Channel'], output: 'vb.xlsx', currency: 'AED' },
    ctx,
  );
  assert.match(out, /Revenue fell 160/, out.slice(0, 300));
  assert.match(out, /By Region/);
  assert.match(out, /CHECK reads OK/);

  const mod: any = await import('exceljs');
  const ExcelJS = mod.default ?? mod;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(dir, 'vb.xlsx'));
  const names = wb.worksheets.map((w: any) => w.name);
  assert.ok(names.includes('Variance Bridge') && names.includes('Movers — Region') && names.includes('Movers — Channel'), String(names));
  const val = (c: any) => (c && typeof c === 'object' && 'result' in c ? c.result : c);
  const bridge = wb.getWorksheet('Variance Bridge');
  assert.equal(bridge.views?.[0]?.showGridLines, false, 'themed');
  let check = '';
  let currentTotal = 0;
  bridge.eachRow((row: any) => {
    const label = String(row.getCell(1).value);
    if (/^CHECK/.test(label)) check = String(val(row.getCell(2).value));
    if (/^Current total/.test(label)) currentTotal = Number(val(row.getCell(2).value));
  });
  assert.equal(check, 'OK');
  assert.equal(currentTotal, 1040);

  const XLSX: any = await import('xlsx');
  const { deterministicDeliverableDefects } = await import('../src/agent/deliverableCheck');
  const defects = deterministicDeliverableDefects({ wb: XLSX.read(fs.readFileSync(path.join(dir, 'vb.xlsx')), { type: 'buffer' }) });
  assert.deepEqual(defects, [], defects.join(' | '));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('e2e period mode: one file split by month prefix', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'varp-'));
  fs.writeFileSync(
    path.join(dir, 'sales.csv'),
    'Date,Region,Amount\n' +
      '2024-01-05,EMEA,500\n2024-01-12,APAC,400\n' +
      '2024-02-03,EMEA,450\n2024-02-15,APAC,380\n',
  );
  const ctx: any = { session: { id: 't', orgId: null }, repoDir: dir, mode: 'code', signal: new AbortController().signal, addCost: () => {} };
  const out = await analyzeVarianceTool.run(
    { current: 'sales.csv', metric: 'Amount', dimensions: ['Region'], period_column: 'Date', current_period: '2024-02', prior_period: '2024-01', output: 'vp.xlsx' },
    ctx,
  );
  assert.match(out, /Amount fell 70/, out.slice(0, 300));
  assert.match(out, /EMEA -50/);
  assert.match(out, /APAC -20/);
  // Honest failure when the filter matches nothing.
  const bad = await analyzeVarianceTool.run(
    { current: 'sales.csv', metric: 'Amount', dimensions: ['Region'], period_column: 'Date', current_period: '2027-09', prior_period: '2024-01' },
    ctx,
  );
  assert.match(bad, /matched 0 current/);
  assert.match(bad, /sample period values/);
  fs.rmSync(dir, { recursive: true, force: true });
});
