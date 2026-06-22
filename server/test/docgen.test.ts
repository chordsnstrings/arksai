import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ToolCtx } from '../src/agent/tools/common';
import { generateSpreadsheetTool, coerceNumeric } from '../src/agent/tools/excel';
import { generateDocTool } from '../src/agent/tools/docx';
import { generatePptxTool } from '../src/agent/tools/pptx';
import { iconSvg, hasIcon, ICON_NAMES } from '../src/agent/tools/icons';
import { auditFormulaModel, detectEmptyPages, detectUnderfilledPages, detectBannerRows, detectSectionRows, auditNumericSanity, STRINGY_REF_RE } from '../src/agent/deliverableCheck';

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

test('a bare cross-sheet reference (missing "=") is healed into a live formula', async () => {
  // The KKLM-breakeven bug: a cell held "Assumptions!$B$10" as TEXT, so dependent rows
  // broke with #VALUE!. The tool must coerce it to a real formula so the link is live.
  const res = await generateSpreadsheetTool.run(
    {
      output: 'model.xlsx',
      sheets: [
        { name: 'Assumptions', columns: [{ header: 'Item' }, { header: 'Value' }], rows: [['kWh/car', '=75*365']] },
        {
          name: 'Breakeven',
          columns: [{ header: 'Item' }, { header: 'Y1' }],
          rows: [
            ['Annual Energy per Car (kWh)', 'Assumptions!$B$2'], // bare ref as text — the bug
            ['Fleet energy', '=46*B2'], // depends on the cell above
          ],
        },
      ],
    },
    ctx(),
  );
  assert.doesNotMatch(res, /^Error/);
  const XLSX: any = await import('xlsx');
  const wb = XLSX.read(fs.readFileSync(path.join(ws, 'model.xlsx')), { type: 'buffer', cellFormula: true });
  const bk = wb.Sheets['Breakeven'];
  assert.ok(bk['B2']?.f, 'the bare cross-sheet ref became a formula'); // not inert text
  assert.match(bk['B2'].f, /Assumptions!\$?B\$?2/);
  assert.equal(bk['B2'].v, 27375); // and recalculated to the right number
  assert.equal(bk['B3'].v, 1259250); // the dependent cell now resolves through the live link
});

test('auditFormulaModel flags a cross-sheet ref stored as text', () => {
  // regex: matches references, not labels
  assert.ok(STRINGY_REF_RE.test('Assumptions!$B$10'));
  assert.ok(STRINGY_REF_RE.test("'Cash Flow'!B12"));
  assert.ok(STRINGY_REF_RE.test('Sheet1!A1:B5'));
  assert.ok(!STRINGY_REF_RE.test('Annual Energy per Car (kWh)'));
  assert.ok(!STRINGY_REF_RE.test('see the Assumptions tab'));
  // a workbook with the broken text cell is flagged as a (broken) model
  const wb = {
    SheetNames: ['Assumptions', 'Breakeven'],
    Sheets: {
      Assumptions: { '!ref': 'A1:B2', A1: { t: 's', v: 'Item' }, B2: { t: 'n', v: 27375, f: '75*365' } },
      Breakeven: { '!ref': 'A1:B1', A1: { t: 's', v: 'Energy' }, B1: { t: 's', v: 'Assumptions!$B$2' } },
    },
  };
  const a = auditFormulaModel(wb);
  assert.equal(a.isModel, true);
  assert.match(a.reason, /stored as TEXT|cross-sheet/i);
});

test('coerceNumeric: number-as-text becomes a real number (so SUM works), text/IDs left alone', () => {
  // formatted numbers → coerced (the dashboard-totals-read-0 bug)
  assert.equal(coerceNumeric('480,000.'), 480000);
  assert.equal(coerceNumeric('$15,000'), 15000);
  assert.equal(coerceNumeric('1,580,000.'), 1580000);
  assert.equal(coerceNumeric('49.6'), 49.6);
  assert.equal(coerceNumeric('$48,713'), 48713);
  // left as text: bare integers (possible IDs/zips), labels, dates, real numbers, formulas
  assert.equal(coerceNumeric('12345'), '12345');
  assert.equal(coerceNumeric('GlobalFin'), 'GlobalFin');
  assert.equal(coerceNumeric('2026-06-01'), '2026-06-01');
  assert.equal(coerceNumeric(42), 42);
});

