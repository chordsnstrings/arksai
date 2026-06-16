import { useState } from 'react';
import type { Project, SessionMeta, SessionStatus } from '@shared/types';
import { api } from '../api/client';
import { useStore } from '../state/sessionStore';
import { isDark, toggleTheme } from '../lib/theme';

function StatusDot({ status }: { status: SessionStatus }) {
  return <span className={`status-dot ${status}`} />;
}

/** Optional manual light/dark switch (top-left, after the logo). Overrides the dept theme. */
function ThemeToggle() {
  const [dark, setDark] = useState<boolean>(() => isDark());
  return (
    <button
      className="theme-toggle"
      title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label="Toggle light or dark theme"
      onClick={() => setDark(toggleTheme())}
    >
      {dark ? (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
        </svg>
      ) : (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
    </button>
  );
}

export function Sidebar({
  onNewSession,
  onNewProject,
  onEditProject,
  onSchedules,
  onAdmin,
}: {
  onNewSession: (projectId?: string) => void;
  onNewProject: () => void;
  onEditProject: (p: Project) => void;
  onSchedules: () => void;
  onAdmin: () => void;
}) {
  const sessions = useStore((s) => s.sessions);
  const projects = useStore((s) => s.projects);
  const activeId = useStore((s) => s.activeId);
  const setActive = useStore((s) => s.setActive);
  const removeSession = useStore((s) => s.removeSession);
  const upsertSession = useStore((s) => s.upsertSession);
  const setAuthed = useStore((s) => s.setAuthed);
  const toggleNav = useStore((s) => s.toggleNav);
  const me = useStore((s) => s.me);

  const pickSession = (id: string) => {
    setActive(id);
    if (window.innerWidth <= 860) toggleNav(false);
  };
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const q = query.trim().toLowerCase();
  const match = (s: SessionMeta) => !q || s.title.toLowerCase().includes(q);
  const visible = sessions.filter(match);
  const ungrouped = visible.filter((s) => !s.projectId);

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
    } catch {}
  };
  const handleDelete = async (e: React.MouseEvent, session: SessionMeta) => {
    e.stopPropagation();
    if (!confirm(`Delete session "${session.title}" and its workspace?`)) return;
    try {
      await api.deleteSession(session.id);
    } catch {}
    removeSession(session.id);
  };
  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const sessionRow = (s: SessionMeta) => (
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
  );

  return (
    <aside className="sidebar">
      <div className="wordmark">
        <span className="logo-mark sm" />
        <span className="name">ArksAI</span>
        <span className="badge">studio</span>
        <ThemeToggle />
        <span className="spacer" style={{ flex: 1 }} />
        <button className="nav-collapse" title="Collapse sidebar" onClick={() => toggleNav(false)}>
          «
        </button>
      </div>
      <button
        className="nav-btn"
        onClick={() => {
          onNewSession();
          if (window.innerWidth <= 860) toggleNav(false);
        }}
      >
        <span className="plus">+</span> New session
      </button>
      <button className="nav-btn subtle" onClick={onNewProject}>
        <span className="plus">▤</span> New project
      </button>
      <button className="nav-btn subtle" onClick={onSchedules}>
        <span className="plus">⏱</span> Scheduled
      </button>
      {(me?.isSuperadmin || me?.role === 'admin') && (
        <button className="nav-btn subtle" onClick={onAdmin}>
          <span className="plus">▦</span> {me?.isSuperadmin ? 'Admin' : 'Members'}
        </button>
      )}

      <input
        className="search-box"
        placeholder="Search chats…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <div className="session-list">
        {/* Projects */}
        {projects.map((p) => {
          const own = visible.filter((s) => s.projectId === p.id);
          const open = !collapsed.has(p.id);
          return (
            <div key={p.id} className="project-group">
              <div className="project-head" onClick={() => toggle(p.id)} title={p.name}>
                <span className={`caret ${open ? 'open' : ''}`}>▸</span>
                <span className="project-name">{p.name}</span>
                <span className="project-count">{p.sessionCount}</span>
                <button
                  className="proj-act"
                  title="New session in this project"
                  onClick={(e) => {
                    e.stopPropagation();
                    onNewSession(p.id);
                  }}
                >
                  +
                </button>
                <button
                  className="proj-act"
                  title="Project settings"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEditProject(p);
                  }}
                >
                  ⚙
                </button>
              </div>
              {open && (
                <div className="project-sessions">
                  {own.map(sessionRow)}
                  {own.length === 0 && <div className="proj-empty">No sessions yet</div>}
                </div>
              )}
            </div>
          );
        })}

        {/* Ungrouped */}
        <div className="recents-header">
          <span>{projects.length ? 'Recents' : 'Recents'}</span>
        </div>
        {ungrouped.map(sessionRow)}
        {ungrouped.length === 0 && projects.length === 0 && (
          <div style={{ color: 'var(--text-faint)', fontSize: 13, padding: '6px 10px' }}>
            {sessions.length === 0 ? 'No sessions yet' : 'No matches'}
          </div>
        )}
      </div>

      <div className="sidebar-footer">
        {/* A company's workspace is its OWN and is NOT swappable. Only the platform
            operator (super-admin), who provisions/supports every org, can switch
            workspaces; everyone else sees their single org as static text. */}
        {me && me.isSuperadmin && me.orgs.length > 1 ? (
          <select
            className="org-switcher"
            title="Operator: switch workspace"
            value={me.currentOrg ?? ''}
            onChange={async (e) => {
              await api.switchOrg(e.target.value).catch(() => {});
              window.location.reload();
            }}
          >
            {me.orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        ) : (
          <span>{me?.orgs.find((o) => o.id === me?.currentOrg)?.name ?? 'arksai'} · self-hosted</span>
        )}
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
