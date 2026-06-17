import { useRef, useState } from 'react';
import type { SessionMode } from '@shared/types';
import { AUTO_MODEL } from '@shared/types';
import { api } from '../api/client';
import { useStore } from '../state/sessionStore';
import { CATEGORIES, DEPARTMENTS, ICONS, departmentById, type IconName } from '../lib/departments';
import { applyDeptTheme } from '../lib/theme';
import { greeting, displayName } from '../lib/greeting';

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
  const [error, setError] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [startingKey, setStartingKey] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const upsertSession = useStore((s) => s.upsertSession);
  const setActive = useStore((s) => s.setActive);
  const sessions = useStore((s) => s.sessions);
  const me = useStore((s) => s.me);
  const dept = departmentById(deptId);

  // Personalized, time-aware greeting for the returning user (their LOCAL time + name).
  const [nameOverride, setNameOverride] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const name = nameOverride ?? displayName(me?.user?.name);
  const greet = greeting(name);
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
  };
  const greetLine = (
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
  );

  // Files are staged client-side (no session exists yet) and uploaded the moment one is
  // created, BEFORE the first message — so the agent sees them on its first run. Mirrors
  // the Composer's attach/drag/paste affordances.
  const addFiles = (list: FileList | File[]) => {
    const incoming = [...list];
    if (!incoming.length) return;
    setFiles((prev) => {
      const seen = new Set(prev.map((f) => `${f.name}:${f.size}`));
      return [...prev, ...incoming.filter((f) => !seen.has(`${f.name}:${f.size}`))];
    });
    setError('');
  };
  const removeFile = (idx: number) => setFiles((prev) => prev.filter((_, i) => i !== idx));

  // Returning users resume, not restart: a quick row of their most recent work.
  const recents = sessions.filter((s) => s.task !== 'org.onboarding').slice(0, 4);

  const pickDept = (id: string) => {
    setDeptId(id);
    setError('');
    setText(''); // fresh chat box per department
    setStartingKey(null);
    applyDeptTheme(id, true); // Engineering → dark, animated
    try {
      localStorage.setItem(LS_KEY, id);
    } catch {
      /* private mode — fine */
    }
  };

  // One-step: create a session in the right mode and send the brief immediately
  // (send BEFORE activating so the loaded timeline already has the first message).
  // `attach` = staged files to upload into the new session before its first run.
  const run = async (prompt: string, mode: SessionMode, model: string = AUTO_MODEL, task?: string, _id?: string, attach?: File[]) => {
    const brief = prompt.trim();
    if ((!brief && !(attach && attach.length)) || busy) return;
    setBusy(true);
    setError('');
    try {
      const session = await api.createSession({ mode, model, task });
      if (attach && attach.length) {
        const form = new FormData();
        for (const f of attach) form.append('files', f, f.name);
        const res = await fetch(`/api/sessions/${session.id}/upload`, { method: 'POST', body: form, credentials: 'same-origin' });
        if (!res.ok) {
          let message = res.statusText;
          try {
            message = (await res.json()).error ?? message;
          } catch {}
          throw new Error(message);
        }
      }
      await api.sendMessage(session.id, brief || 'I’ve attached some files — take a look and let’s get started.');
      upsertSession(session);
      setActive(session.id);
    } catch (e: any) {
      setError(e?.message ?? 'Hit a snag starting that — give it another tap.');
      setBusy(false);
    }
  };

  // Tapping an example opens a NEW chat with that play's skills preloaded (task=key) and
  // waits — no canned text, no auto-send. The user's first message names the chat.
  const startChat = async (key: string) => {
    if (busy) return;
    setBusy(true);
    setStartingKey(key);
    setError('');
    try {
      const session = await api.createSession({ mode: 'chat', model: AUTO_MODEL, task: key });
      upsertSession(session);
      setActive(session.id);
    } catch (e: any) {
      setError(e?.message ?? 'Hit a snag opening that — try again.');
      setBusy(false);
      setStartingKey(null);
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
          {greetLine}
          <p className="lp-sub">
            Pick your team and I’ll be ready with its skills — or just tell me what you need. I’ll build,
            design, report, or generate it, and check it works before you see it.
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
              <Icon name={dept.icon} size={13} /> {dept.name} · ready
            </div>
            {greetLine}
            <p className="lp-sub">
              I’m set up with your {dept.name.toLowerCase()} toolkit — just tell me what you need below, or
              pick an example to jump straight into a chat for it.
            </p>
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
                      className={`play-card${startingKey === p.key ? ' starting' : ''}${busy && startingKey !== p.key ? ' dimmed' : ''}`}
                      onClick={() => startChat(p.key)}
                      disabled={busy}
                      title="Open a chat ready for this — then just describe what you want"
                    >
                      <span className="play-ico">
                        {startingKey === p.key ? <span className="spinner sm" /> : <Icon name={p.icon} size={18} />}
                      </span>
                      <span className="play-body">
                        <span className="play-title">{p.title}</span>
                        <span className="play-blurb">{startingKey === p.key ? 'Opening your chat…' : p.blurb}</span>
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
          <label className="lp-kicker">Describe what you need</label>
          <div
            className={`lp-box${dragOver ? ' drag-over' : ''}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              addFiles(e.dataTransfer.files);
            }}
          >
            <textarea
              ref={boxRef}
              value={text}
              placeholder={`e.g. ${dept.plays[0].title.toLowerCase()} for our new launch…`}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void run(text, 'chat', AUTO_MODEL, dept.id, undefined, files);
                }
              }}
              onPaste={(e) => {
                const dt = e.clipboardData;
                if (!dt) return;
                let dropped: File[] = Array.from(dt.files);
                if (dropped.length === 0) {
                  dropped = Array.from(dt.items)
                    .filter((it) => it.kind === 'file')
                    .map((it) => it.getAsFile())
                    .filter((f): f is File => !!f);
                }
                if (dropped.length > 0) {
                  e.preventDefault();
                  addFiles(dropped);
                }
              }}
              disabled={busy}
            />
            {files.length > 0 && (
              <div className="lp-attached">
                {files.map((f, i) => (
                  <span key={`${f.name}-${i}`} className="att-chip" title={f.name}>
                    📎 {f.name.length > 28 ? f.name.slice(0, 26) + '…' : f.name}
                    <button className="att-x" onClick={() => removeFile(i)} disabled={busy} aria-label={`Remove ${f.name}`}>
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="lp-box-bar">
              <input ref={fileRef} type="file" multiple hidden onChange={(e) => e.target.files && addFiles(e.target.files)} />
              <button
                className="lp-attach"
                title="Attach files — click, drag & drop, or paste (⌘/Ctrl+V)"
                onClick={() => fileRef.current?.click()}
                disabled={busy}
              >
                + Attach
              </button>
              <span className="spacer" style={{ flex: 1 }} />
              <button
                className="lp-go"
                onClick={() => void run(text, 'chat', AUTO_MODEL, dept.id, undefined, files)}
                disabled={busy || (!text.trim() && files.length === 0)}
              >
                {busy ? 'Starting…' : 'Make it →'}
              </button>
            </div>
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
