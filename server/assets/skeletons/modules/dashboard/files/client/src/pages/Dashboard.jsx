import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

/** The status ring + KPI tiles pattern (SVG, no chart dependency). */
function Ring({ pct, label }) {
  const rr = 84, c = 2 * Math.PI * rr;
  return (
    <svg width="200" height="200" viewBox="0 0 200 200" role="img" aria-label={label}>
      <circle cx="100" cy="100" r={rr} fill="none" stroke="var(--line)" strokeWidth="14" />
      <circle cx="100" cy="100" r={rr} fill="none" stroke="var(--accent)" strokeWidth="14" strokeLinecap="round"
        strokeDasharray={`${(pct / 100) * c} ${c}`} transform="rotate(-90 100 100)" />
      <text x="100" y="94" textAnchor="middle" fill="var(--ink)" fontSize="34" fontWeight="600">{pct}%</text>
      <text x="100" y="120" textAnchor="middle" fill="var(--ink-3)" fontSize="12">{label}</text>
    </svg>
  );
}

export default function Dashboard() {
  const [s, setS] = useState(null);
  useEffect(() => { api.get('/stats').then(setS).catch(() => setS({ total: 0, done: 0, open: 0, donePct: 0 })); }, []);
  if (!s) return <div className="page"><div className="empty">Loading…</div></div>;
  return (
    <div className="page">
      <div className="page-hd">
        <div className="titles">
          <div className="eyebrow">Overview</div>
          <h1>Dashboard</h1>
          <div className="sub">{s.total} total · {s.open} open.</div>
        </div>
      </div>
      <div className="grid grid-sidebar">
        <div className="card ring-card">
          <Ring pct={s.donePct} label={`${s.done}/${s.total} done`} />
          <div>
            <div className="card-hd"><h3>Status</h3></div>
            <div className="grid grid-2">
              <div className="kpi"><div className="kpi-label">Open</div><div className="kpi-value">{s.open}</div></div>
              <div className="kpi"><div className="kpi-label">Done</div><div className="kpi-value">{s.done}</div></div>
            </div>
          </div>
        </div>
        <div className="card"><div className="card-hd"><h3>Next</h3></div><p className="muted">Wire real KPIs per entity here — the stats route shows the SQL aggregation pattern.</p></div>
      </div>
    </div>
  );
}
