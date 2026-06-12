import type { SessionMeta, SessionStatus } from '@shared/types';
import { api } from '../api/client';
import { useStore } from '../state/sessionStore';

function StatusDot({ status }: { status: SessionStatus }) {
  return <span className={`status-dot ${status}`} />;
}

export function Sidebar({ onNewSession }: { onNewSession: () => void }) {
  const sessions = useStore((s) => s.sessions);
  const activeId = useStore((s) => s.activeId);
  const setActive = useStore((s) => s.setActive);
  const removeSession = useStore((s) => s.removeSession);
  const setAuthed = useStore((s) => s.setAuthed);

  const handleDelete = async (e: React.MouseEvent, session: SessionMeta) => {
    e.stopPropagation();
    if (!confirm(`Delete session "${session.title}" and its workspace?`)) return;
    try {
      await api.deleteSession(session.id);
    } catch {
      /* already gone */
    }
    removeSession(session.id);
  };

  return (
    <aside className="sidebar">
      <div className="wordmark">
        <span className="logo-mark sm" />
        <span className="name">ArksAI</span>
        <span className="badge">studio</span>
      </div>
      <button className="nav-btn" onClick={onNewSession}>
        <span className="plus">+</span> New session
      </button>
      <div className="recents-header">
        <span>Recents</span>
      </div>
      <div className="session-list">
        {sessions.map((s) => (
          <div
            key={s.id}
            className={`session-item ${s.id === activeId ? 'active' : ''}`}
            onClick={() => setActive(s.id)}
            title={s.title}
          >
            <StatusDot status={s.status} />
            <span className="title">{s.title}</span>
            <button className="delete" title="Delete session" onClick={(e) => handleDelete(e, s)}>
              ✕
            </button>
          </div>
        ))}
        {sessions.length === 0 && (
          <div style={{ color: 'var(--text-faint)', fontSize: 13, padding: '6px 10px' }}>
            No sessions yet
          </div>
        )}
      </div>
      <div className="sidebar-footer">
        <span>arksai · self-hosted</span>
        <button
          onClick={async () => {
            await api.logout();
            setAuthed(false);
          }}
        >
          Log out
        </button>
      </div>
    </aside>
  );
}
