import fs from 'node:fs';
import path from 'node:path';
import { resolveInWorkspace, ToolError, type ToolDef } from './common';
import { buildSheet, toArgb, currencyNumFmt } from './excel';
import { type GridSource, profileSource, splitTables } from '../sheetCombine';
import { autoKeys, reconcileRecords, sideRecords, type MatchKey, type RecRecord } from '../sheetReconcile';

/** Load ONE side: first non-empty tab (or "file.xlsx!Tab"). Shared with analyze_variance. */
export async function loadSide(repoDir: string, spec: string): Promise<GridSource> {
  const XLSX: any = await import('xlsx');
  let file = String(spec).trim();
  let onlyTab: string | null = null;
  const bang = file.lastIndexOf('!');
  if (bang > 0) {
    const candidate = file.slice(0, bang);
    try {
      if (!fs.existsSync(resolveInWorkspace(repoDir, file)) && fs.existsSync(resolveInWorkspace(repoDir, candidate))) {
        onlyTab = file.slice(bang + 1);
        file = candidate;
      }
    } catch {
      /* resolve below */
    }
  }
  const abs = resolveInWorkspace(repoDir, file);
  if (!fs.existsSync(abs)) throw new ToolError(`no file at "${file}"`);
  const wb = XLSX.read(fs.readFileSync(abs), { type: 'buffer', cellDates: true });
  const tabs: string[] = onlyTab ? [onlyTab] : wb.SheetNames;
  if (onlyTab && !wb.Sheets[onlyTab]) throw new ToolError(`"${file}" has no tab "${onlyTab}" — tabs: ${wb.SheetNames.join(', ')}`);
  for (const tab of tabs) {
    const ws = wb.Sheets[tab];
    if (!ws) continue;
    let grid: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true });
    if (!grid.some((r) => (r ?? []).some((c: any) => c !== null && c !== undefined && String(c).trim() !== ''))) continue;
    const tables = splitTables(grid);
    if (tables.length > 1) grid = tables[0].rows;
    return { file, tab: wb.SheetNames.length > 1 || onlyTab ? tab : '', grid };
  }
  throw new ToolError(`"${file}" has no non-empty sheet`);
}

const sum = (rs: RecRecord[]): number => Math.round(rs.reduce((n, r) => n + (r.amount ?? 0), 0) * 100) / 100;

