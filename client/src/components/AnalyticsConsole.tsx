import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useEscClose } from '../hooks/useEscClose';
import { BarList, CohortGrid, Funnel, KPI, LineChart, ago, fmtMoney, fmtNum } from './analyticsCharts';

/**
 * Operator analytics console (superadmin) — a full-screen view of platform usage,
 * engagement, retention, activation, quality and cost. METADATA ONLY (no chat/document
 * content). Charts are hand-rolled SVG on the editorial theme — no chart dependency.
 */

export function AnalyticsConsole({ onClose }: { onClose: () => void }) {
  useEscClose(onClose);
  const [days, setDays] = useState(30);
  const [ov, setOv] = useState<any>(null);
  const [ts, setTs] = useState<any>(null);
  const [usage, setUsage] = useState<any>(null);
  const [quality, setQuality] = useState<{ status: string; count: number }[]>([]);
  const [cost, setCost] = useState<any>(null);
  const [funnel, setFunnel] = useState<any[]>([]);
  const [retention, setRetention] = useState<any[]>([]);
  const [orgs, setOrgs] = useState<any[]>([]);

  useEffect(() => {
    api.analyticsOverview().then(setOv).catch(() => {});
    api.analyticsFunnel().then(setFunnel).catch(() => {});
    api.analyticsRetention().then(setRetention).catch(() => {});
    api.analyticsOrgs().then(setOrgs).catch(() => {});
  }, []);
  useEffect(() => {
    api.analyticsTimeseries(days).then(setTs).catch(() => {});
    api.analyticsUsage(days).then(setUsage).catch(() => {});
    api.analyticsQuality(days).then(setQuality).catch(() => {});
    api.analyticsCost(days).then(setCost).catch(() => {});
  }, [days]);

  const o = ov ?? {};
  const errors = quality.find((q) => q.status === 'error')?.count ?? 0;
  const dones = quality.find((q) => q.status === 'done')?.count ?? 0;

  return (
    <div className="an-view">
      <header className="an-head">
        <div>
          <div className="an-kicker">Platform analytics</div>
          <h1 className="an-title">How ArksAI is being used</h1>
        </div>
        <div className="an-head-right">
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="an-range">
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
          <button className="cancel" onClick={onClose}>Close</button>
        </div>
      </header>

      <div className="an-body">
        <div className="an-kpis">
          <KPI label="Active users (30d)" value={fmtNum(o.activeUsers30d ?? 0)} sub={`${o.activeUsers7d ?? 0} this week · ${o.dau ?? 0} today`} />
          <KPI label="Stickiness (DAU/MAU)" value={`${Math.round((o.stickiness ?? 0) * 100)}%`} sub="habitual use" />
          <KPI label="Sessions (30d)" value={fmtNum(o.sessions30d ?? 0)} sub={`${o.sessions7d ?? 0} this week`} />
          <KPI label="Success rate" value={`${o.successRate ?? 100}%`} sub="completed runs" />
          <KPI label="Cost (30d)" value={fmtMoney(o.cost30d ?? 0)} sub={`${fmtMoney(o.cost7d ?? 0)} this week`} />
          <KPI label="Organizations" value={fmtNum(o.totalOrgs ?? 0)} sub={`${o.onboardedOrgs ?? 0} onboarded · ${o.totalUsers ?? 0} users`} />
          <KPI label="Live apps" value={fmtNum(o.liveDeployments ?? 0)} sub="published & running" />
          <KPI label="Waitlist" value={fmtNum(o.leads ?? 0)} sub="leads captured" />
        </div>

        <div className="an-grid">
          <section className="an-card an-wide">
            <h3>Active users / day</h3>
            <LineChart data={(ts?.activeUsers ?? []).map((d: any) => ({ x: d.day, y: d.count }))} />
          </section>
          <section className="an-card an-wide">
            <h3>Sessions / day</h3>
            <LineChart data={(ts?.sessions ?? []).map((d: any) => ({ x: d.day, y: d.value }))} />
          </section>

          <section className="an-card">
            <h3>Acquisition funnel</h3>
            <Funnel stages={funnel} />
          </section>
          <section className="an-card">
            <h3>Feature adoption (plays)</h3>
            <BarList items={(usage?.plays ?? []).map((p: any) => ({ key: p.key, value: p.count }))} />
          </section>

          <section className="an-card">
            <h3>By mode</h3>
            <BarList items={(usage?.modes ?? []).map((p: any) => ({ key: p.key, value: p.count }))} />
          </section>
          <section className="an-card">
            <h3>By model</h3>
            <BarList items={(usage?.models ?? []).map((p: any) => ({ key: p.key, value: p.count }))} />
          </section>

          <section className="an-card">
            <h3>Quality</h3>
            <div className="an-quality">
              <div><span className="an-dot ok" /> {dones} completed</div>
              <div><span className="an-dot err" /> {errors} errored</div>
            </div>
            <BarList items={quality.map((q) => ({ key: q.status, value: q.count }))} />
          </section>
          <section className="an-card">
            <h3>Cost by model</h3>
            <BarList items={cost?.byModel ?? []} money />
          </section>

          <section className="an-card an-wide">
            <h3>Retention (signup cohorts)</h3>
            <CohortGrid rows={retention} />
          </section>

          <section className="an-card an-wide">
            <h3>Organizations</h3>
            <table className="an-table">
              <thead><tr><th>Org</th><th>Members</th><th>Sessions</th><th>Cost</th><th>Onboarded</th><th>Last active</th></tr></thead>
              <tbody>
                {orgs.map((r) => (
                  <tr key={r.id}>
                    <td>{r.name}</td>
                    <td>{r.members}</td>
                    <td>{r.sessions}</td>
                    <td>{fmtMoney(r.cost)}</td>
                    <td>{r.onboarded ? '✓' : '—'}</td>
                    <td>{ago(r.lastActive)}</td>
                  </tr>
                ))}
                {orgs.length === 0 && <tr><td colSpan={6} className="an-empty">No organizations yet.</td></tr>}
              </tbody>
            </table>
          </section>
        </div>
        <p className="an-note">Aggregate usage metadata only — never your teams' chat or document content.</p>
      </div>
    </div>
  );
}
