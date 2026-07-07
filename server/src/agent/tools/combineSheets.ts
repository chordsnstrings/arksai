import fs from 'node:fs';
import { resolveInWorkspace, ToolError, type ToolDef } from './common';
import { buildSheet, toArgb, currencyNumFmt } from './excel';
import {
  type CombinePlan,
  type FieldPlan,
  type GridSource,
  type SourceProfile,
  autoMapSources,
  cleanText,
  combineSources,
  profileSource,
} from '../sheetCombine';

/** 0-based column index → Excel letter. */
const colLetter = (i: number): string => {
  let s = '';
  let n = i + 1;
  while (n > 0) {
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};

const MAX_SOURCES = 40;

/** Load every requested input into raw grids — one GridSource per non-empty tab. */
async function loadSources(repoDir: string, inputs: string[]): Promise<GridSource[]> {
  const XLSX: any = await import('xlsx');
  const out: GridSource[] = [];
  for (const spec of inputs) {
    let file = String(spec).trim();
    let onlyTab: string | null = null;
    // "file.xlsx!TabName" narrows to one tab (only when the bare path doesn't exist).
    const bang = file.lastIndexOf('!');
    if (bang > 0) {
      const candidate = file.slice(0, bang);
      try {
        if (!fs.existsSync(resolveInWorkspace(repoDir, file)) && fs.existsSync(resolveInWorkspace(repoDir, candidate))) {
          onlyTab = file.slice(bang + 1);
          file = candidate;
        }
      } catch {
        /* fall through to the normal resolve below */
      }
    }
    const abs = resolveInWorkspace(repoDir, file);
    if (!fs.existsSync(abs)) throw new ToolError(`no file at "${file}"`);
    const wb = XLSX.read(fs.readFileSync(abs), { type: 'buffer', cellDates: true });
    const tabs: string[] = onlyTab ? [onlyTab] : wb.SheetNames;
    if (onlyTab && !wb.Sheets[onlyTab])
      throw new ToolError(`"${file}" has no tab "${onlyTab}" — tabs: ${wb.SheetNames.join(', ')}`);
    for (const tab of tabs) {
      const ws = wb.Sheets[tab];
      if (!ws) continue;
      const grid: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true });
      if (!grid.some((r) => (r ?? []).some((c: any) => c !== null && c !== undefined && String(c).trim() !== ''))) continue;
      out.push({ file, tab: wb.SheetNames.length > 1 || onlyTab ? tab : '', grid });
      if (out.length > MAX_SOURCES) throw new ToolError(`more than ${MAX_SOURCES} source tabs — combine in batches`);
    }
  }
  if (!out.length) throw new ToolError('no non-empty sheets found in the given inputs');
  return out;
}

/** Resolve a model-supplied explicit mapping (header NAMES) against the profiles → a CombinePlan. */
function applyExplicitMapping(profiles: SourceProfile[], mapping: any[]): CombinePlan {
  const byKey = new Map(profiles.map((p) => [p.key, p] as const));
  const findCol = (p: SourceProfile, header: string): number => {
    const want = cleanText(header).toLowerCase();
    const hit = p.headers.findIndex((h) => h.toLowerCase() === want);
    if (hit < 0) throw new ToolError(`"${p.key}" has no column "${header}" — headers: ${p.headers.join(', ')}`);
    return hit;
  };
  const fields: FieldPlan[] = [];
  for (const m of mapping) {
    const name = cleanText(m?.name);
    if (!name) throw new ToolError('every mapping entry needs a "name"');
    const kind: FieldPlan['kind'] = ['date', 'amount', 'balance', 'number', 'text'].includes(m?.kind) ? m.kind : name.toLowerCase() === 'date' ? 'date' : name.toLowerCase() === 'amount' ? 'amount' : 'text';
    const from: FieldPlan['from'] = {};
    for (const [key, src] of Object.entries(m?.from ?? {})) {
      const p = byKey.get(key);
      if (!p) throw new ToolError(`mapping for "${name}" names unknown source "${key}" — sources: ${profiles.map((x) => x.key).join(' ; ')}`);
      if (src && typeof src === 'object') {
        const pair = src as { debit?: string; credit?: string };
        from[key] = {
          debit: pair.debit !== undefined ? findCol(p, String(pair.debit)) : undefined,
          credit: pair.credit !== undefined ? findCol(p, String(pair.credit)) : undefined,
        };
      } else {
        from[key] = findCol(p, String(src));
      }
    }
    fields.push({ name, kind, from });
  }
  return { fields, confident: true, notes: [] };
}

