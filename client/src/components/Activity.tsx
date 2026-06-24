import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useStore } from '../state/sessionStore';
import { failedDeployments, delivered } from '../lib/activity';
import { money } from '../lib/money';

/**
 * The unified activity feed (/activity) — the single tended inbox for everything the platform
 * does in the background: robot replies awaiting approval, failed publishes, a low wallet
 * (Needs you), and finished scheduled runs (Delivered). Reached from the sidebar; a real
 * shareable surface that follows the same URL pattern as Robots (back/forward aware).
 */
export function Activity({
  onClose,
  onDeployments,
  onAdmin,
}: {
  onClose: () => void;
  onDeployments: () => void;
  onAdmin: () => void;
}) {
  const me = useStore((s) => s.me);
  const sessions = useStore((s) => s.sessions);
  const home = useStore((s) => s.home);
  const setHome = useStore((s) => s.setHome);
  const setActive = useStore((s) => s.setActive);
  const markActivitySeen = useStore((s) => s.markActivitySeen);
  const [tab, setTab] = useState<'needs' | 'delivered'>('needs');
  const [busy, setBusy] = useState<string | null>(null);

  const orgId = me?.currentOrg ?? null;
  const refresh = () => api.getHome().then(setHome).catch(() => {});

  useEffect(() => {
    refresh();
    markActivitySeen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const drafts = home?.pendingDrafts ?? [];
  const failed = failedDeployments(home);
  const lowWallet = me?.wallet?.lowBalance ? me.wallet : null;
  const deliveries = delivered(sessions);
  const needsCount = drafts.length + failed.length + (lowWallet ? 1 : 0);

  const act = async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id);
    try {
      await fn();
    } finally {
      await refresh();
      setBusy(null);
    }
  };

  const openSession = (id: string) => {
    setActive(id);
    onClose();
  };

  return (
    <div className="fullpage activity">
      <div className="fp-inner">
      <div className="fp-head">
        <div>
          <div className="fp-kicker">Activity</div>
          <h1 className="fp-title">What needs you, and what’s been delivered</h1>
        </div>
        <button className="fp-close" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="act-tabs">
        <button className={`act-tab ${tab === 'needs' ? 'on' : ''}`} onClick={() => setTab('needs')}>
          Needs you {needsCount > 0 && <span className="act-count">{needsCount}</span>}
        </button>
        <button className={`act-tab ${tab === 'delivered' ? 'on' : ''}`} onClick={() => setTab('delivered')}>
          Delivered {deliveries.length > 0 && <span className="act-count subtle">{deliveries.length}</span>}
        </button>
      </div>

      {tab === 'needs' ? (
        <div className="act-list">
          {needsCount === 0 && <div className="act-empty">All clear — nothing needs you right now.</div>}

          {lowWallet && (
            <div className="act-item wallet">
              <div className="act-item-main">
                <div className="act-item-title">{lowWallet.balanceUsd <= 0 ? 'Out of credit' : 'Low balance'}</div>
                <div className="act-item-sub">
                  {lowWallet.balanceUsd <= 0 ? 'Top up the wallet to keep building.' : `${money(lowWallet.balanceUsd)} left — top up soon.`}
                </div>
              </div>
              <div className="act-item-actions">
                <button className="act-btn" onClick={onAdmin}>
                  Top up
                </button>
              </div>
            </div>
          )}

          {drafts.map((d) => (
            <div key={d.id} className="act-item draft">
              <div className="act-item-main">
                <div className="act-item-title">
                  Reply to {d.inboundName || d.inboundFrom}
                  {d.inboundSubject ? ` · ${d.inboundSubject}` : ''}
                </div>
                <div className="act-item-sub">
                  {d.escalated ? `Flagged: ${d.escalationReason || 'needs a human'}` : d.draftText.slice(0, 140)}
                </div>
              </div>
              <div className="act-item-actions">
                <button
                  className="act-btn primary"
                  disabled={!orgId || busy === d.id}
                  onClick={() => orgId && act(d.id, () => api.sendDraft(orgId, d.id))}
                >
                  {busy === d.id ? '…' : 'Approve & send'}
                </button>
                <button
                  className="act-btn"
                  disabled={!orgId || busy === d.id}
                  onClick={() => orgId && act(d.id, () => api.dismissDraft(orgId, d.id))}
                >
                  Dismiss
                </button>
              </div>
            </div>
          ))}

          {failed.map((dep) => (
            <div key={dep.slug} className="act-item failed">
              <div className="act-item-main">
                <div className="act-item-title">“{dep.name}” didn’t publish</div>
                <div className="act-item-sub">The live link hit a snag — open it to fix &amp; republish.</div>
              </div>
              <div className="act-item-actions">
                <button className="act-btn" onClick={() => openSession(dep.sessionId)}>
                  Open chat
                </button>
                <button className="act-btn" onClick={onDeployments}>
                  Manage
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="act-list">
          {deliveries.length === 0 && <div className="act-empty">No scheduled deliveries yet.</div>}
          {deliveries.map((d) => (
            <button key={d.id} className="act-item delivered" onClick={() => openSession(d.id)}>
              <div className="act-item-main">
                <div className="act-item-title">✓ {d.title}</div>
                <div className="act-item-sub">Scheduled delivery — open to view.</div>
              </div>
              <span className="act-open">Open →</span>
            </button>
          ))}
        </div>
      )}
      </div>
    </div>
  );
}
