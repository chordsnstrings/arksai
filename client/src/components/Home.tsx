import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { useStore } from '../state/sessionStore';
import { greeting, displayName } from '../lib/greeting';
import { openExternal } from '../lib/openExternal';
import { needsYou, liveDeployments, activeSchedules, activeRobots, type AttentionItem } from '../lib/activity';
import { StartZone } from './StartZone';

const nextRunLabel = (ms: number): string => {
  const d = ms - Date.now();
  if (d <= 0) return 'due now';
  const m = Math.round(d / 60000);
  if (m < 60) return `in ${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `in ${h}h`;
  return `in ${Math.round(h / 24)}d`;
};

/**
 * The Home / Workspace — the default surface when no chat is open. One consolidated, role-aware
 * hub: a personalized greeting, anything that needs you, what's running for you in the background,
 * recent work to continue, and the "Start something" zone (team picker + brief). Differentiation
 * is by CONTENT (which team, which capability cards) — the layout/look is the same for everyone.
 */
export function Home({
  onAdvanced,
  onRobots,
  onSchedules,
  onConnections,
  onActivity,
  onDeployments,
  onAdmin,
}: {
  onAdvanced: () => void;
  onRobots: () => void;
  onSchedules: () => void;
  onConnections: () => void;
  onActivity: () => void;
  onDeployments: () => void;
  onAdmin: () => void;
}) {
  const me = useStore((s) => s.me);
  const sessions = useStore((s) => s.sessions);
  const home = useStore((s) => s.home);
  const setHome = useStore((s) => s.setHome);
  const setActive = useStore((s) => s.setActive);

  // Refresh the snapshot when Home opens (App also keeps it warm via a poll).
  useEffect(() => {
    let live = true;
    api.getHome().then((h) => live && setHome(h)).catch(() => {});
    return () => {
      live = false;
    };
  }, [setHome]);

  // Personalized, time-aware greeting (their LOCAL time + name).
  const [nameOverride, setNameOverride] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const name = nameOverride ?? displayName(me?.user?.name);
  const greet = useMemo(() => greeting(name), [name]);
  const saveName = (v: string) => {
    const first = v.trim().split(/\s+/)[0] ?? '';
    try {
      if (first) localStorage.setItem('arksai.name', first);
      else localStorage.removeItem('arksai.name');
    } catch {
      /* private mode */
    }
    setNameOverride(first);
    setEditingName(false);
    api.setName(first).catch(() => {});
  };

  const attention = needsYou(home, me);
  const recents = sessions.filter((s) => s.task !== 'org.onboarding').slice(0, 5);
  const liveApps = liveDeployments(home);
  const schedules = activeSchedules(home);
  const robots = activeRobots(home);
  const hasRunning = liveApps.length > 0 || schedules.length > 0 || robots.length > 0;

  const onAttention = (it: AttentionItem) => {
    if (it.kind === 'draft') onRobots();
    else if (it.kind === 'failed-deploy') onDeployments();
    else onAdmin();
  };

  return (
    <div className="home">
      <div className="home-inner">
        <div className="lp-masthead">
          <span className="lp-mark">
            <span className="logo-mark sm" /> ARKSAI · STUDIO
          </span>
          <span className="lp-tagline">a builder for every team</span>
        </div>

        <div className="lp-greet">
          {editingName ? (
            <input
              className="lp-name-input"
              autoFocus
              defaultValue={name}
              placeholder="your name"
              onBlur={(e) => saveName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveName((e.target as HTMLInputElement).value);
                if (e.key === 'Escape') setEditingName(false);
              }}
            />
          ) : (
            <>
              <h1 className="lp-title lp-greet-text">{greet}</h1>
              <button className="lp-name-edit" title={name ? 'Change your name' : 'Tell me your name'} onClick={() => setEditingName(true)}>
                {name ? '✎' : 'set your name'}
              </button>
            </>
          )}
        </div>

        {attention.length > 0 && (
          <section className="home-zone home-needs">
            <div className="home-zone-head">
              <span className="home-zone-label">Needs you</span>
              <button className="home-zone-link" onClick={onActivity}>
                Activity →
              </button>
            </div>
            <div className="home-needs-list">
              {attention.slice(0, 4).map((it) => (
                <button key={it.id} className={`needs-card ${it.kind}`} onClick={() => onAttention(it)}>
                  <span className="needs-title">{it.title}</span>
                  <span className="needs-detail">{it.detail}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {recents.length > 0 && (
          <section className="home-zone">
            <div className="home-zone-head">
              <span className="home-zone-label">Jump back in</span>
            </div>
            <div className="home-recents">
              {recents.map((s) => (
                <button key={s.id} className="home-recent" onClick={() => setActive(s.id)} title={s.title}>
                  <span className={`status-dot ${s.status}`} />
                  {s.title.length > 36 ? s.title.slice(0, 34) + '…' : s.title}
                </button>
              ))}
            </div>
          </section>
        )}

        <StartZone
          onAdvanced={onAdvanced}
          onRobots={onRobots}
          onSchedules={onSchedules}
          onConnections={onConnections}
        />

        {hasRunning && (
          <section className="home-zone home-running">
            <div className="home-zone-head">
              <span className="home-zone-label">Running for you</span>
            </div>
            <div className="run-grid">
              {liveApps.slice(0, 4).map((d) => (
                <button key={d.slug} className="run-card" onClick={() => openExternal(d.url)} title={`Open ${d.url}`}>
                  <span className="run-kind live">● Live app</span>
                  <span className="run-title">{d.name}</span>
                  <span className="run-meta">{d.url.replace(/^https?:\/\//, '')}</span>
                </button>
              ))}
              {schedules.slice(0, 4).map((s) => (
                <button key={s.id} className="run-card" onClick={onSchedules} title="Manage schedules">
                  <span className="run-kind sched">⏱ Scheduled</span>
                  <span className="run-title">{s.label}</span>
                  <span className="run-meta">next run {nextRunLabel(s.nextRunAt)}</span>
                </button>
              ))}
              {robots.map((r) => (
                <button key={r.id} className="run-card" onClick={onRobots} title="Open Robots">
                  <span className="run-kind robot">🤖 Robot</span>
                  <span className="run-title">{r.name}</span>
                  <span className="run-meta">{r.mailboxReady ? 'on duty' : 'needs a mailbox'}</span>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