test('xlsx: a number written as text is stored numeric so a SUM over it is non-zero', async () => {
  await generateSpreadsheetTool.run(
    {
      output: 'sumcheck.xlsx',
      sheets: [
        {
          name: 'S',
          columns: [{ header: 'Rev', key: 'rev', type: 'currency' }],
          rows: [{ rev: '480,000.' }, { rev: '$120,000' }, { rev: '=SUM(A2:A3)' }],
        },
      ],
    },
    ctx(),
  );
  const XLSX: any = await import('xlsx');
  const wb = XLSX.read(fs.readFileSync(path.join(ws, 'sumcheck.xlsx')), { type: 'buffer' });
  const cell = wb.Sheets['S']['A2'];
  assert.equal(cell.t, 'n', 'a "480,000." text value must be stored as a numeric cell'); // not 's' (text)
  assert.equal(cell.v, 480000);
});

test('generate_doc: literal <b>/<strong> markup renders as bold, NOT as visible tags', async () => {
  const res = await generateDocTool.run(
    {
      output: 'btags.docx',
      title: 'Bold test',
      blocks: [{ type: 'paragraph', text: 'Merge conflicts cost <b>$6.9 million annually</b> and **87%** of teams hit them.' }],
    },
    ctx(),
  );
  assert.doesNotMatch(res, /^Error/);
  const mammoth: any = await import('mammoth');
  const { value: textOut } = await mammoth.extractRawText({ path: path.join(ws, 'btags.docx') });
  assert.ok(!/<b>|<\/b>|<strong>/.test(textOut), 'no literal HTML tags in the rendered docx text');
  assert.ok(!/\*\*/.test(textOut), 'no literal ** markdown in the rendered docx text');
  assert.match(textOut, /\$6\.9 million annually/);
  assert.match(textOut, /87%/);
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

test('auditFormulaModel: a derived row typed in as literals (model uses formulas elsewhere) IS flagged', async () => {
  await generateSpreadsheetTool.run(
    {
      output: 'model_partial.xlsx',
      sheets: [
        { name: 'Assumptions', columns: [{ header: 'Driver' }, { header: 'Value', type: 'number' }], rows: [['Growth', 0.1]] },
        {
          name: 'P&L',
          columns: [{ header: 'Line' }, { header: 'Q1', type: 'number' }, { header: 'Q2', type: 'number' }],
          rows: [
            ['Revenue', { f: 'Assumptions!B2*1000', v: 100 }, { f: "B2*(1+Assumptions!B2)", v: 110 }],
            ['Margin', 0.2, 0.21], // derived row typed in as literals (≥2, no formulas)
          ],
        },
      ],
    },
    ctx(),
  );
  const r = auditFormulaModel(await readWb(path.join(ws, 'model_partial.xlsx')));
  assert.equal(r.isModel, true, r.reason);
});

test('auditFormulaModel: multi-value literal driver rows on the Assumptions sheet are NOT flagged', async () => {
  await generateSpreadsheetTool.run(
    {
      output: 'model_inputs.xlsx',
      sheets: [
        {
          name: 'Assumptions',
          columns: [{ header: 'Driver' }, { header: 'Y1', type: 'number' }, { header: 'Y2', type: 'number' }],
          rows: [['Growth', 0.1, 0.12]], // legitimate hard-coded INPUTS, not a computed row
        },
        {
          name: 'Plan',
          columns: [{ header: 'Line' }, { header: 'Y1', type: 'number' }, { header: 'Y2', type: 'number' }],
          rows: [['Revenue', { f: 'Assumptions!B2', v: 0.1 }, { f: 'Assumptions!C2', v: 0.12 }]],
        },
      ],
    },
    ctx(),
  );
  const r = auditFormulaModel(await readWb(path.join(ws, 'model_inputs.xlsx')));
  assert.equal(r.isModel, false, r.reason);
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

test('detectEmptyPages flags a lonely interior page but never the cover', () => {
  // cover can be light (p1) but p3 is near-empty → only p3 is flagged.
  const defects = detectEmptyPages([0.004, 0.08, 0.003, 0.06]);
  assert.equal(defects.length, 1);
  assert.match(defects[0], /^p3:/);
});

test('detectEmptyPages passes a well-filled document', () => {
  assert.deepEqual(detectEmptyPages([0.05, 0.07, 0.06]), []);
});

test('detectUnderfilledPages flags an interior page whose content ends high', () => {
  // The real GIC-coffee bug: p1=cover, p2=87%, p3=92%, p4=27% (stranded), p5=93%, p6=last.
  const defects = detectUnderfilledPages([1.0, 0.87, 0.92, 0.27, 0.93, 0.85]);
  assert.equal(defects.length, 1);
  assert.match(defects[0], /^p4:/);
  assert.match(defects[0], /27%/);
});

test('detectUnderfilledPages exempts the cover and the final page, passes full pages', () => {
  // cover light + final page ends partway down are both legitimate → no flags.
  assert.deepEqual(detectUnderfilledPages([0.3, 0.9, 0.95, 0.35]), []);
  assert.deepEqual(detectUnderfilledPages([1.0, 0.85, 0.9, 0.88]), []);
  // a blank (near-empty) page is left to detectEmptyPages, not double-flagged here.
  assert.deepEqual(detectUnderfilledPages([1.0, 0.02, 0.9]), []);
});

test('detectBannerRows flags a box-drawing banner row but not clean data', async () => {
  const XLSX: any = await import('xlsx');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([['── CASH FLOW (AED) ──────────', '', ''], ['Line', 'Jan', 'Feb'], ['Revenue', 100, 110]]),
    'Cash Flow',
  );
  const hits = detectBannerRows(wb);
  assert.equal(hits.length, 1);
  assert.match(hits[0], /Cash Flow/);
  assert.match(hits[0], /banner\/separator/);

  // clean sheet → no false positive
  const clean = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(clean, XLSX.utils.aoa_to_sheet([['Item', 'Jan'], ['Revenue', 100], ['COGS', 28]]), 'S');
  assert.deepEqual(detectBannerRows(clean), []);
  assert.deepEqual(detectBannerRows(null), []);
});

test('detectSectionRows flags plain-text/dash divider rows that shift references', async () => {
  const XLSX: any = await import('xlsx');
  const wb = XLSX.utils.book_new();
  // an interior ALL-CAPS divider + an em-dash divider, with real data around them
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ['Item', 'M1', 'M2'],
      ['Walk-in revenue', 58500, 58500],
      ['REVENUE DRIVERS', '', ''], // ALL-CAPS divider
      ['B2B revenue', 6000, 6000],
      ['—— COST OF GOODS SOLD ——', '', ''], // em-dash divider
      ['COGS', 16000, 16000],
    ]),
    'PnL',
  );
  const hits = detectSectionRows(wb);
  assert.equal(hits.length, 1);
  assert.match(hits[0], /PnL/);
  assert.match(hits[0], /section\/divider row/);

  // clean sheet (header + data only) → no false positive
  const clean = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(clean, XLSX.utils.aoa_to_sheet([['Item', 'M1'], ['Rent', 2775], ['Total', 2775]]), 'S');
  assert.deepEqual(detectSectionRows(clean), []);
  assert.deepEqual(detectSectionRows(null), []);
});

