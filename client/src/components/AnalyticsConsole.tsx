import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useEscClose } from '../hooks/useEscClose';
import { BarList, CohortGrid, Delta, Funnel, LineChart, Stat, ago, downloadCsv, fmtDur, fmtMoney, fmtNum, toCsv } from './analyticsCharts';
import { UserDetailPanel } from './UserDetailPanel';
import { AlertsCard } from './AnalyticsAlerts';

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
  const [users, setUsers] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any>(null);
  const [digests, setDigests] = useState<any[]>([]);
  const [drillUser, setDrillUser] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ items: any[]; summary: { up: number; down: number; openComplaints: number } } | null>(null);
  const loadFeedback = () => api.adminFeedback().then(setFeedback).catch(() => {});

  useEffect(() => {
    api.analyticsOverview().then(setOv).catch(() => {});
    api.analyticsFunnel().then(setFunnel).catch(() => {});
    api.analyticsRetention().then(setRetention).catch(() => {});
    api.analyticsOrgs().then(setOrgs).catch(() => {});
    api.analyticsUsers().then(setUsers).catch(() => {});
    api.analyticsAlerts().then(setAlerts).catch(() => {});
    api.analyticsDigests().then(setDigests).catch(() => {});
    loadFeedback();
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
  const spark = (arr: any[] | undefined, key: string) => (arr ?? []).slice(-14).map((d) => d[key]);
  const asOf = new Date().toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

  return (
    <div className="an-view">
      <header className="an-head">
        <div>
          <div className="an-kicker">Platform analytics · as of {asOf}</div>
          <h1 className="an-title">How ArksAI is being used</h1>
        </div>
        <div className="an-head-right">
          <div className="an-tabs">
            {[7, 30, 90].map((d) => (
              <button key={d} className={`an-tab ${days === d ? 'active' : ''}`} onClick={() => setDays(d)}>{d}d</button>
            ))}
          </div>
          <button className="cancel" onClick={onClose}>Close</button>
        </div>
      </header>

      <div className="an-body">
        <AlertsCard alerts={alerts} scope="platform" />

        <div className="an-strip hero">
          <Stat label="Active users · 7d" value={fmtNum(o.activeUsers7d ?? 0)} delta={<Delta cur={o.activeUsers7d ?? 0} prev={o.activeUsersPrev7d} />} spark={spark(ts?.activeUsers, 'count')} />
          <Stat label="Sessions · 7d" value={fmtNum(o.sessions7d ?? 0)} delta={<Delta cur={o.sessions7d ?? 0} prev={o.sessionsPrev7d} />} spark={spark(ts?.sessions, 'value')} />
          <Stat label="Cost · 7d" value={fmtMoney(o.cost7d ?? 0)} delta={<Delta cur={o.cost7d ?? 0} prev={o.costPrev7d} invert />} spark={spark(ts?.cost, 'value')} />
          <Stat label="Success rate" value={`${o.successRate ?? 100}%`} sub={`${dones} done · ${errors} errored`} />
          <Stat label="Stickiness" value={`${Math.round((o.stickiness ?? 0) * 100)}%`} sub="DAU / MAU" />
          <Stat label="Time to first build" value={fmtDur(o.timeToFirstBuildMs)} sub={`median · ${o.activatedUsers ?? 0} activated`} />
        </div>

        <div className="an-strip sub">
          <Stat label="Active · 30d" value={fmtNum(o.activeUsers30d ?? 0)} sub={`${o.dau ?? 0} today`} />
          <Stat label="Sessions · 30d" value={fmtNum(o.sessions30d ?? 0)} sub={`${fmtMoney(o.cost30d ?? 0)} cost`} />
          <Stat label="Organizations" value={fmtNum(o.totalOrgs ?? 0)} sub={`${o.onboardedOrgs ?? 0} onboarded`} />
          <Stat label="Users" value={fmtNum(o.totalUsers ?? 0)} sub="accounts" />
          <Stat label="Live apps" value={fmtNum(o.liveDeployments ?? 0)} sub="running" />
          <Stat label="Waitlist" value={fmtNum(o.leads ?? 0)} sub="leads" />
        </div>

        <div className="an-charts">
          <section className="an-card">
            <h3>Active users / day</h3>
            <LineChart data={(ts?.activeUsers ?? []).map((d: any) => ({ x: d.day, y: d.count }))} />
          </section>
          <section className="an-card">
            <h3>Sessions / day</h3>
            <LineChart data={(ts?.sessions ?? []).map((d: any) => ({ x: d.day, y: d.value }))} />
          </section>
          <section className="an-card">
            <h3>Cost / day</h3>
            <LineChart data={(ts?.cost ?? []).map((d: any) => ({ x: d.day, y: d.value }))} fmt={fmtMoney} />
          </section>
        </div>

        <div className="an-grid">
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
            <div className="an-card-head">
              <h3>
                What users said
                {feedback && (
                  <span className="an-fb-sum">
                    {' '}· {feedback.summary.up}👍 {feedback.summary.down}👎
                    {feedback.summary.openComplaints ? ` · ${feedback.summary.openComplaints} open` : ''}
                  </span>
                )}
              </h3>
            </div>
            <div className="an-fb-list">
              {(feedback?.items ?? [])
                .filter((f) => f.rating === 'down')
                .slice(0, 14)
                .map((f) => (
                  <div key={f.id} className={`an-fb-row ${f.status}`}>
                    <span className="an-fb-tag">
                      {f.meta?.deliverableKind ?? f.kind}
                      {f.meta?.name ? ` · ${f.meta.name}` : ''}
                    </span>
                    <span className="an-fb-text">{f.complaint || '(no detail given)'}</span>
                    {f.status === 'new' && (
                      <button
                        className="an-fb-x"
                        title="Mark reviewed"
                        onClick={() => api.setFeedbackStatus(f.id, 'reviewed').then(loadFeedback).catch(() => {})}
                      >
                        ✓
                      </button>
                    )}
                  </div>
                ))}
              {feedback && feedback.items.filter((f) => f.rating === 'down').length === 0 && (
                <div className="an-fb-empty">No complaints yet — all clear.</div>
              )}
            </div>
          </section>

          <section className="an-card an-wide">
            <h3>Retention (signup cohorts)</h3>
            <CohortGrid rows={retention} />
          </section>

          <section className="an-card an-wide">
            <div className="an-card-head">
              <h3>Organizations</h3>
              <button
                className="an-csv"
                onClick={() =>
                  downloadCsv(
                    'arksai-orgs.csv',
                    toCsv(
                      orgs.map((r) => ({ ...r, lastActive: r.lastActive ? new Date(r.lastActive).toISOString() : '', onboarded: r.onboarded ? 'yes' : 'no' })),
                      [
                        { key: 'name', label: 'Organization' },
                        { key: 'members', label: 'Members' },
                        { key: 'sessions', label: 'Sessions' },
                        { key: 'cost', label: 'Cost (USD)' },
                        { key: 'onboarded', label: 'Onboarded' },
                        { key: 'lastActive', label: 'Last active' },
                      ],
                    ),
                  )
                }
              >
                ↓ CSV
              </button>
            </div>
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

          <section className="an-card an-wide">
            <div className="an-card-head">
              <h3>Users <span className="an-hint">— click a row to drill in</span></h3>
              <button
                className="an-csv"
                onClick={() =>
                  downloadCsv(
                    'arksai-users.csv',
                    toCsv(
                      users.map((r) => ({ ...r, lastActive: r.lastActive ? new Date(r.lastActive).toISOString() : '', createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : '' })),
                      [
                        { key: 'email', label: 'Email' },
                        { key: 'sessions', label: 'Sessions' },
                        { key: 'cost', label: 'Cost (USD)' },
                        { key: 'createdAt', label: 'Joined' },
                        { key: 'lastActive', label: 'Last active' },
                      ],
                    ),
                  )
                }
              >
                ↓ CSV
              </button>
            </div>
            <table className="an-table an-table-click">
              <thead><tr><th>User</th><th>Sessions</th><th>Cost</th><th>Joined</th><th>Last active</th></tr></thead>
              <tbody>
                {users.slice(0, 100).map((r) => (
                  <tr key={r.id} onClick={() => setDrillUser(r.id)} title="View this user's usage">
                    <td>{r.email}</td>
                    <td>{r.sessions}</td>
                    <td>{fmtMoney(r.cost)}</td>
                    <td>{r.createdAt ? new Date(r.createdAt).toLocaleDateString() : '—'}</td>
                    <td>{ago(r.lastActive)}</td>
                  </tr>
                ))}
                {users.length === 0 && <tr><td colSpan={5} className="an-empty">No users yet.</td></tr>}
              </tbody>
            </table>
          </section>

          <section className="an-card an-wide">
            <h3>Scheduled digests</h3>
            {digests.length === 0 ? (
              <div className="an-empty">No digests yet — the first snapshot generates automatically.</div>
            ) : (
              <table className="an-table">
                <thead><tr><th>When</th><th>Active (7d)</th><th>Sessions (7d)</th><th>Cost (7d)</th><th>Success</th><th>Alerts</th></tr></thead>
                <tbody>
                  {digests.map((d) => {
                    const s = d.summary ?? {};
                    const dl = s.deltas;
                    const delta = (n?: number) => (n == null || n === 0 ? '' : n > 0 ? ` ▲${n}` : ` ▼${Math.abs(n)}`);
                    return (
                      <tr key={d.id}>
                        <td>{new Date(d.generatedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                        <td>{fmtNum(s.activeUsers7d ?? 0)}{delta(dl?.activeUsers7d)}</td>
                        <td>{fmtNum(s.sessions7d ?? 0)}{delta(dl?.sessions7d)}</td>
                        <td>{fmtMoney(s.cost7d ?? 0)}</td>
                        <td>{s.successRate ?? 100}%</td>
                        <td>{(s.churnRisk ?? 0) + (s.costSpikes ?? 0) > 0 ? <span className="an-pill warn">{(s.churnRisk ?? 0) + (s.costSpikes ?? 0)}</span> : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
        </div>
        <p className="an-note">Aggregate usage metadata only — never your teams' chat or document content.</p>
      </div>
      {drillUser && <UserDetailPanel userId={drillUser} onClose={() => setDrillUser(null)} />}
    </div>
  );
}
