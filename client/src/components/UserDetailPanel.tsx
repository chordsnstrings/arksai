import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useEscClose } from '../hooks/useEscClose';
import { BarList, KPI, LineChart, ago, fmtDur, fmtMoney, fmtNum } from './analyticsCharts';

/**
 * Per-user drill-down — a metadata-only detail panel (NEVER chat/document content) opened
 * from a users/members table. Works for both the operator (no orgId) and a per-org admin
 * (orgId scopes the data to that org). Shown as a centered overlay drawer.
 */
export function UserDetailPanel({ userId, orgId, currency, onClose }: { userId: string; orgId?: string; currency?: string | null; onClose: () => void }) {
  useEscClose(onClose);
  const [u, setU] = useState<any>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    setU(null);
    setErr(false);
    api.analyticsUserDetail(userId, orgId).then(setU).catch(() => setErr(true));
  }, [userId, orgId]);

  return (
    <div className="an-drawer-backdrop" onClick={onClose}>
      <div className="an-drawer" onClick={(e) => e.stopPropagation()}>
        <header className="an-drawer-head">
          <div>
            <div className="an-kicker">Member</div>
            <h3 className="an-drawer-title">{u?.email ?? (err ? 'Unavailable' : 'Loading…')}</h3>
            {u && (
              <div className="an-drawer-meta">
                Joined {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : '—'} · last active {ago(u.lastActive)}
              </div>
            )}
          </div>
          <button className="cancel" onClick={onClose}>Close</button>
        </header>

        {err && <div className="an-empty">Couldn’t load this member’s usage.</div>}

        {u && (
          <>
            <div className="an-kpis an-kpis-4">
              <KPI label="Sessions" value={fmtNum(u.sessions ?? 0)} />
              <KPI label="Success rate" value={`${u.successRate ?? 100}%`} />
              <KPI label="Cost" value={fmtMoney(u.cost ?? 0, currency)} />
              <KPI label="Time to first build" value={fmtDur(u.timeToFirstBuildMs)} sub="from signup" />
            </div>

            <section className="an-card an-wide" style={{ marginTop: 14 }}>
              <h3>Activity / day (30d)</h3>
              <LineChart data={(u.activity ?? []).map((d: any) => ({ x: d.day, y: d.value }))} />
            </section>

            <div className="an-grid" style={{ marginTop: 14 }}>
              <section className="an-card">
                <h3>What they build (plays)</h3>
                <BarList items={(u.plays ?? []).map((p: any) => ({ key: p.key, value: p.count }))} />
              </section>
              <section className="an-card">
                <h3>By mode</h3>
                <BarList items={(u.byMode ?? []).map((p: any) => ({ key: p.key, value: p.count }))} />
              </section>
              <section className="an-card">
                <h3>By model</h3>
                <BarList items={(u.byModel ?? []).map((p: any) => ({ key: p.key, value: p.count }))} />
              </section>
              {u.orgs && (
                <section className="an-card">
                  <h3>Organizations</h3>
                  <div className="an-bars">
                    {u.orgs.map((o: any) => (
                      <div className="an-bar-row" key={o.id}>
                        <span className="an-bar-k">{o.name}</span>
                        <span className="an-bar-v" style={{ color: 'var(--text-muted)' }}>{o.role}</span>
                      </div>
                    ))}
                    {u.orgs.length === 0 && <div className="an-empty">None.</div>}
                  </div>
                </section>
              )}
            </div>
          </>
        )}
        <p className="an-note">Usage metadata only — never this member’s chat or document content.</p>
      </div>
    </div>
  );
}
