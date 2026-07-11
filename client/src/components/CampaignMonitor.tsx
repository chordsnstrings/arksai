import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { SocialCampaignView, SocialLeadView } from '@shared/types';
import { CampaignBrief } from './CampaignBrief';

/**
 * Campaign bot live-ops view — a card per managed campaign: status pill, spend vs cap, the
 * creative pool (live / fresh / used), leads count, the last 48h optimise time, and the
 * Approve / Pause / Resume controls. Polls while a campaign is generating so the "Generating
 * creatives → In review → Live" progression is visible without a refresh.
 */

const STATUS_META: Record<string, { label: string; tone: string }> = {
  draft: { label: 'Draft', tone: '#8a8f98' },
  generating: { label: 'Generating creatives…', tone: '#a8842c' },
  pending_approval: { label: 'Ready — needs your approval', tone: '#a8842c' },
  active: { label: 'Live', tone: '#2f7d5b' },
  paused: { label: 'Paused', tone: '#8a8f98' },
  completed: { label: 'Completed', tone: '#2f6db2' },
  failed: { label: 'Failed', tone: '#b23f2e' },
};

const ago = (ts: number | null) => {
  if (!ts) return 'never';
  const m = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
};

export function CampaignMonitor({ orgId, robotId, dailyCapUsd, defaultVertical }: { orgId: string; robotId: string; dailyCapUsd: number; defaultVertical?: string }) {
  const [campaigns, setCampaigns] = useState<SocialCampaignView[] | null>(null);
  const [leads, setLeads] = useState<SocialLeadView[]>([]);
  const [showBrief, setShowBrief] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = () => {
    api.listSocialCampaigns(orgId, robotId).then((cs) => {
      setCampaigns(cs);
      const first = cs[0];
      if (first) api.getSocialCampaign(orgId, robotId, first.id).then((d) => setLeads(d.leads)).catch(() => {});
    }).catch(() => setCampaigns([]));
  };
  useEffect(load, [orgId, robotId]);

  // Poll while anything is mid-generation so progress is visible.
  const generating = (campaigns ?? []).some((c) => c.status === 'generating');
  useEffect(() => {
    if (!generating) return;
    const t = setInterval(load, 6000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generating, orgId, robotId]);

  const act = async (cid: string, action: 'approve' | 'pause') => {
    setBusy(cid); setMsg(null);
    try {
      const r = action === 'approve'
        ? await api.approveSocialCampaign(orgId, robotId, cid)
        : await api.pauseSocialCampaign(orgId, robotId, cid);
      setMsg(r.detail);
      load();
    } catch (e: any) {
      setMsg(e?.message || 'Action failed.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="soc-campaigns">
      <div className="soc-head-row">
        <div>
          <h3 style={{ margin: 0 }}>Ad campaigns</h3>
          <p className="soc-sub" style={{ margin: '2px 0 0' }}>
            Brief it once — it generates the creatives, launches within your caps, rebalances every 48h,
            and answers comments &amp; DMs on its own ads.
          </p>
        </div>
        {!showBrief && <button className="soc-btn" onClick={() => setShowBrief(true)}>New campaign</button>}
      </div>

      {showBrief && (
        <div className="soc-card" style={{ marginTop: 10 }}>
          <h4>New campaign brief</h4>
          <CampaignBrief
            orgId={orgId} robotId={robotId} dailyCapUsd={dailyCapUsd} defaultVertical={defaultVertical}
            onStarted={() => { setShowBrief(false); setMsg('Campaign started — generating creatives now.'); load(); }}
            onCancel={() => setShowBrief(false)}
          />
        </div>
      )}
      {msg && <p className="soc-msg ok" role="status">{msg}</p>}

      {campaigns === null ? (
        <p className="soc-sub" style={{ marginTop: 10 }}>Loading…</p>
      ) : campaigns.length === 0 && !showBrief ? (
        <p className="soc-sub" style={{ marginTop: 10 }}>
          No campaigns yet. Hit <strong>New campaign</strong>, say what you're promoting and what outcome you
          want — the robot does the rest.
        </p>
      ) : (
        campaigns.map((c) => {
          const st = STATUS_META[c.status] ?? STATUS_META.draft;
          const pool = c.creativePool ?? [];
          const live = pool.filter((p) => p.live).length;
          const fresh = pool.filter((p) => !p.used).length;
          const cap = c.budgetModel === 'lifetime' ? (c.totalCapUsd ?? 0) : (c.dailyCapUsd ?? 0);
          const pct = c.totalCapUsd ? Math.min(100, (c.spentUsd / c.totalCapUsd) * 100) : 0;
          const myLeads = leads.filter((l) => l.campaignId === c.id);
          return (
            <div key={c.id} className="soc-camp-card">
              <div className="soc-camp-top">
                <strong>{c.name}</strong>
                <span className="soc-pill" style={{ ['--tone' as any]: st.tone }}>{st.label}</span>
              </div>
              <div className="soc-camp-meta">
                <span>Goal: {c.objective}</span>
                <span>{c.budgetModel === 'lifetime' ? `$${c.totalCapUsd ?? 0} total` : `$${c.dailyCapUsd ?? 0}/day`}</span>
                <span>Creatives: {pool.length} in pool · {live} live · {fresh} fresh</span>
                {c.objective === 'leads' && <span>Leads: {myLeads.length}</span>}
                <span>Last rebalance: {ago(c.lastOptimizedAt)}</span>
              </div>
              {c.totalCapUsd != null && c.totalCapUsd > 0 && (
                <div className="soc-spend" title={`$${c.spentUsd.toFixed(2)} of $${cap}`}>
                  <div style={{ width: `${pct}%` }} />
                </div>
              )}
              <div className="soc-actions" style={{ marginTop: 8 }}>
                {c.status === 'pending_approval' && (
                  <button className="soc-btn" disabled={busy === c.id} onClick={() => act(c.id, 'approve')}>
                    {busy === c.id ? 'Launching…' : 'Approve & launch'}
                  </button>
                )}
                {c.status === 'active' && (
                  <button className="soc-btn ghost" disabled={busy === c.id} onClick={() => act(c.id, 'pause')}>
                    {busy === c.id ? 'Pausing…' : 'Pause'}
                  </button>
                )}
                {c.status === 'paused' && (
                  <button className="soc-btn" disabled={busy === c.id} onClick={() => act(c.id, 'approve')}>
                    {busy === c.id ? 'Resuming…' : 'Resume'}
                  </button>
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