test('auditNumericSanity flags impossible numbers, not legitimate ones', async () => {
  const XLSX: any = await import('xlsx');
  const wb = XLSX.utils.book_new();
  // A money column (mostly thousands) with: a 140M outlier, a 0.30 rate-leak, and a Total row = 0
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([
      ['Line', 'M1', 'M2', 'M3', 'M4'],
      ['Rent', 2775, 2775, 2775, 2775],
      ['POS fee', 140400000, 1460, 1460, 1460], // absurd outlier
      ['B2B revenue', 0.3, 0.3, 0.3, 0.3], // rate leaked into a money column
      ['Marketing', 8000, 8000, 8000, 8000],
      ['Total occupancy', 0, 0, 0, 0], // derived row computing to 0
    ]),
    'OPEX',
  );
  const hits = auditNumericSanity(wb);
  assert.equal(hits.length, 1);
  assert.match(hits[0], /140,400,000|absurd/);
  assert.match(hits[0], /under 1|rate/);
  assert.match(hits[0], /Total occupancy|0/);

  // An assumptions sheet with legit rates + mixed scales → never flagged
  const asum = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(asum, XLSX.utils.aoa_to_sheet([['Driver', 'Value'], ['Rent', 185], ['Growth', 0.004], ['COGS %', 0.28]]), 'Assumptions');
  assert.deepEqual(auditNumericSanity(asum), []);
  // a clean money sheet → no false positive
  const clean = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(clean, XLSX.utils.aoa_to_sheet([['Line', 'M1', 'M2', 'M3', 'M4'], ['Rent', 2775, 2775, 2775, 2775], ['Staff', 18000, 18100, 18200, 18300]]), 'S');
  assert.deepEqual(auditNumericSanity(clean), []);
  assert.deepEqual(auditNumericSanity(null), []);
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

test('generate_doc: a designed cover + a chart block produce a valid docx', async () => {
  const res = await generateDocTool.run(
    {
      output: 'report.docx',
      accent: '#c8962a',
      cover: {
        masthead: 'ACME · INTELLIGENCE',
        title: 'Market Brief',
        accentLine: '2026 Outlook',
        thesis: 'Demand is shifting from X to Y.',
        kpis: [{ value: '73,091', label: 'Leads' }, { value: '7.3%', label: 'Conversion' }],
        meta: { coverage: '2024–2026', source: 'CRM', preparedBy: 'BI', date: 'Jun 2026' },
        confidential: true,
      },
      blocks: [
        { type: 'heading', text: 'Trend' },
        { type: 'chart', chart: { type: 'line', data: [{ x: 'Jan', y: 10 }, { x: 'Feb', y: 14 }, { x: 'Mar', y: 12 }], x: 'x', y: 'y' }, caption: 'Monthly volume' },
        { type: 'paragraph', text: 'Volume rose then dipped.' },
      ],
    },
    ctx(),
  );
  assert.match(res, /Generated report\.docx/);
  const buf = fs.readFileSync(path.join(ws, 'report.docx'));
  assert.equal(buf[0], 0x50); // PK zip (valid even if the chart image was skipped without Chromium)
  assert.equal(buf[1], 0x4b);
  assert.ok(buf.length > 1000);
});

test('generate_pptx: a designed cover + a render_chart slide produce a valid deck', async () => {
  const res = await generatePptxTool.run(
    {
      output: 'deck.pptx',
      title: 'Q2 Review',
      accent: '#c8962a',
      slides: [
        {
          layout: 'title',
          masthead: 'ACME · BI',
          kicker: 'Quarterly',
          title: 'Q2 Review',
          accentTitle: 'The fuel line',
          thesis: 'Conversion holds; volume fell.',
          kpis: [{ value: '73k', label: 'Leads' }, { value: '7.3%', label: 'Conversion' }],
          meta: { coverage: '2024–2026', preparedBy: 'BI' },
          confidential: true,
          theme: 'dark',
        },
        { layout: 'chart', title: 'Volume vs rate', chart: { type: 'dual_axis', data: [{ m: 'Jan', v: 100, r: 3 }, { m: 'Feb', v: 120, r: 3.2 }], x: 'm', y: 'v', y2: 'r' } },
        { layout: 'bullets', title: 'Moves', bullets: ['Reopen dormant leads', 'Double down on referrals'] },
      ],
    },
    ctx(),
  );
  assert.match(res, /Generated deck\.pptx/);
  const buf = fs.readFileSync(path.join(ws, 'deck.pptx'));
  const JSZip: any = (await import('jszip')).default ?? (await import('jszip'));
  const zip = await JSZip.loadAsync(buf);
  const slideCount = Object.keys(zip.files).filter((n: string) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).length;
  assert.equal(slideCount, 3);
  // the designed cover composed its KPI band + masthead text into slide 1
  const s1 = await zip.file('ppt/slides/slide1.xml')!.async('string');
  assert.match(s1, /CONFIDENTIAL/); // cover metadata marker
  assert.match(s1, /73k/); // a KPI-band figure landed on the cover
});

test('iconSvg renders a recolourable line icon and falls back gracefully', () => {
  assert.ok(ICON_NAMES.length >= 16);
  const s = iconSvg('trending-up', '#c8962a', 40, 2);
  assert.match(s, /^<svg/);
  assert.match(s, /<\/svg>$/);
  assert.match(s, /stroke="#c8962a"/);
  assert.match(s, /width="40"/);
  assert.ok(hasIcon('target'));
  assert.equal(hasIcon('not-an-icon'), false);
  // an unknown name still yields a valid svg (circle fallback)
  assert.match(iconSvg('nope'), /<svg[\s\S]*<\/svg>/);
  // a bare hex (no #) is normalised
  assert.match(iconSvg('users', 'ff0000'), /stroke="#ff0000"/);
});
