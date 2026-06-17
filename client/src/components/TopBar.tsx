import { useState } from 'react';
import type { SessionMeta, SessionMode } from '@shared/types';
import { useStore } from '../state/sessionStore';
import { DeploymentsDialog } from './DeploymentsDialog';

// Read-only "what ArksAI is doing right now" — it moves itself between these as the
// request needs; we just surface it so the work stays visible (no manual control).
const MODE_CHIP: Record<SessionMode, string> = { chat: 'Chat', plan: 'Planning', code: 'Building', report: 'Report' };

export function TopBar({ meta }: { meta: SessionMeta }) {
  const toggleCanvas = useStore((s) => s.toggleCanvas);
  const canvasOpen = useStore((s) => s.canvasOpen);
  const [showDeploy, setShowDeploy] = useState(false);
  return (
    <header className="topbar">
      {meta.repoName ? (
        <>
          <span className="repo">{meta.repoName} /</span>
          <span className="title">{meta.title}</span>
        </>
      ) : (
        <span className="title">{meta.title}</span>
      )}
      <span className={`mode-chip ${meta.mode}`} title="ArksAI moves into the right skill (chat, planning, building, report, images…) automatically.">
        {MODE_CHIP[meta.mode] ?? 'Chat'}
      </span>
      <span className="spacer" />
      {meta.branch && <span className="pill">⎇ {meta.branch}</span>}
      {meta.diffStat && (
        <span className="pill">
          <span className="add">{meta.diffStat.split(' ')[0]}</span>
          <span className="del">{meta.diffStat.split(' ')[1]}</span>
        </span>
      )}
      <button className="canvas-toggle" onClick={() => setShowDeploy(true)} title="Publish this app to a live URL">
        🚀 Publish
      </button>
      <button className={`canvas-toggle ${canvasOpen ? 'on' : ''}`} onClick={() => toggleCanvas()}>
        ▦ Canvas
      </button>
      {showDeploy && <DeploymentsDialog meta={meta} onClose={() => setShowDeploy(false)} />}
    </header>
  );
}
