/**
 * Shared analytics chart primitives + formatters, used by both the operator console
 * (AnalyticsConsole) and the per-org dashboard (OrgAnalytics). Hand-rolled SVG on the
 * editorial theme — no chart dependency. METADATA ONLY: these render counts/rates, never
 * any message or document content.
 */

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

export function LineChart({ data, fmt }: { data: { x: number; y: number }[]; fmt?: (n: number) => string }) {
  if (!data.length) return <div className="an-empty">No data yet.</div>;
  const W = 640, H = 120, P = 6;
  const ys = data.map((d) => d.y);
  const max = Math.max(1, ...ys);
  const pts = data.map((d, i) => {
    const x = P + (i / Math.max(1, data.length - 1)) * (W - 2 * P);
    const y = H - P - (d.y / max) * (H - 2 * P);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg className="an-line" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <polyline points={pts.join(' ')} fill="none" stroke="var(--accent)" strokeWidth="2" />
      <text x={P} y={12} className="an-axis">{fmt ? fmt(max) : max}</text>
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
