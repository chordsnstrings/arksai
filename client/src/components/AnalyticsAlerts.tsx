import { fmtMoney } from './analyticsCharts';

/**
 * Alerts card — surfaces actionable signals derived from existing metrics (no thresholds
 * stored). Platform scope: churn-risk orgs + per-org cost spikes. Org scope: this org's
 * own cost spike + members gone quiet. Renders nothing when all-clear (no noise).
 */
export function AlertsCard({ alerts, scope }: { alerts: any; scope: 'platform' | 'org' }) {
  if (!alerts) return null;

  if (scope === 'platform') {
    const churn: any[] = alerts.churnRisk ?? [];
    const spikes: any[] = alerts.costSpikes ?? [];
    if (!churn.length && !spikes.length) {
      return <div className="an-alerts ok"><span className="an-dot ok" /> All clear — no churn-risk orgs or cost spikes.</div>;
    }
    return (
      <div className="an-alerts">
        {spikes.map((s) => (
          <div className="an-alert warn" key={`spike-${s.scope}`}>
            <span className="an-alert-tag">Cost spike</span>
            <span><strong>{s.scope}</strong> spent {fmtMoney(s.recent)} in 7d — {s.ratio}× its {fmtMoney(s.baseline)}/wk baseline.</span>
          </div>
        ))}
        {churn.map((c) => (
          <div className="an-alert" key={`churn-${c.id}`}>
            <span className="an-alert-tag">Churn risk</span>
            <span><strong>{c.name}</strong> — onboarded but quiet for {c.daysSince >= 9999 ? 'a long time' : `${c.daysSince}d`}.</span>
          </div>
        ))}
      </div>
    );
  }

  // org scope
  const cs = alerts.costSpike;
  const inactive: any[] = alerts.inactiveMembers ?? [];
  if (!cs?.spiked && !inactive.length) {
    return <div className="an-alerts ok"><span className="an-dot ok" /> All clear — costs are steady and members are active.</div>;
  }
  return (
    <div className="an-alerts">
      {cs?.spiked && (
        <div className="an-alert warn">
          <span className="an-alert-tag">Cost spike</span>
          <span>Spent {fmtMoney(cs.recent)} in the last 7d — {cs.ratio}× the {fmtMoney(cs.baseline)}/wk baseline.</span>
        </div>
      )}
      {inactive.map((m) => (
        <div className="an-alert" key={`inact-${m.email}`}>
          <span className="an-alert-tag">Inactive</span>
          <span><strong>{m.email}</strong> — no activity in {m.daysSince}d.</span>
        </div>
      ))}
    </div>
  );
}
