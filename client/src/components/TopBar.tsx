import { useEffect, useState } from 'react';
import type { Deployment, SessionMeta, SessionMode } from '@shared/types';
import { useStore } from '../state/sessionStore';
import { api } from '../api/client';
import { DeploymentsDialog } from './DeploymentsDialog';

// Read-only "what ArksAI is doing right now" — it moves itself between these as the
// request needs; we just surface it so the work stays visible (no manual control).
const MODE_CHIP: Record<SessionMode, string> = { chat: 'Chat', plan: 'Planning', code: 'Building', report: 'Report' };

export function TopBar({ meta }: { meta: SessionMeta }) {
  const toggleCanvas = useStore((s) => s.toggleCanvas);
  const canvasOpen = useStore((s) => s.canvasOpen);
  const [showDeploy, setShowDeploy] = useState(false);
  const [copied, setCopied] = useState(false);
  // Once published, the button reflects it (shows the live link) instead of looking like
  // an un-published "Publish" — and the user republishes only when they've iterated.
  const [liveDep, setLiveDep] = useState<Deployment | null>(null);
  const loadDep = () => {
    api
      .listDeployments(meta.id)
      .then((ds) => setLiveDep(ds.find((d) => d.status === 'running' && (!d.expiresAt || d.expiresAt > Date.now())) ?? null))
      .catch(() => setLiveDep(null));
  };
  useEffect(loadDep, [meta.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const copyLink = () => {
    try {
      navigator.clipboard?.writeText(`${window.location.origin}/s/${meta.id}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked — the URL bar still shows /s/<id> */
    }
  };
  return (
    <header className="topbar">
      <div className="topbar-title">
        {meta.repoName && <span className="repo">{meta.repoName} /</span>}
        <span className="title" title={meta.title}>{meta.title}</span>
      </div>
      <div className="topbar-actions">
        <span className={`mode-chip mc-${meta.mode}`} title="ArksAI moves into the right skill (chat, planning, building, report, images…) automatically.">
          {MODE_CHIP[meta.mode] ?? 'Chat'}
        </span>
        {meta.branch && <span className="pill">⎇ {meta.branch}</span>}
        {meta.diffStat && (
          <span className="pill">
            <span className="add">{meta.diffStat.split(' ')[0]}</span>
            <span className="del">{meta.diffStat.split(' ')[1]}</span>
          </span>
        )}
        <button className="canvas-toggle" onClick={copyLink} title="Copy a shareable link to this chat">
          <span className="ct-ico">🔗</span>
          <span className="ct-label">{copied ? '✓ Copied' : 'Link'}</span>
        </button>
        <button
          className={`canvas-toggle ${liveDep ? 'on' : ''}`}
          onClick={() => setShowDeploy(true)}
          title={
            liveDep
              ? `Live at ${window.location.origin}${liveDep.url} — open/share the link, or republish if you've changed the app`
              : 'Publish this app to a live URL'
          }
        >
          <span className="ct-ico">{liveDep ? '🌐' : '🚀'}</span>
          <span className="ct-label">{liveDep ? 'Live' : 'Publish'}</span>
        </button>
        <button className={`canvas-toggle ${canvasOpen ? 'on' : ''}`} onClick={() => toggleCanvas()} title="Toggle the canvas preview">
          <span className="ct-ico">▦</span>
          <span className="ct-label">Canvas</span>
        </button>
      </div>
      {showDeploy && (
        <DeploymentsDialog
          meta={meta}
          onClose={() => {
            setShowDeploy(false);
            loadDep(); // reflect a fresh publish/republish in the button state
          }}
        />
      )}
    </header>
  );
}
