import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { CampaignEngineState, SocialCampaignView, SocialLeadView } from '@shared/types';
import { CampaignBrief } from './CampaignBrief';

const engineState = (c: SocialCampaignView): CampaignEngineState => (c.funnel ?? {}) as CampaignEngineState;

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
        campaigns.map((c) => (
          <CampaignCard
            key={c.id} c={c} leads={leads.filter((l) => l.campaignId === c.id)}
            busy={busy === c.id} onAct={(a) => act(c.id, a)} orgId={orgId} robotId={robotId}
          />
        ))
      )}
    </div>
  );
}

/** One campaign's card: status + spend + pool + THE BRAIN'S TRANSPARENCY — the benchmark
 *  readout, the last decision in plain English, the "Robot's log", and (for a campaign
 *  awaiting approval) the full review panel: creatives, sample copy, the plan, the trust line. */
function CampaignCard({ c, leads, busy, onAct, orgId, robotId }: {
  c: SocialCampaignView; leads: SocialLeadView[]; busy: boolean;
  onAct: (a: 'approve' | 'pause') => void; orgId: string; robotId: string;
}) {
  const st = STATUS_META[c.status] ?? STATUS_META.draft;
  const es = engineState(c);
  const pool = c.creativePool ?? [];
  const live = pool.filter((p) => p.live).length;
  const fresh = pool.filter((p) => !p.used).length;
  const cap = c.budgetModel === 'lifetime' ? (c.totalCapUsd ?? 0) : (c.dailyCapUsd ?? 0);
  const pct = c.totalCapUsd ? Math.min(100, (c.spentUsd / c.totalCapUsd) * 100) : 0;
  const [showReview, setShowReview] = useState(c.status === 'pending_approval');
  const [showLog, setShowLog] = useState(false);
  useEffect(() => { if (c.status === 'pending_approval') setShowReview(true); }, [c.status]);

  const target = c.brief?.targetCprUsd;
  const cpr = es.lastCprUsd;
  const noun = c.objective === 'leads' ? 'lead' : c.objective === 'messages' ? 'chat' : c.objective === 'sales' ? 'sale' : 'visit';
  // Line A — cost vs the user's target (preferred) or own history; amber, never red.
  const lineA = cpr != null
    ? target
      ? cpr <= target
        ? <span>Cost per {noun}: <strong>${cpr}</strong> — your target ${target} <span className="soc-ok">✓ beating it</span></span>
        : cpr <= target * 1.3
          ? <span>Cost per {noun}: <strong>${cpr}</strong> — your target ${target} · within reach</span>
          : <span>Cost per {noun}: <strong>${cpr}</strong> — <span className="soc-warn">running above your ${target} target — the robot is rotating harder</span></span>
      : <span>Cost per {noun}: <strong>${cpr}</strong> — judged against this campaign's own history</span>
    : null;
  const lastDecision = es.decisions?.[0];

  return (
    <div className="soc-camp-card">
      <div className="soc-camp-top">
        <strong>{c.name}</strong>
        <span className="soc-pill" style={{ ['--tone' as any]: st.tone }}>{st.label}</span>
      </div>
      {c.status === 'paused' && es.statusReason && (
        <p className="soc-sub" style={{ margin: '2px 0 0' }}>{es.statusReason}</p>
      )}
      <div className="soc-camp-meta">
        <span>Goal: {c.objective}</span>
        <span>{c.budgetModel === 'lifetime' ? `$${c.totalCapUsd ?? 0} total` : `$${c.dailyCapUsd ?? 0}/day`}</span>
        <span>Creatives: {pool.length} in pool · {live} live · {fresh} fresh</span>
        {c.objective === 'leads' && <span>Leads: {leads.length}</span>}
      </div>
      {lineA && <p className="soc-readout" style={{ margin: '7px 0 0' }}>{lineA}</p>}
      <p className="soc-sub" style={{ margin: '5px 0 0' }}>
        {lastDecision
          ? <>{ago(lastDecision.at)}: {lastDecision.summary}</>
          : <>Last rebalance: {ago(c.lastOptimizedAt)}</>}
        {(es.decisions?.length ?? 0) > 1 && (
          <> · <button className="soc-brain-fix" onClick={() => setShowLog((s) => !s)}>{showLog ? 'Hide log' : "Robot's log"}</button></>
        )}
      </p>
      {showLog && (
        <ul className="soc-log">
          {(es.decisions ?? []).slice(0, 10).map((d, i) => (
            <li key={i}><span className="soc-log-when">{ago(d.at)}</span>{d.summary}</li>
          ))}
        </ul>
      )}
      {c.totalCapUsd != null && c.totalCapUsd > 0 && (
        <div className="soc-spend" title={`$${c.spentUsd.toFixed(2)} of $${cap}`}>
          <div style={{ width: `${pct}%` }} />
        </div>
      )}

      {/* THE REVIEW PANEL — what the brain made, before (or after) it runs. */}
      {c.status !== 'pending_approval' && pool.length > 0 && !showReview && (
        <button className="soc-brain-fix" style={{ marginTop: 8 }} onClick={() => setShowReview(true)}>See what it made</button>
      )}
      {showReview && pool.length > 0 && (
        <div className="soc-review">
          <div className="soc-review-strip">
            {pool.slice(0, 5).map((p, i) => (
              <img key={i} src={`/api/orgs/${orgId}/robots/${robotId}/campaigns/${c.id}/creatives/${i}`} alt={p.headline || `creative ${i + 1}`} loading="lazy" />
            ))}
            {pool.length > 5 && <span className="soc-chip">+{pool.length - 5} more in the pool</span>}
          </div>
          {(es.copySamples?.length ?? 0) > 0 && (
            <div className="soc-review-copy">
              <p className="soc-sub" style={{ margin: '0 0 6px' }}>
                {pool.length} ads written in different styles — Meta finds the winners, the robot retires the losers.
              </p>
              {es.copySamples!.map((s, i) => (
                <div key={i} className="soc-review-sample">
                  <span className="soc-chip">{s.angle}</span>
                  <div><strong>{s.headline}</strong><br /><span className="soc-sub">{s.body}</span></div>
                </div>
              ))}
            </div>
          )}
          {es.funnelSummary && <p className="soc-sub" style={{ margin: '8px 0 0' }}>{es.funnelSummary}</p>}
          {target && <p className="soc-sub" style={{ margin: '4px 0 0' }}>Aiming at <strong>${target}</strong> per {noun} — the robot rebalances every 48h toward it.</p>}
          {es.qc && es.qc.checksRun > 0 && (
            <p className="soc-sub soc-trust" style={{ margin: '6px 0 0' }}>
              Every ad passed {es.qc.checksRun} honesty &amp; Meta-compliance checks
              {es.qc.draftsRejected > 0 && <> — {es.qc.draftsRejected} draft{es.qc.draftsRejected === 1 ? ' was' : 's were'} rejected and rewritten before you saw them</>}.
            </p>
          )}
        </div>
      )}

      <div className="soc-actions" style={{ marginTop: 8 }}>
        {c.status === 'pending_approval' && (
          <button className="soc-btn" disabled={busy} onClick={() => onAct('approve')}>
            {busy ? 'Launching…' : 'Approve & launch'}
          </button>
        )}
        {c.status === 'active' && (
          <button className="soc-btn ghost" disabled={busy} onClick={() => onAct('pause')}>
            {busy ? 'Pausing…' : 'Pause'}
          </button>
        )}
        {c.status === 'paused' && (
          <button className="soc-btn" disabled={busy} onClick={() => onAct('approve')}>
            {busy ? 'Resuming…' : 'Resume'}
          </button>
        )}
      </div>
    </div>
  );
}
