import fs from 'node:fs';
import path from 'node:path';
import { resolveInWorkspace, ToolError, type ToolDef } from './common';
import { buildSheet, toArgb, currencyNumFmt } from './excel';
import { cleanText, parseDateValue, profileSource, type GridSource, type SourceProfile } from '../sheetCombine';
import { computeVarianceBridge, type VarianceResult } from '../varianceBridge';
import { loadSide } from './reconcileSheets';

/** Grid → row objects keyed by the profiled headers (raw values preserved). */
function gridToObjects(src: GridSource, p: SourceProfile): Array<Record<string, any>> {
  const data = src.grid.slice(p.headerRow + (p.headerRowCount ?? 1));
  return data
    .filter((row) => (row ?? []).some((c: any) => c !== null && c !== undefined && String(c).trim() !== ''))
    .map((row) => {
      const o: Record<string, any> = {};
      p.headers.forEach((h, i) => (o[h] = (row ?? [])[i] ?? null));
      return o;
    });
}

/** Resolve a user-named column against the real headers (exact → contains → error). */
function resolveColumn(p: SourceProfile, name: string, what: string): string {
  const want = cleanText(name).toLowerCase();
  const exact = p.headers.find((h) => h.toLowerCase() === want);
  if (exact) return exact;
  const partial = p.headers.filter((h) => h.toLowerCase().includes(want) || want.includes(h.toLowerCase()));
  if (partial.length === 1) return partial[0];
  throw new ToolError(`${what} column "${name}" not found${partial.length ? ` (ambiguous: ${partial.join(', ')})` : ''} — headers: ${p.headers.join(', ')}`);
}

/** Normalise a period cell for filtering: Date → yyyy-mm; text/serial → best effort. */
function periodOf(v: any): string {
  const d = v instanceof Date ? v : parseDateValue(v);
  if (d) return d.toISOString().slice(0, 7);
  return cleanText(v).toLowerCase();
}