export const reconcileSpreadsheetsTool: ToolDef = {
  name: 'reconcile_spreadsheets',
  description:
    'RECONCILE two spreadsheets (xlsx/xls/csv) — match their rows and isolate every discrepancy. The tool for ' +
    '"match payouts against orders", "tie the export to the GL", "which invoices are unpaid", "what differs between these ' +
    'two lists". Fully deterministic: each side goes through the same cleaning as combine_spreadsheets (real header ' +
    'detection, date/amount normalisation, footer/empty-row cleaning), then rows are matched 1:1 — first EXACT on the ' +
    'match keys (an 80%-populated unique Reference column wins automatically; else date+amount(+normalised entity name — ' +
    '"Acme, Inc." equals "ACME INC")), then same-identity-different-AMOUNT rows become MISMATCHES with a delta (the classic ' +
    'fee/partial-payment gap), then a fuzzy pass pairs same-amount rows within ±3 days as PROBABLE. Every input row lands ' +
    'in exactly one bucket — Matched, Mismatched, Probable, Only-in-A, Only-in-B — and the themed output workbook shows ' +
    'them all plus a Reconciliation summary whose CHECK cells prove both sides are fully accounted. ' +
    'NEVER pre-read the files or hand-write matching scripts — one call with the two paths is the whole job. ' +
    'Optional: match_on to force keys (["reference"] or ["date","amount","description"]), date_tolerance_days (default 3, 0 disables fuzzy).',
  parameters: {
    type: 'object',
    properties: {
      inputs: { type: 'array', items: { type: 'string' }, description: 'EXACTLY TWO paths, e.g. ["uploads/payouts.csv","uploads/orders.xlsx"]. "!Tab" pins a tab.' },
      match_on: {
        type: 'array',
        items: { type: 'string', enum: ['reference', 'date', 'amount', 'description'] },
        description: 'Force the match keys. Omit to auto-pick (unique Reference, else date+amount+entity).',
      },
      date_tolerance_days: { type: 'number', description: 'Fuzzy pass window in days (default 3; 0 disables).' },
      output: { type: 'string', description: 'Output filename. Default reconciliation.xlsx.' },
      currency: { type: 'string', description: 'Currency for amounts ("AED", "$"). Neutral otherwise.' },
      accent: { type: 'string', description: 'Brand accent hex for the theme.' },
    },
    required: ['inputs'],
  },
  modes: ['chat', 'code', 'report'],
  badJsonHint: 'call again with just inputs:[two paths] — match keys are auto-picked; never inline row data.',
  summarize: (a) => `reconcile ${Array.isArray(a.inputs) ? a.inputs.join(' vs ') : ''}`.slice(0, 80),
  async run(args, ctx) {
    const inputs = Array.isArray(args.inputs) ? args.inputs.map(String) : [];
    if (inputs.length !== 2) return 'Error: pass inputs: [fileA, fileB] — exactly two spreadsheets to reconcile.';
    let A: GridSource;
    let B: GridSource;
    try {
      A = await loadSide(ctx.repoDir, inputs[0]);
      B = await loadSide(ctx.repoDir, inputs[1]);
    } catch (e: any) {
      return `Error: ${e instanceof ToolError ? e.message : (e?.message ?? e)}`;
    }
    const pa = profileSource(A);
    const pb = profileSource(B);
    const sa = sideRecords(A, pa);
    const sb = sideRecords(B, pb);
    for (const [side, plan, p] of [
      ['A', sa.plan, pa],
      ['B', sb.plan, pb],
    ] as const) {
      const hasAmount = plan.fields.some((f) => f.kind === 'amount');
      const hasRef = plan.fields.some((f) => f.name === 'Reference');
      if (!hasAmount && !hasRef)
        return (
          `Error: side ${side} ("${p.key}") has no recognisable amount or reference column — columns: ` +
          `${p.columns.map((c) => `${c.header}(${c.type})`).join(', ')}. Rename/confirm the headers or pass match_on.`
        );
    }
    const aRecs = sa.records;
    const bRecs = sb.records;
    const keys: MatchKey[] =
      Array.isArray(args.match_on) && args.match_on.length
        ? (args.match_on.map(String) as MatchKey[])
        : autoKeys(aRecs, bRecs);
    let rec;
    try {
      rec = reconcileRecords(aRecs, bRecs, { keys, dateToleranceDays: args.date_tolerance_days ?? 3 });
    } catch (e: any) {
      return `Error: ${e?.message ?? e}`;
    }

    // ---- themed output workbook ----
    const outName = String(args.output || 'reconciliation.xlsx').replace(/[^a-zA-Z0-9._-]/g, '-');
    const finalName = outName.toLowerCase().endsWith('.xlsx') ? outName : `${outName}.xlsx`;
    let absOut: string;
    try {
      absOut = resolveInWorkspace(ctx.repoDir, finalName);
    } catch (e: any) {
      return `Error: ${e?.message ?? e}`;
    }
    const currencyFmt = args.currency ? currencyNumFmt(String(args.currency)) : '#,##0.00';
    const accentArgb = toArgb(args.accent, 'FF1F5F8B');
    const la = path.basename(A.file);
    const lb = path.basename(B.file);
    const f = (formula: string, v: number | string) => ({ f: formula, v });

    const summarySheet = {
      name: 'Reconciliation',
      columns: [
        { header: 'Line', type: 'text' },
        { header: 'Rows', numFmt: '0', type: 'number' },
        { header: 'Amount', numFmt: currencyFmt, type: 'number' },
      ],
      rows: [
        [`Rows in ${la} (cleaned)`, aRecs.length, sum(aRecs)],
        [`Rows in ${lb} (cleaned)`, bRecs.length, sum(bRecs)],
        ['Matched pairs', rec.matched.length, sum(rec.matched.map((m) => m.a))],
        ['Amount mismatches (net delta)', rec.mismatched.length, Math.round(rec.mismatched.reduce((n, m) => n + m.delta, 0) * 100) / 100],
        ['Probable matches (review)', rec.probable.length, sum(rec.probable.map((m) => m.a))],
        [`Only in ${la}`, rec.onlyA.length, sum(rec.onlyA)],
        [`Only in ${lb}`, rec.onlyB.length, sum(rec.onlyB)],
        [`CHECK ${la} fully accounted`, f('IF(B4+B5+B6+B7=B2,"OK","MISMATCH")', 'OK'), null],
        [`CHECK ${lb} fully accounted`, f('IF(B4+B5+B6+B8=B3,"OK","MISMATCH")', 'OK'), null],
      ],
      __pattern: true,
    };
    const pairCols = [
      { header: 'Date', type: 'text' },
      { header: 'Description', type: 'text' },
      { header: 'Reference', type: 'text' },
      { header: `Amount ${la}`, numFmt: currencyFmt, type: 'number' },
      { header: `Amount ${lb}`, numFmt: currencyFmt, type: 'number' },
      { header: 'Delta', numFmt: currencyFmt, type: 'number' },
    ];
    const pairRow = (a: RecRecord, b: RecRecord, delta?: number) => [
      a.date ?? b.date ?? '—',
      a.description || b.description,
      a.reference || b.reference || null,
      a.amount,
      b.amount,
      delta ?? (a.amount !== null && b.amount !== null ? Math.round((b.amount - a.amount) * 100) / 100 : null),
    ];
    const onlyCols = [
      { header: 'Date', type: 'text' },
      { header: 'Description', type: 'text' },
      { header: 'Reference', type: 'text' },
      { header: 'Amount', numFmt: currencyFmt, type: 'number' },
    ];
    const onlyRow = (r: RecRecord) => [r.date ?? '—', r.description, r.reference || null, r.amount];

    let ExcelJS: any;
    try {
      const mod: any = await import('exceljs');
      ExcelJS = mod.default ?? mod;
    } catch {
      return 'Error: exceljs is not available in this environment.';
    }
    try {
      const wb = new ExcelJS.Workbook();
      wb.creator = 'ArksAI';
      wb.calcProperties.fullCalcOnLoad = true;
      buildSheet(wb, summarySheet, accentArgb, currencyFmt);
      if (rec.mismatched.length)
        buildSheet(wb, { name: 'Mismatched', columns: pairCols, rows: rec.mismatched.map((m) => pairRow(m.a, m.b, m.delta)) }, accentArgb, currencyFmt);
      if (rec.onlyA.length) buildSheet(wb, { name: `Only in ${la}`.slice(0, 31), columns: onlyCols, rows: rec.onlyA.map(onlyRow) }, accentArgb, currencyFmt);
      if (rec.onlyB.length) buildSheet(wb, { name: `Only in ${lb}`.slice(0, 31), columns: onlyCols, rows: rec.onlyB.map(onlyRow) }, accentArgb, currencyFmt);
      if (rec.probable.length)
        buildSheet(wb, { name: 'Probable matches', columns: pairCols, rows: rec.probable.map((m) => pairRow(m.a, m.b)) }, accentArgb, currencyFmt);
      buildSheet(wb, { name: 'Matched', columns: pairCols, rows: rec.matched.map((m) => pairRow(m.a, m.b)) }, accentArgb, currencyFmt);
      await wb.xlsx.writeFile(absOut);
    } catch (e: any) {
      return `Error: failed to write the reconciliation workbook — ${e?.message ?? e}`;
    }

    const sz = fs.existsSync(absOut) ? fs.statSync(absOut).size : 0;
    const lines = [
      `Reconciled ${la} (${aRecs.length} rows) against ${lb} (${bRecs.length} rows) on ${rec.keys.join('+')} → ${finalName} (${Math.round(sz / 1024)} KB).`,
      '',
      `- Matched: ${rec.matched.length}`,
      `- Amount mismatches: ${rec.mismatched.length}${rec.mismatched.length ? ` (net delta ${rec.mismatched.reduce((n, m) => n + m.delta, 0).toFixed(2)})` : ''}`,
      `- Probable (fuzzy date ±${args.date_tolerance_days ?? 3}d): ${rec.probable.length}`,
      `- Only in ${la}: ${rec.onlyA.length}${rec.onlyA.length ? ` (sum ${sum(rec.onlyA).toFixed(2)})` : ''}`,
      `- Only in ${lb}: ${rec.onlyB.length}${rec.onlyB.length ? ` (sum ${sum(rec.onlyB).toFixed(2)})` : ''}`,
      '',
      'Every input row is in exactly one bucket — the Reconciliation sheet CHECK cells prove it.',
    ];
    return lines.join('\n');
  },
};
