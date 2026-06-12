import { useState } from 'react';
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
  const upsertSession = useStore((s) => s.upsertSession);
  const setAuthed = useStore((s) => s.setAuthed);
  const toggleNav = useStore((s) => s.toggleNav);

  // On phones the sidebar is a drawer — close it after picking a session.
  const pickSession = (id: string) => {
    setActive(id);
    if (window.innerWidth <= 860) toggleNav(false);
  };
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const filtered = query.trim()
    ? sessions.filter((s) => s.title.toLowerCase().includes(query.trim().toLowerCase()))
    : sessions;

  const startRename = (e: React.MouseEvent, session: SessionMeta) => {
    e.stopPropagation();
    setEditingId(session.id);
    setDraft(session.title);
  };

  const commitRename = async (session: SessionMeta) => {
    const title = draft.trim();
    setEditingId(null);
    if (!title || title === session.title) return;
    upsertSession({ ...session, title });
    try {
      await api.patchSession(session.id, { title });
    } catch {
      /* ignore */
    }
  };

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
        <span className="spacer" style={{ flex: 1 }} />
        <button className="nav-collapse" title="Collapse sidebar" onClick={() => toggleNav(false)}>
          «
        </button>
      </div>
      <button className="nav-btn" onClick={() => { onNewSession(); if (window.innerWidth <= 860) toggleNav(false); }}>
        <span className="plus">+</span> New session
      </button>
      <div className="recents-header">
        <span>Recents</span>
      </div>
      <input
        className="search-box"
        placeholder="Search chats…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="session-list">
        {filtered.map((s) => (
          <div
            key={s.id}
            className={`session-item ${s.id === activeId ? 'active' : ''}`}
            onClick={() => pickSession(s.id)}
            title={s.title}
          >
            <StatusDot status={s.status} />
            {editingId === s.id ? (
              <input
                className="title-edit"
                value={draft}
                autoFocus
                onChange={(e) => setDraft(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onBlur={() => commitRename(s)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename(s);
                  if (e.key === 'Escape') setEditingId(null);
                }}
              />
            ) : (
              <span className="title" onDoubleClick={(e) => startRename(e, s)}>
                {s.title}
              </span>
            )}
            <button className="rename" title="Rename" onClick={(e) => startRename(e, s)}>
              ✎
            </button>
            <button className="delete" title="Delete session" onClick={(e) => handleDelete(e, s)}>
              ✕
            </button>
          </div>
        ))}
        {filtered.length === 0 && (
          <div style={{ color: 'var(--text-faint)', fontSize: 13, padding: '6px 10px' }}>
            {sessions.length === 0 ? 'No sessions yet' : 'No matches'}
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
