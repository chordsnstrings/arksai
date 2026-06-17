/**
 * Shared analytics chart primitives + formatters, used by both the operator console
 * (AnalyticsConsole) and the per-org dashboard (OrgAnalytics). Hand-rolled SVG on the
 * editorial theme — no chart dependency. METADATA ONLY: these render counts/rates, never
 * any message or document content.
 */
import type { ReactNode } from 'react';

export const DAY_MS = 86_400_000;
export const fmtDay = (epochDay: number) => new Date(epochDay * DAY_MS).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
export const fmtWeek = (ts: number) => new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
export const fmtNum = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n ?? 0));
export const fmtMoney = (n: number) => (n >= 1 ? `$${n.toFixed(2)}` : `$${(n ?? 0).toFixed(n < 0.01 ? 4 : 2)}`);
export const ago = (ts: number | null) => (ts ? `${Math.max(0, Math.round((Date.now() - ts) / DAY_MS))}d ago` : '—');

/** Compact human duration (e.g. "3d", "5h", "12m", "<1m"). */
export const fmtDur = (ms: number | null | undefined): string => {
  if (ms == null) return '—';
  const m = ms / 60000;
  if (m < 1) return '<1m';
  if (m < 60) return `${Math.round(m)}m`;
  const h = m / 60;
  if (h < 24) return `${Math.round(h)}h`;
  return `${Math.round(h / 24)}d`;
};

/** Quote a CSV cell only when needed. */
const csvCell = (v: any): string => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
/** Rows → CSV text given an ordered column spec. */
export function toCsv(rows: Record<string, any>[], columns: { key: string; label: string }[]): string {
  const head = columns.map((c) => csvCell(c.label)).join(',');
  const body = rows.map((r) => columns.map((c) => csvCell(r[c.key])).join(',')).join('\n');
  return `${head}\n${body}`;
}
/** Trigger a client-side CSV file download (no server round-trip). */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function KPI({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="an-kpi">
      <div className="an-kpi-label">{label}</div>
      <div className="an-kpi-value">{value}</div>
      {sub && <div className="an-kpi-sub">{sub}</div>}
    </div>
  );
}

/** A period-over-period change chip. `invert` = up is bad (e.g. cost). */
export function Delta({ cur, prev, invert }: { cur: number; prev: number | null | undefined; invert?: boolean }) {
  if (prev == null || (prev === 0 && cur === 0)) return null;
  const pct = prev === 0 ? 100 : Math.round(((cur - prev) / Math.abs(prev)) * 100);
  if (pct === 0) return <span className="an-delta flat">±0%</span>;
  const up = pct > 0;
  const good = invert ? !up : up;
  return (
    <span className={`an-delta ${good ? 'good' : 'bad'}`} title="vs the previous 7 days">
      {up ? '▲' : '▼'} {Math.abs(pct)}%
    </span>
  );
}

/** Tiny inline trend line (line + soft area) that stretches to fill its cell. */
export function Sparkline({ data }: { data: number[] }) {
  if (!data || data.length < 2) return <div className="an-spark-empty" />;
  const w = 100, h = 28;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => [(i / (data.length - 1)) * w, h - 2 - ((v - min) / range) * (h - 4)] as const);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  return (
    <svg className="an-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <path d={`${line} L${w},${h} L0,${h} Z`} className="an-spark-area" />
      <path d={line} className="an-spark-line" fill="none" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Dense editorial stat cell: eyebrow + delta, a big tabular number, then a sparkline or caption. */
export function Stat({
  label,
  value,
  delta,
  spark,
  sub,
}: {
  label: string;
  value: string;
  delta?: ReactNode;
  spark?: number[];
  sub?: string;
}) {
  return (
    <div className="an-stat">
      <div className="an-stat-top">
        <span className="an-stat-label">{label}</span>
        {delta}
      </div>
      <div className="an-stat-value">{value}</div>
      {spark && spark.length > 1 ? <Sparkline data={spark} /> : sub ? <div className="an-stat-sub">{sub}</div> : null}
    </div>
  );
}

export function LineChart({ data, fmt }: { data: { x: number; y: number }[]; fmt?: (n: number) => string }) {
  if (!data.length) return <div className="an-empty">No data yet.</div>;
  const W = 640, H = 104, PT = 12, PB = 6, PX = 3;
  const ys = data.map((d) => d.y);
  const max = Math.max(1, ...ys);
  const x = (i: number) => PX + (i / Math.max(1, data.length - 1)) * (W - 2 * PX);
  const y = (v: number) => PT + (1 - v / max) * (H - PT - PB);
  const line = data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.y).toFixed(1)}`).join(' ');
  const area = `${line} L${x(data.length - 1).toFixed(1)},${H - PB} L${x(0).toFixed(1)},${H - PB} Z`;
  return (
    <svg className="an-line" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <line x1="0" x2={W} y1={y(max)} y2={y(max)} className="an-grid-line" />
      <line x1="0" x2={W} y1={y(max / 2)} y2={y(max / 2)} className="an-grid-line" />
      <path d={area} className="an-area" />
      <path d={line} className="an-line-path" fill="none" vectorEffect="non-scaling-stroke" />
      <text x={PX} y={9} className="an-axis">{fmt ? fmt(max) : max}</text>
    </svg>
  );
}

export function BarList({ items, money }: { items: { key: string; value: number }[]; money?: boolean }) {
  if (!items?.length) return <div className="an-empty">No data yet.</div>;
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="an-bars">
      {items.map((it) => (
        <div className="an-bar-row" key={it.key} title={it.key}>
          <span className="an-bar-k">{it.key}</span>
          <span className="an-bar-track"><span className="an-bar-fill" style={{ width: `${(it.value / max) * 100}%` }} /></span>
          <span className="an-bar-v">{money ? fmtMoney(it.value) : fmtNum(it.value)}</span>
        </div>
      ))}
    </div>
  );
}

export function Funnel({ stages }: { stages: { stage: string; count: number; pct: number }[] }) {
  if (!stages?.length) return <div className="an-empty">No data yet.</div>;
  return (
    <div className="an-bars">
      {stages.map((s) => (
        <div className="an-bar-row" key={s.stage}>
          <span className="an-bar-k">{s.stage}</span>
          <span className="an-bar-track"><span className="an-bar-fill" style={{ width: `${s.pct}%` }} /></span>
          <span className="an-bar-v">{fmtNum(s.count)} · {s.pct}%</span>
        </div>
      ))}
    </div>
  );
}

export function CohortGrid({ rows }: { rows: { startTs: number; size: number; retained: number[] }[] }) {
  if (!rows?.length) return <div className="an-empty">Not enough history yet — cohorts build as users return.</div>;
  const weeks = Math.max(...rows.map((r) => r.retained.length));
  return (
    <table className="an-cohort">
      <thead>
        <tr>
          <th>Cohort</th>
          <th>Users</th>
          {Array.from({ length: weeks }, (_, i) => <th key={i}>W{i}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.startTs}>
            <td>{fmtWeek(r.startTs)}</td>
            <td>{r.size}</td>
            {Array.from({ length: weeks }, (_, i) => {
              const v = r.retained[i];
              return (
                <td key={i} className="an-cell" style={v == null ? undefined : { background: `color-mix(in srgb, var(--accent) ${v}%, transparent)`, color: v > 55 ? '#fff' : 'var(--text)' }}>
                  {v == null ? '' : `${v}%`}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
