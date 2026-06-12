import type { SessionMeta } from '@shared/types';
import { useStore } from '../state/sessionStore';

export function TopBar({ meta }: { meta: SessionMeta }) {
  const toggleCanvas = useStore((s) => s.toggleCanvas);
  const canvasOpen = useStore((s) => s.canvasOpen);
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
      <span className="spacer" />
      {meta.branch && <span className="pill">⎇ {meta.branch}</span>}
      {meta.diffStat && (
        <span className="pill">
          <span className="add">{meta.diffStat.split(' ')[0]}</span>
          <span className="del">{meta.diffStat.split(' ')[1]}</span>
        </span>
      )}
      <button className={`canvas-toggle ${canvasOpen ? 'on' : ''}`} onClick={() => toggleCanvas()}>
        ▦ Canvas
      </button>
    </header>
  );
}
