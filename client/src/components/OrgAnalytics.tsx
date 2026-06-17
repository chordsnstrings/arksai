import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { BarList, CohortGrid, Delta, Funnel, LineChart, Stat, ago, downloadCsv, fmtDur, fmtMoney, fmtNum, toCsv } from './analyticsCharts';
import { UserDetailPanel } from './UserDetailPanel';
import { AlertsCard } from './AnalyticsAlerts';

/**
 * Per-org analytics dashboard — the focused subset (engagement, usage, activation,
 * retention, members) for an org admin (or the operator drilling into one org). Reuses
 * the shared chart primitives + the `/api/orgs/:id/analytics/*` endpoints. METADATA ONLY
 * — never any chat or document content. Rendered inside AdminDialog's "Usage" tab.
 */
export function OrgAnalytics({ orgId }: { orgId: string }) {
  const [days, setDays] = useState(30);
  const [ov, setOv] = useState<any>(null);
  const [ts, setTs] = useState<any>(null);
  const [usage, setUsage] = useState<any>(null);
  const [funnel, setFunnel] = useState<any[]>([]);
  const [retention, setRetention] = useState<any[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any>(null);
  const [drillUser, setDrillUser] = useState<string | null>(null);

  useEffect(() => {
    if (!orgId) return;
    setOv(null);
    setDrillUser(null);
    api.analyticsOverview(orgId).then(setOv).catch(() => {});
    api.analyticsFunnel(orgId).then(setFunnel).catch(() => setFunnel([]));
    api.analyticsRetention(orgId).then(setRetention).catch(() => setRetention([]));
    api.analyticsMembers(orgId).then(setMembers).catch(() => setMembers([]));
    api.analyticsAlerts(orgId).then(setAlerts).catch(() => setAlerts(null));
  }, [orgId]);
  useEffect(() => {
    if (!orgId) return;
    api.analyticsTimeseries(days, orgId).then(setTs).catch(() => {});
    api.analyticsUsage(days, orgId).then(setUsage).catch(() => {});
  }, [orgId, days]);

  const o = ov ?? {};
  const spark = (arr: any[] | undefined, key: string) => (arr ?? []).slice(-14).map((d) => d[key]);

  return (
    <div className="an-embed">
      <div className="an-embed-head">
        <span className="an-kicker">Usage &amp; engagement</span>
        <div className="an-tabs">
          {[7, 30, 90].map((d) => (
            <button key={d} className={`an-tab ${days === d ? 'active' : ''}`} onClick={() => setDays(d)}>{d}d</button>
          ))}
        </div>
      </div>

      <AlertsCard alerts={alerts} scope="org" />

      <div className="an-strip hero">
        <Stat label="Active · 7d" value={fmtNum(o.activeUsers7d ?? 0)} delta={<Delta cur={o.activeUsers7d ?? 0} prev={o.activeUsersPrev7d} />} spark={spark(ts?.activeUsers, 'count')} />
        <Stat label="Sessions · 7d" value={fmtNum(o.sessions7d ?? 0)} delta={<Delta cur={o.sessions7d ?? 0} prev={o.sessionsPrev7d} />} spark={spark(ts?.sessions, 'value')} />
        <Stat label="Cost · 7d" value={fmtMoney(o.cost7d ?? 0)} delta={<Delta cur={o.cost7d ?? 0} prev={o.costPrev7d} invert />} spark={spark(ts?.cost, 'value')} />
        <Stat label="Success rate" value={`${o.successRate ?? 100}%`} sub="completed runs" />
        <Stat label="Members" value={fmtNum(o.members ?? members.length)} sub={`${o.liveDeployments ?? 0} live apps`} />
        <Stat label="Time to first build" value={fmtDur(o.timeToFirstBuildMs)} sub="median, from signup" />
      </div>

      <div className="an-charts">
        <section className="an-card">
          <h3>Active members / day</h3>
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
          <h3>Activation funnel</h3>
          <Funnel stages={funnel} />
        </section>
        <section className="an-card">
          <h3>What they build (plays)</h3>
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

        <section className="an-card an-wide">
          <h3>Retention (signup cohorts)</h3>
          <CohortGrid rows={retention} />
        </section>

        <section className="an-card an-wide">
          <div className="an-card-head">
            <h3>Members &amp; activity <span className="an-hint">— click a row to drill in</span></h3>
            <button
              className="an-csv"
              onClick={() =>
                downloadCsv(
                  'arksai-members.csv',
                  toCsv(
                    members.map((r) => ({ ...r, lastActive: r.lastActive ? new Date(r.lastActive).toISOString() : '' })),
                    [
                      { key: 'email', label: 'Member' },
                      { key: 'sessions', label: 'Sessions' },
                      { key: 'cost', label: 'Cost (USD)' },
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
            <thead><tr><th>Member</th><th>Sessions</th><th>Cost</th><th>Last active</th></tr></thead>
            <tbody>
              {members.map((r) => (
                <tr key={r.id} onClick={() => setDrillUser(r.id)} title="View this member's usage">
                  <td>{r.email}</td>
                  <td>{r.sessions}</td>
                  <td>{fmtMoney(r.cost)}</td>
                  <td>{ago(r.lastActive)}</td>
                </tr>
              ))}
              {members.length === 0 && <tr><td colSpan={4} className="an-empty">No members yet.</td></tr>}
            </tbody>
          </table>
        </section>
      </div>
      <p className="an-note">Aggregate usage metadata only — never your team's chat or document content.</p>
      {drillUser && <UserDetailPanel userId={drillUser} orgId={orgId} onClose={() => setDrillUser(null)} />}
    </div>
  );
}
