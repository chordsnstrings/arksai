import { useState } from 'react';
import type { Project, SessionMeta, SessionStatus } from '@shared/types';
import { api } from '../api/client';
import { useStore } from '../state/sessionStore';
import { confirmDialog } from '../state/confirmStore';
import { isDark, toggleTheme } from '../lib/theme';
import { activityBadge, failedDeployments } from '../lib/activity';
import { ConnectorIcon } from './ConnectorIcon';

/** A small count/dot badge on a nav item. `dot` shows a marker with no number. */
function NavBadge({ n, dot, tone = 'accent' }: { n?: number; dot?: boolean; tone?: 'accent' | 'amber' }) {
  if (dot) return <span className={`nav-badge dot ${tone}`} />;
  if (!n) return null;
  return <span className={`nav-badge ${tone}`}>{n > 99 ? '99+' : n}</span>;
}

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
  onHome,
  onRobots,
  onAndroid,
  onVideo,
  onActivity,
  onDeployments,
  onAdmin,
  onAnalytics,
  onConnections,
}: {
  onNewSession: (projectId?: string) => void;
  onNewProject: () => void;
  onEditProject: (p: Project) => void;
  onHome: () => void;
  onRobots: () => void;
  onAndroid: () => void;
  onVideo: () => void;
  onActivity: () => void;
  onDeployments: () => void;
  onAdmin: () => void;
  onAnalytics: () => void;
  onConnections: () => void;
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
  const home = useStore((s) => s.home);
  const lastActivitySeenAt = useStore((s) => s.lastActivitySeenAt);

  // Live badge counts (org-scoped snapshot, kept warm by App's poll).
  const draftCount = home?.pendingDrafts.length ?? 0;
  const failedCount = failedDeployments(home).length;
  const lowBalance = !!me?.wallet?.lowBalance;
  const actBadge = activityBadge(home, me, sessions, lastActivitySeenAt);
  const isAdmin = me?.isSuperadmin || me?.role === 'admin';

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
    if (!(await confirmDialog({ title: 'Delete this session?', body: `“${session.title}” and its workspace will be removed.`, confirmLabel: 'Delete', danger: true }))) return;
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
      {s.task === 'scheduled' && (
        <span
          className={`sched-badge ${s.status === 'done' ? 'done' : ''}`}
          title={s.status === 'done' ? 'Scheduled delivery — ready to view' : 'Scheduled delivery'}
        >
          {s.status === 'done' ? '✓' : '⏱'}
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
        <span className="brand-lockup" role="img" aria-label="ArksAI" />
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

      {/* Recent chats are the primary, most-used content — keep them HIGH, right under the
          new-session button + search, taking the main scroll space. Secondary tools live in
          the compact strip pinned at the bottom. */}
      <input
        className="search-box"
        placeholder="Search chats…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="recents-header">
        <span>Recent</span>
        <button className="recents-home" onClick={() => { onHome(); if (window.innerWidth <= 860) toggleNav(false); }} title="Workspace home">
          ⌂ Home
        </button>
      </div>

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

        {/* Ungrouped — only label them when projects are above (else the top "Recent" header covers it). */}
        {projects.length > 0 && (
          <div className="recents-header">
            <span>Recent</span>
          </div>
        )}
        {ungrouped.map(sessionRow)}
        {ungrouped.length === 0 && projects.length === 0 && (
          <div style={{ color: 'var(--text-faint)', fontSize: 13, padding: '6px 10px' }}>
            {sessions.length === 0 ? 'No sessions yet' : 'No matches'}
          </div>
        )}
      </div>

      {/* Compact tools strip — everything beyond chats, one tap away, pinned at the bottom so it
          never pushes the recent chats down. Two tidy clusters: the places you go (top) and
          setup/admin (below a hairline). Labeled (discoverable) + live badges. */}
      <div className="sb-tools">
        <button className="sb-tool" onClick={() => { onActivity(); if (window.innerWidth <= 860) toggleNav(false); }}>
          🔔 Activity {actBadge > 0 && <NavBadge n={actBadge} />}
        </button>
        <button className="sb-tool" onClick={onRobots}>
          🤖 Robots {draftCount > 0 && <NavBadge n={draftCount} />}
        </button>
        <button className="sb-tool" onClick={onDeployments}>
          🌐 Live apps {failedCount > 0 && <NavBadge n={failedCount} tone="amber" />}
        </button>
        <button className="sb-tool" onClick={onAndroid}>📱 Android</button>
        <button className="sb-tool" onClick={onVideo}>🎬 Video</button>
      </div>
      <div className="sb-tools sb-tools-sub">
        <button className="sb-tool" onClick={onConnections}>
          <ConnectorIcon /> Connect
        </button>
        <button className="sb-tool" onClick={onNewProject}>▤ New project</button>
        {isAdmin && (
          <button className="sb-tool" onClick={onAdmin}>
            ▦ {me?.isSuperadmin ? 'Admin' : 'Members'} {lowBalance && <NavBadge dot tone="amber" />}
          </button>
        )}
        {me?.isSuperadmin && <button className="sb-tool" onClick={onAnalytics}>📊 Analytics</button>}
      </div>

      <div className="sidebar-footer">
        {/* A company's workspace is its OWN and is NOT swappable — there is NO
            workspace switcher anywhere, not even for the operator. The footer simply
            names the current workspace as static text. */}
        <span>{me?.orgs.find((o) => o.id === me?.currentOrg)?.name ?? 'arksai'} · self-hosted</span>
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
