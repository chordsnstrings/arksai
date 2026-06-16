import { useState } from 'react';
import type { SessionMode } from '@shared/types';
import { AUTO_MODEL } from '@shared/types';
import { api } from '../api/client';
import { useStore } from '../state/sessionStore';
import { CATEGORIES, DEPARTMENTS, ICONS, departmentById, type IconName } from '../lib/departments';
import { applyDeptTheme } from '../lib/theme';

const LS_KEY = 'arksai.department';

function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      dangerouslySetInnerHTML={{ __html: ICONS[name] }}
    />
  );
}

export function Launchpad({ onAdvanced }: { onAdvanced: () => void }) {
  const [deptId, setDeptId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(LS_KEY);
    } catch {
      return null;
    }
  });
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const upsertSession = useStore((s) => s.upsertSession);
  const setActive = useStore((s) => s.setActive);
  const sessions = useStore((s) => s.sessions);
  const dept = departmentById(deptId);

  // Returning users resume, not restart: a quick row of their most recent work.
  const recents = sessions.filter((s) => s.task !== 'org.onboarding').slice(0, 4);

  const pickDept = (id: string) => {
    setDeptId(id);
    setError('');
    applyDeptTheme(id, true); // Engineering → dark, animated
    try {
      localStorage.setItem(LS_KEY, id);
    } catch {
      /* private mode — fine */
    }
  };

  // One-step: create a session in the right mode and send the brief immediately
  // (send BEFORE activating so the loaded timeline already has the first message).
  const run = async (prompt: string, mode: SessionMode, model: string = AUTO_MODEL, task?: string, id?: string) => {
    const brief = prompt.trim();
    if (!brief || busy) return;
    setBusy(true);
    setStartingId(id ?? '__free__');
    setError('');
    try {
      const session = await api.createSession({ mode, model, task });
      await api.sendMessage(session.id, brief);
      upsertSession(session);
      setActive(session.id);
    } catch (e: any) {
      setError(e?.message ?? 'Hit a snag starting that — give it another tap.');
      setBusy(false);
      setStartingId(null);
    }
  };

  const masthead = (
    <div className="lp-masthead">
      <span className="lp-mark">
        <span className="logo-mark sm" /> ARKSAI · STUDIO
      </span>
      <span className="lp-tagline">a builder for every team</span>
    </div>
  );

  // STEP A — choose your function.
  if (!dept) {
    return (
      <div className="launchpad">
        <div className="lp-inner">
          {masthead}
          <div className="lp-kicker">Get started</div>
          <h1 className="lp-title">Which team are you building for?</h1>
          <p className="lp-sub">
            Pick your function and we’ll show the work it ships — decks, dashboards, sites, reports, and
            spreadsheets — built, verified, and ready to use.
          </p>
          {recents.length > 0 && (
            <div className="lp-recents">
              <span className="lp-recents-label">Jump back in</span>
              <div className="lp-recents-row">
                {recents.map((s) => (
                  <button key={s.id} className="lp-recent" onClick={() => setActive(s.id)} disabled={busy} title={s.title}>
                    {s.title.length > 32 ? s.title.slice(0, 30) + '…' : s.title}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="lp-depts">
            {DEPARTMENTS.map((d, i) => (
              <button
                key={d.id}
                className="dept-tile"
                style={{ ['--dept' as any]: d.accent }}
                onClick={() => pickDept(d.id)}
              >
                <span className="dept-no">{String(i + 1).padStart(2, '0')}</span>
                <span className="dept-ico">
                  <Icon name={d.icon} size={22} />
                </span>
                <span className="dept-body">
                  <span className="dept-name">{d.name}</span>
                  <span className="dept-blurb">{d.blurb}</span>
                </span>
                <span className="dept-arrow">→</span>
              </button>
            ))}
          </div>
          <button className="lp-advanced" onClick={onAdvanced} disabled={busy}>
            Connect a GitHub repo or choose a mode →
          </button>
        </div>
      </div>
    );
  }

  // STEP B — that team's plays + a free-form brief.
  return (
    <div className="launchpad" style={{ ['--dept' as any]: dept.accent }}>
      <div className="lp-inner">
        {masthead}
        <div className="lp-headrow">
          <div>
            <div className="lp-kicker dept-tinted">
              <Icon name={dept.icon} size={13} /> {dept.name}
            </div>
            <h1 className="lp-title">What does your team need to ship?</h1>
          </div>
          <button
            className="lp-switch"
            onClick={() => {
              setDeptId(null);
              applyDeptTheme(null, true); // back to the neutral, light teams screen
            }}
            disabled={busy}
          >
            ← teams
          </button>
        </div>

        <div className="lp-cats">
          {CATEGORIES.map((cat) => {
            const plays = dept.plays.filter((p) => p.category === cat.id);
            if (!plays.length) return null;
            return (
              <div key={cat.id} className="lp-cat">
                <div className="lp-cat-head">
                  <span className="lp-cat-label">{cat.label}</span>
                  <span className="lp-cat-blurb">{cat.blurb}</span>
                </div>
                <div className="lp-plays">
                  {plays.map((p) => (
                    <button
                      key={p.title}
                      className={`play-card${startingId === p.title ? ' starting' : ''}${busy && startingId !== p.title ? ' dimmed' : ''}`}
                      onClick={() => run(p.prompt, p.mode, p.model, p.key, p.title)}
                      disabled={busy}
                    >
                      <span className="play-ico">
                        {startingId === p.title ? <span className="spinner sm" /> : <Icon name={p.icon} size={18} />}
                      </span>
                      <span className="play-body">
                        <span className="play-title">{p.title}</span>
                        <span className="play-blurb">{startingId === p.title ? 'Starting your workspace…' : p.blurb}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <div className="lp-rule" />

        <div className="lp-free">
          <label className="lp-kicker">Or describe what your team needs</label>
          <div className="lp-box">
            <textarea
              value={text}
              placeholder={`e.g. ${dept.plays[0].title.toLowerCase()} for our new launch…`}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void run(text, 'code');
                }
              }}
              disabled={busy}
            />
            <button className="lp-go" onClick={() => void run(text, 'code')} disabled={busy || !text.trim()}>
              {busy ? 'Starting…' : 'Make it →'}
            </button>
          </div>
          {error && <div className="lp-error">{error}</div>}
        </div>

        <button className="lp-advanced" onClick={onAdvanced} disabled={busy}>
          Connect a GitHub repo or choose a mode →
        </button>
      </div>
    </div>
  );
}
