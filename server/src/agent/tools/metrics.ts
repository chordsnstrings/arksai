import type { ToolDef } from './common';
import {
  computeSeriesDeltas,
  listSeries,
  listSnapshots,
  sanitizeMetrics,
  saveSnapshot,
} from '../metricSnapshots';

const fmtNum = (n: number | null): string =>
  n === null ? '—' : Math.abs(n) >= 1000 ? Math.round(n).toLocaleString('en-US') : String(Math.round(n * 100) / 100);

const fmtDelta = (d: number | null, pct: number | null): string => {
  if (d === null) return 'no prior period';
  const sign = d > 0 ? '+' : '';
  return `${sign}${fmtNum(d)}${pct !== null ? ` (${sign}${pct}%)` : ''}`;
};

export const recordMetricsTool: ToolDef = {
  name: 'record_metrics',
  description:
    "SAVE this period's headline numbers so the NEXT run of a recurring report can compare against them. " +
    'Org-scoped memory keyed by series ("monthly-revenue") + period ("2024-02"): pass the final metrics you just ' +
    'computed as a flat name→number map. Returns the like-for-like deltas vs the previously recorded period — put ' +
    'those deltas in the report ("Revenue 120,000, up 8,000 (+7.1%) vs 2024-01"). Re-recording an existing period is ' +
    'a RESTATEMENT: the prior values are kept and the diff is returned — surface it, never hide it. ' +
    'Use at the END of any recurring/scheduled report once the numbers are final. Numbers only (no text values).',
  parameters: {
    type: 'object',
    properties: {
      series: {
        type: 'string',
        description: 'Stable series name for this recurring report, e.g. "monthly-revenue" or "weekly-pipeline". Reuse the SAME name every run.',
      },
      period: { type: 'string', description: 'The period these numbers describe: "2024-02", "2024-W07", "Q1 2024".' },
      metrics: {
        type: 'object',
        description: 'Flat name→number map of the final headline metrics, e.g. {"Revenue": 120000, "Orders": 342, "AOV": 350.88}.',
      },
      note: { type: 'string', description: 'Optional one-line context ("excludes refunds", "source: stripe export").' },
    },
    required: ['series', 'period', 'metrics'],
  },
  modes: ['chat', 'code', 'report'],
  badJsonHint: 'call again with series, period and a SMALL flat metrics object (name→number) — a handful of headline numbers, never row data.',
  summarize: (a) => `record ${String(a.series ?? '')} ${String(a.period ?? '')}`.slice(0, 80),
  async run(args, ctx) {
    const { metrics, dropped } = sanitizeMetrics(args.metrics);
    if (!Object.keys(metrics).length)
      return 'Error: metrics must be a flat object of name→number pairs, e.g. {"Revenue": 120000, "Orders": 342}.';
    let saved;
    try {
      saved = await saveSnapshot({
        orgId: ctx.session.orgId ?? null,
        series: String(args.series ?? ''),
        period: String(args.period ?? ''),
        metrics,
        note: args.note ? String(args.note) : null,
        sessionId: ctx.session.id,
      });
    } catch (e: any) {
      return `Error: ${e?.message ?? e}`;
    }
    const snaps = await listSnapshots(ctx.session.orgId ?? null, saved.snapshot.series);
    const deltas = computeSeriesDeltas(snaps).filter((d) => d.period === saved.snapshot.period);
    const lines: string[] = [
      `Recorded ${saved.snapshot.series} · ${saved.snapshot.period} (${Object.keys(metrics).length} metric(s); ${snaps.length} period(s) on record).`,
    ];
    if (saved.restatement) {
      lines.push(
        `⚠ RESTATEMENT — ${saved.snapshot.period} was already recorded and the values changed. Say so in the report:`,
        ...saved.restatement.map((r) => `- ${r.metric}: ${fmtNum(r.was)} → ${fmtNum(r.now)}`),
      );
    }
    const withPrior = deltas.filter((d) => d.priorPeriod);
    if (withPrior.length) {
      lines.push(`Vs ${withPrior[0].priorPeriod}:`);
      for (const d of withPrior)
        lines.push(`- ${d.metric}: ${fmtNum(d.value)} — ${d.isNew ? 'NEW metric (no prior value)' : fmtDelta(d.delta, d.deltaPct)}`);
    } else if (snaps.length === 1) {
      lines.push('First recorded period for this series — the next run will get deltas against these numbers.');
    } else {
      lines.push('This is the earliest period on record — later periods compare against it.');
    }
    if (dropped.length) lines.push(`Dropped non-numeric metric(s): ${dropped.join(', ')}.`);
    return lines.join('\n');
  },
};