export const analyzeVarianceTool: ToolDef = {
  name: 'analyze_variance',
  description:
    'EXPLAIN A METRIC\'S CHANGE — the "why did revenue drop?" tool. Decomposes the move in a metric between two ' +
    'datasets (this month vs last, actual vs plan/budget) BY DIMENSION, deterministically: aggregates the metric per ' +
    'segment on each side, computes every segment\'s contribution delta (they sum EXACTLY to the total change — the ' +
    'bridge\'s own tie-out), ranks the movers, flags NEW and DISAPPEARED segments, and writes the driver commentary ' +
    '("Revenue fell 340,000 (-8.2%). By Region: driven by EMEA -120,000 (35% of the change)…"). ' +
    'TWO MODES: (a) two files — current + prior (e.g. feb.xlsx vs jan.xlsx, or actuals.csv vs budget.csv); ' +
    '(b) ONE file with a period column — pass period_column + current_period + prior_period ("2024-02" vs "2024-01"; ' +
    'matches month prefixes of real dates or text values). Outputs a themed workbook: a "Variance Bridge" sheet ' +
    '(prior → ranked movers → current, with an OK tie check) + a "Movers — <dimension>" sheet per dimension ' +
    '(segment, prior, current, delta, share of change). Relay the commentary to the user — it IS the answer. ' +
    'NEVER pre-read the files or hand-compute the decomposition — one call is the whole analysis.',
  parameters: {
    type: 'object',
    properties: {
      current: { type: 'string', description: 'Path of the CURRENT-side spreadsheet (or the single file in period mode).' },
      prior: { type: 'string', description: 'Path of the PRIOR/plan-side spreadsheet. Omit in period mode.' },
      metric: { type: 'string', description: 'The numeric column to explain, e.g. "Revenue" or "Amount".' },
      dimensions: { type: 'array', items: { type: 'string' }, description: '1-3 dimension columns to decompose by, e.g. ["Region","Channel"].' },
      period_column: { type: 'string', description: 'Period mode: the date/period column in the single file.' },
      current_period: { type: 'string', description: 'Period mode: the current period ("2024-02" or a text label).' },
      prior_period: { type: 'string', description: 'Period mode: the prior period ("2024-01").' },
      output: { type: 'string', description: 'Output filename. Default variance-bridge.xlsx.' },
      currency: { type: 'string', description: 'Currency for amounts ("AED", "$"). Neutral otherwise.' },
      accent: { type: 'string', description: 'Brand accent hex for the theme.' },
    },
    required: ['current', 'metric', 'dimensions'],
  },
  modes: ['chat', 'code', 'report'],
  badJsonHint: 'call again with current/prior paths + metric + dimensions only — never inline row data.',
  summarize: (a) => `variance ${String(a.metric ?? '')} by ${(Array.isArray(a.dimensions) ? a.dimensions : []).join(',')}`.slice(0, 80),
  async run(args, ctx) {
    const dims = Array.isArray(args.dimensions) ? args.dimensions.map(String).slice(0, 3) : [];
    if (!args.current || !args.metric || !dims.length)
      return 'Error: pass current (path), metric (column name) and dimensions (1-3 column names).';
    let curSrc: GridSource;
    let curRows: Array<Record<string, any>>;
    let priRows: Array<Record<string, any>>;
    let curLabel: string;
    let priLabel: string;
    let profile: SourceProfile;
    try {
      curSrc = await loadSide(ctx.repoDir, String(args.current));
      profile = profileSource(curSrc);
      if (args.prior) {
        const priSrc = await loadSide(ctx.repoDir, String(args.prior));
        const priProfile = profileSource(priSrc);
        curRows = gridToObjects(curSrc, profile);
        priRows = gridToObjects(priSrc, priProfile);
        curLabel = path.basename(curSrc.file);
        priLabel = path.basename(priSrc.file);
        // Columns must resolve on BOTH sides (resolve against each side's own headers).
        for (const d of dims) resolveColumn(priProfile, d, 'dimension');
        resolveColumn(priProfile, String(args.metric), 'metric');
      } else {
        if (!args.period_column || !args.current_period || !args.prior_period)
          return 'Error: without a prior file, pass period_column + current_period + prior_period to split one file into the two sides.';
        const pcol = resolveColumn(profile, String(args.period_column), 'period');
        const all = gridToObjects(curSrc, profile);
        const want = (p: any, target: string) => {
          const norm = periodOf(p);
          const t = target.toLowerCase();
          return norm === t || norm.startsWith(t) || t.startsWith(norm);
        };
        curRows = all.filter((r) => want(r[pcol], String(args.current_period)));
        priRows = all.filter((r) => want(r[pcol], String(args.prior_period)));
        curLabel = String(args.current_period);
        priLabel = String(args.prior_period);
        if (!curRows.length || !priRows.length)
          return `Error: period filter matched ${curRows.length} current and ${priRows.length} prior row(s) — sample period values: ${[...new Set(all.slice(0, 50).map((r) => periodOf(r[pcol])))].slice(0, 8).join(', ')}.`;
      }
      // Resolve metric/dimension names against the current side and rewrite args to the real headers.
      const metric = resolveColumn(profile, String(args.metric), 'metric');
      const dimsResolved = dims.map((d: string) => resolveColumn(profile, d, 'dimension'));
      var bridge: VarianceResult = computeVarianceBridge(curRows, priRows, metric, dimsResolved, profile.numberLocale);
    } catch (e: any) {
      return `Error: ${e instanceof ToolError ? e.message : (e?.message ?? e)}`;
    }

    // ---- themed workbook ----
    const outName = String(args.output || 'variance-bridge.xlsx').replace(/[^a-zA-Z0-9._-]/g, '-');
    const finalName = outName.toLowerCase().endsWith('.xlsx') ? outName : `${outName}.xlsx`;
    let absOut: string;
    try {
      absOut = resolveInWorkspace(ctx.repoDir, finalName);
    } catch (e: any) {
      return `Error: ${e?.message ?? e}`;
    }
    const currencyFmt = args.currency ? currencyNumFmt(String(args.currency)) : '#,##0.00';
    const accentArgb = toArgb(args.accent, 'FF1F5F8B');
    const f = (formula: string, v: number | string) => ({ f: formula, v });

    // Bridge sheet uses the MOST EXPLANATORY dimension (highest top-2 concentration).
    const best = [...bridge.byDimension].sort((a, b) => (b.concentration ?? 0) - (a.concentration ?? 0))[0];
    const top = best.movers.slice(0, 8);
    const residual = Math.round((bridge.delta - top.reduce((n, m) => n + m.delta, 0)) * 100) / 100;
    const bridgeRows: any[][] = [
      [`Prior total (${priLabel})`, bridge.priorTotal],
      ...top.map((m) => [`${best.dimension}: ${m.segment}${m.isNew ? ' (new)' : m.isGone ? ' (gone)' : ''}`, m.delta]),
      ...(Math.abs(residual) > 0.005 ? [[`All other ${best.dimension}`, residual]] : []),
    ];
    const curRowNum = bridgeRows.length + 2;
    bridgeRows.push([
      `Current total (${curLabel})`,
      f(`SUM(B2:B${curRowNum - 1})`, bridge.currentTotal),
    ]);
    bridgeRows.push([
      'CHECK bridge ties',
      f(`IF(ROUND(B${curRowNum}-${bridge.currentTotal},2)=0,"OK","MISMATCH")`, 'OK'),
    ]);
    const sheets: any[] = [
      {
        name: 'Variance Bridge',
        columns: [
          { header: 'Step', type: 'text' },
          { header: 'Amount', numFmt: currencyFmt, type: 'number' },
        ],
        rows: bridgeRows,
        __pattern: true,
      },
      ...bridge.byDimension.map((dim) => ({
        name: `Movers — ${dim.dimension}`.slice(0, 31),
        columns: [
          { header: dim.dimension, type: 'text' },
          { header: `Prior (${priLabel})`.slice(0, 30), numFmt: currencyFmt, type: 'number' },
          { header: `Current (${curLabel})`.slice(0, 30), numFmt: currencyFmt, type: 'number' },
          { header: 'Delta', numFmt: currencyFmt, type: 'number' },
          { header: 'Share of change %', numFmt: '0.0', type: 'number' },
        ],
        rows: dim.movers.map((m) => [
          `${m.segment}${m.isNew ? ' (new)' : m.isGone ? ' (gone)' : ''}`,
          m.prior,
          m.current,
          m.delta,
          m.share,
        ]),
        __pattern: true,
      })),
    ];

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
      for (const s of sheets) buildSheet(wb, s, accentArgb, currencyFmt);
      await wb.xlsx.writeFile(absOut);
    } catch (e: any) {
      return `Error: failed to write the variance workbook — ${e?.message ?? e}`;
    }

    const sz = fs.existsSync(absOut) ? fs.statSync(absOut).size : 0;
    const lines = [
      ...bridge.commentary,
      '',
      `Workbook: ${finalName} (${Math.round(sz / 1024)} KB) — Variance Bridge (by ${best.dimension}) + Movers per dimension. The bridge's segment deltas sum exactly to the total change (CHECK reads OK).`,
    ];
    if (bridge.warnings.length) lines.push('', `Notes:\n- ${bridge.warnings.join('\n- ')}`);
    return lines.join('\n');
  },
};