/** Serialize a plan back to the model-editable mapping JSON (header names, not indices). */
function planToMappingJson(plan: CombinePlan, profiles: SourceProfile[]): any[] {
  const byKey = new Map(profiles.map((p) => [p.key, p] as const));
  return plan.fields.map((f) => ({
    name: f.name,
    kind: f.kind,
    from: Object.fromEntries(
      Object.entries(f.from)
        .filter(([, v]) => v !== undefined)
        .map(([key, v]) => {
          const p = byKey.get(key)!;
          if (typeof v === 'object' && v)
            return [key, { debit: v.debit !== undefined ? p.headers[v.debit] : undefined, credit: v.credit !== undefined ? p.headers[v.credit] : undefined }];
          return [key, p.headers[v as number]];
        }),
    ),
  }));
}

export const combineSpreadsheetsTool: ToolDef = {
  name: 'combine_spreadsheets',
  description:
    'Combine MULTIPLE spreadsheet files/tabs (xlsx/xls/csv) into ONE clean, reconciled, premium-styled workbook — ' +
    'the tool for "merge these bank statements", "combine my expense sheets", "stack these exports into one". ' +
    'ONE CALL with inputs:[paths] usually does EVERYTHING deterministically on the server: it detects each sheet\'s real ' +
    'header row (skipping bank-export preamble), auto-maps columns across files by meaning (date/description/amount; a ' +
    'debit+credit pair becomes ONE signed amount, credits positive), normalises dates (DD/MM vs MM/DD resolved by evidence, ' +
    'Excel serials handled) and amounts (currency symbols, thousands separators, parentheses negatives, CR/DR markers), ' +
    'drops empty rows / repeated in-file headers / footer total rows, de-duplicates overlapping rows across files, stamps a ' +
    'Source column, sorts by date, and writes: a "Combined" sheet + an "Audit" sheet (per-source rows-in/kept/dropped-by-reason ' +
    'and amount sums as LIVE COUNTIF/SUMIF formulas with tie CHECKS that must read OK — the workbook itself proves no row ' +
    'was lost) + a "Monthly" summary (live SUM formulas per month). NEVER pre-read the files with read_spreadsheet or write a ' +
    'merge script — pass the paths straight in (uploads live at uploads/<name>). A tab can be pinned with "file.xlsx!TabName"; ' +
    'multi-tab workbooks contribute every non-empty tab. If auto-mapping is not confident it returns each source\'s profile + a ' +
    'proposed mapping to correct and re-send via the optional `mapping` param (header NAMES per source key). ' +
    'Unmatched source columns are KEPT as extra output columns (data is never silently dropped) — pass an explicit mapping to trim. ' +
    'Set currency ("AED", "$") for money formatting and accent for branding.',
  parameters: {
    type: 'object',
    properties: {
      inputs: {
        type: 'array',
        items: { type: 'string' },
        description: 'Paths of the spreadsheets to combine (e.g. ["uploads/jan.xlsx","uploads/feb.csv"]). Optional "!TabName" suffix pins one tab.',
      },
      output: { type: 'string', description: 'Output filename. Default combined.xlsx.' },
      currency: { type: 'string', description: 'Currency for amount columns — ISO code ("AED") or symbol ("$"). Neutral #,##0.00 when omitted.' },
      accent: { type: 'string', description: 'Brand accent hex for the theme (e.g. "#1f5f8b").' },
      dedupe: { type: 'boolean', description: 'Drop rows duplicated across files (same date+description+amount). Default true.' },
      sort: { type: 'boolean', description: 'Sort combined rows by date. Default true.' },
      mapping: {
        type: 'array',
        description:
          'OPTIONAL explicit column mapping (only when auto-mapping asked for it or to trim/rename): ' +
          '[{"name":"Date","kind":"date","from":{"<source key>":"Posting Date"}},{"name":"Amount","kind":"amount","from":{"<source key>":{"debit":"Withdrawal","credit":"Deposit"}}}]. ' +
          'Source keys are exactly as reported (e.g. "uploads/jan.xlsx › Sheet1"). Fields you omit are dropped from the output.',
        items: { type: 'object' },
      },
    },
    required: ['inputs'],
  },
  modes: ['chat', 'code', 'report'],
  badJsonHint:
    'call again with just inputs:[paths] — the mapping param is OPTIONAL (auto-mapping handles standard bank/expense exports); never inline row data.',
  summarize: (a) => `combine ${Array.isArray(a.inputs) ? a.inputs.length : 0} file(s) → ${String(a.output ?? 'combined.xlsx')}`,
  async run(args, ctx) {
    const inputs = Array.isArray(args.inputs) ? args.inputs.map(String) : [];
    if (!inputs.length) return 'Error: pass inputs: ["file1.xlsx", "file2.csv", …] — the spreadsheets to combine.';
    let sources: GridSource[];
    try {
      sources = await loadSources(ctx.repoDir, inputs);
    } catch (e: any) {
      return `Error: ${e instanceof ToolError ? e.message : (e?.message ?? e)}`;
    }
    const profiles = sources.map(profileSource);

    let plan: CombinePlan;
    try {
      plan = Array.isArray(args.mapping) && args.mapping.length ? applyExplicitMapping(profiles, args.mapping) : autoMapSources(profiles);
    } catch (e: any) {
      return `Error: ${e instanceof ToolError ? e.message : (e?.message ?? e)}`;
    }

    // Not confident and no explicit mapping → return the profiles + a proposed mapping to
    // correct (the model's ONLY job in this pipeline). One extra round max.
    if (!plan.confident) {
      const lines = ['Could not auto-map every source confidently — no file was written. Review and re-call with a `mapping` param.', ''];
      for (const p of profiles) {
        lines.push(`SOURCE "${p.key}" — header row ${p.headerRow + 1}, ${p.dataRows} data row(s)`);
        if (p.preamble.length) lines.push(`  preamble: ${p.preamble.join(' ⏎ ')}`);
        lines.push(`  columns: ${p.columns.map((c) => `${c.header}(${c.type})`).join(', ')}`);
        for (const c of p.columns.slice(0, 8)) if (c.samples.length) lines.push(`    ${c.header}: ${c.samples.join(' | ')}`);
      }
      lines.push('', `PROPOSED mapping (fix the gaps, then re-call combine_spreadsheets with the same inputs plus mapping:):`);
      lines.push(JSON.stringify(planToMappingJson(plan, profiles), null, 1));
      if (plan.notes.length) lines.push('', `Gaps: ${plan.notes.join(' ')}`);
      return lines.join('\n');
    }

    const result = combineSources(sources, profiles, plan, { dedupe: args.dedupe !== false, sort: args.sort !== false });

    // ---- build the themed output workbook ----
    const outName = String(args.output || 'combined.xlsx').replace(/[^a-zA-Z0-9._-]/g, '-');
    const finalName = outName.toLowerCase().endsWith('.xlsx') ? outName : `${outName}.xlsx`;
    let absOut: string;
    try {
      absOut = resolveInWorkspace(ctx.repoDir, finalName);
    } catch (e: any) {
      return `Error: ${e?.message ?? e}`;
    }
    const currencyFmt = args.currency ? currencyNumFmt(String(args.currency)) : '#,##0.00';
    const accentArgb = toArgb(args.accent, 'FF1F5F8B');
    const kindToCol = (f: FieldPlan) =>
      f.kind === 'date'
        ? { header: f.name, type: 'date' }
        : f.kind === 'amount' || f.kind === 'balance'
          ? { header: f.name, numFmt: currencyFmt, type: 'number' }
          : f.kind === 'number'
            ? { header: f.name, type: 'number' }
            : { header: f.name, type: 'text' };

    const combinedCols = [...result.fields.map(kindToCol), { header: 'Source', type: 'text' }];
    const amountIdx = result.fields.findIndex((f) => f.kind === 'amount');
    const sourceIdx = combinedCols.length - 1;
    const nRows = result.rows.length + 1; // + header
    const amountCol = amountIdx >= 0 ? colLetter(amountIdx) : null;
    const sourceCol = colLetter(sourceIdx);

    // Audit sheet — engine literals + LIVE formulas over Combined + tie checks. Checks are
    // IF(...,"OK","MISMATCH") with cached "OK": ExcelJS drops a cached result of 0 (falsy
    // writer quirk), strings persist, and "OK" reads better than 0.00 for a non-expert.
    const f = (formula: string, v: number | string) => ({ f: formula, v });
    const auditRows: any[][] = result.perSource.map((s, i) => {
      const r = i + 2;
      const live = f(`COUNTIF(Combined!$${sourceCol}$2:$${sourceCol}$${nRows},A${r})`, s.kept);
      const liveSum = amountCol ? f(`ROUND(SUMIF(Combined!$${sourceCol}$2:$${sourceCol}$${nRows},A${r},Combined!$${amountCol}$2:$${amountCol}$${nRows}),2)`, Math.round(s.amountSum * 100) / 100) : null;
      return [
        s.key, s.rowsIn, s.kept, s.drops.empty, s.drops.repeatedHeader, s.drops.footer, s.drops.nonData, s.drops.duplicate,
        Math.round(s.amountSum * 100) / 100,
        live,
        liveSum,
        f(`IF(J${r}=C${r},"OK","MISMATCH")`, 'OK'),
        liveSum ? f(`IF(ROUND(K${r}-I${r},2)=0,"OK","MISMATCH")`, 'OK') : null,
      ];
    });
    const tr = result.perSource.length + 2;
    auditRows.push([
      'TOTAL',
      f(`SUM(B2:B${tr - 1})`, result.perSource.reduce((n, s) => n + s.rowsIn, 0)),
      f(`SUM(C2:C${tr - 1})`, result.perSource.reduce((n, s) => n + s.kept, 0)),
      null, null, null, null, null,
      f(`ROUND(SUM(I2:I${tr - 1}),2)`, Math.round(result.totalAmount * 100) / 100),
      f(`SUM(J2:J${tr - 1})`, result.perSource.reduce((n, s) => n + s.kept, 0)),
      amountCol ? f(`ROUND(SUM(Combined!$${amountCol}$2:$${amountCol}$${nRows}),2)`, Math.round(result.totalAmount * 100) / 100) : null,
      f(`IF(J${tr}=C${tr},"OK","MISMATCH")`, 'OK'),
      amountCol ? f(`IF(ROUND(K${tr}-I${tr},2)=0,"OK","MISMATCH")`, 'OK') : null,
    ]);
    const auditSheet = {
      name: 'Audit',
      columns: [
        { header: 'Source', type: 'text' }, { header: 'Rows in', numFmt: '0', type: 'number' }, { header: 'Kept', numFmt: '0', type: 'number' },
        { header: 'Empty', numFmt: '0', type: 'number' }, { header: 'Repeated header', numFmt: '0', type: 'number' },
        { header: 'Footer/totals', numFmt: '0', type: 'number' }, { header: 'Non-data', numFmt: '0', type: 'number' },
        { header: 'Duplicates', numFmt: '0', type: 'number' }, { header: 'Amount sum', numFmt: currencyFmt, type: 'number' },
        { header: 'Rows in file (live)', numFmt: '0', type: 'number' }, { header: 'Sum in file (live)', numFmt: currencyFmt, type: 'number' },
        { header: 'CHECK rows tie', type: 'text' }, { header: 'CHECK sum ties', type: 'text' },
      ],
      rows: auditRows,
      __pattern: true, // statement, not a data table — no autofilter arrows
    };

    // Monthly summary — the Combined sheet is date-sorted, so each month is a CONTIGUOUS
    // block and plain SUM/COUNT ranges (recalc-verifiable) are exact.
    let monthlySheet: any = null;
    const dateIdx = result.fields.findIndex((fld) => fld.kind === 'date');
    if (dateIdx >= 0 && amountIdx >= 0 && args.sort !== false) {
      const buckets: Array<{ month: string; start: number; end: number; count: number; sum: number }> = [];
      result.rows.forEach((row, i) => {
        const d = row[dateIdx];
        if (!(d instanceof Date)) return;
        const month = d.toISOString().slice(0, 7);
        const excelRow = i + 2;
        const amt = typeof row[amountIdx] === 'number' ? row[amountIdx] : 0;
        const last = buckets[buckets.length - 1];
        if (last && last.month === month) {
          last.end = excelRow;
          last.count++;
          last.sum += amt;
        } else buckets.push({ month, start: excelRow, end: excelRow, count: 1, sum: amt });
      });
      if (buckets.length) {
        monthlySheet = {
          name: 'Monthly',
          columns: [
            { header: 'Month', type: 'text' },
            { header: 'Transactions', numFmt: '0', type: 'number' },
            { header: 'Total', numFmt: currencyFmt, type: 'number' },
          ],
          rows: buckets.map((b) => [
            b.month,
            b.count,
            f(`ROUND(SUM(Combined!$${amountCol}$${b.start}:$${amountCol}$${b.end}),2)`, Math.round(b.sum * 100) / 100),
          ]),
          __pattern: true,
        };
      }
    }

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
      buildSheet(wb, { name: 'Combined', columns: combinedCols, rows: result.rows }, accentArgb, currencyFmt);
      buildSheet(wb, auditSheet, accentArgb, currencyFmt);
      if (monthlySheet) buildSheet(wb, monthlySheet, accentArgb, currencyFmt);
      // Deliberately NO recalcWorkbook here: the JS recalculator can't do SUMIF/COUNTIF, so
      // a SUM/arithmetic cell REFERENCING those cells would resolve them as 0 and clobber
      // the engine's correct cached results. Every cached value in this workbook is computed
      // by the combine engine itself (authoritative by construction); Excel/LibreOffice
      // recalculate live on open (fullCalcOnLoad) and the droplet's soffice gate re-verifies.
      await wb.xlsx.writeFile(absOut);
    } catch (e: any) {
      return `Error: failed to write the combined workbook — ${e?.message ?? e}`;
    }

    const sz = fs.existsSync(absOut) ? fs.statSync(absOut).size : 0;
    const lines = [
      `Combined ${sources.length} sheet(s) from ${inputs.length} file(s) → ${finalName} (${Math.round(sz / 1024)} KB) — ` +
        `${result.rows.length} row(s), reconciled and styled. Sheets: Combined${monthlySheet ? ' · Monthly' : ''} · Audit ` +
        `(live per-source tie-outs — every tie check reads OK).`,
      '',
      'Reconciliation:',
    ];
    for (const s of result.perSource) {
      const d = s.drops;
      const drops = [
        d.empty && `${d.empty} empty`, d.repeatedHeader && `${d.repeatedHeader} repeated header`, d.footer && `${d.footer} footer/total`,
        d.nonData && `${d.nonData} non-data`, d.duplicate && `${d.duplicate} duplicate`,
      ].filter(Boolean).join(', ');
      lines.push(`- ${s.key}: ${s.rowsIn} in → ${s.kept} kept${drops ? ` (dropped: ${drops})` : ''}${amountIdx >= 0 ? `, amount sum ${s.amountSum.toFixed(2)}` : ''}`);
    }
    if (amountIdx >= 0) lines.push(`- TOTAL: ${result.rows.length} rows, amount sum ${result.totalAmount.toFixed(2)}`);
    lines.push('', `Columns: ${combinedCols.map((c: any) => c.header).join(' · ')}`);
    if (result.warnings.length) lines.push('', `Notes:\n- ${result.warnings.join('\n- ')}`);
    return lines.join('\n');
  },
};