export const metricHistoryTool: ToolDef = {
  name: 'metric_history',
  description:
    'READ the recorded history of a recurring report series (saved with record_metrics) — periods, values, ' +
    'like-for-like deltas between consecutive periods, and any RESTATEMENTS (periods whose numbers were re-recorded, ' +
    'with the before→after diff). Call at the START of a recurring report to ground "vs last period" statements in ' +
    'the actual prior numbers instead of guessing. Omit series to list the series that exist for this workspace.',
  parameters: {
    type: 'object',
    properties: {
      series: { type: 'string', description: 'The series name to read, e.g. "monthly-revenue". Omit to list available series.' },
      metric: { type: 'string', description: 'Optional: show only this metric across periods.' },
    },
  },
  modes: ['chat', 'code', 'report'],
  summarize: (a) => `history ${String(a.series ?? '(list)')}`.slice(0, 80),
  async run(args, ctx) {
    const orgId = ctx.session.orgId ?? null;
    if (!args.series) {
      const series = await listSeries(orgId);
      if (!series.length) return 'No metric series recorded yet — record_metrics saves this period\'s numbers for future comparisons.';
      return `Recorded series:\n${series.map((s) => `- ${s.series}: ${s.periods} period(s), latest ${s.last}`).join('\n')}`;
    }
    const snaps = await listSnapshots(orgId, String(args.series));
    if (!snaps.length) {
      const series = await listSeries(orgId);
      return `No snapshots for series "${args.series}".${series.length ? ` Available: ${series.map((s) => s.series).join(', ')}.` : ' Nothing recorded yet.'}`;
    }
    const want = args.metric ? String(args.metric).trim().toLowerCase() : null;
    const deltas = computeSeriesDeltas(snaps).filter((d) => !want || d.metric.toLowerCase() === want);
    if (want && !deltas.length) {
      const names = new Set(snaps.flatMap((s) => Object.keys(s.metrics)));
      return `Metric "${args.metric}" not found in series "${snaps[0].series}" — metrics on record: ${[...names].join(', ')}.`;
    }
    const lines: string[] = [`${snaps[0].series} — ${snaps.length} period(s):`];
    for (const s of snaps) {
      const rows = deltas.filter((d) => d.period === s.period);
      lines.push(`\n${s.period}${s.note ? ` — ${s.note}` : ''}`);
      for (const d of rows)
        lines.push(`- ${d.metric}: ${fmtNum(d.value)}${d.priorPeriod ? ` — ${d.isNew ? 'NEW metric this period' : `${fmtDelta(d.delta, d.deltaPct)} vs ${d.priorPeriod}`}` : ''}`);
      if (s.restatedFrom) {
        const changed = Object.keys({ ...s.restatedFrom, ...s.metrics }).filter(
          (k) => (s.restatedFrom as any)[k] !== s.metrics[k],
        );
        if (changed.length)
          lines.push(
            `  ⚠ restated ${s.restatedAt ? new Date(s.restatedAt).toISOString().slice(0, 10) : ''}: ${changed
              .map((k) => `${k} ${fmtNum((s.restatedFrom as any)[k] ?? null)} → ${fmtNum(s.metrics[k] ?? null)}`)
              .join('; ')}`,
          );
      }
    }
    lines.push('\nA missing metric in a period means it was not recorded then — missing is NOT zero.');
    return lines.join('\n');
  },
};
