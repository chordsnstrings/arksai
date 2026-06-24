import { useRef, useState } from 'react';
import type { SessionMode } from '@shared/types';
import { AUTO_MODEL } from '@shared/types';
import { api } from '../api/client';
import { useStore } from '../state/sessionStore';
import {
  CATEGORIES,
  DEPARTMENTS,
  ICONS,
  deptCapabilities,
  departmentById,
  type CapabilityAction,
  type IconName,
} from '../lib/departments';
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

/**
 * The "Start something" zone of Home: pick a team (and load its toolkit + persona) or just
 * describe what you need. Extracted from the old Launchpad verbatim — the create/send/upload
 * logic is unchanged — plus a deferred-disclosure "Your team can also…" row that surfaces the
 * platform's breadth (robots / schedules / connectors / signature plays) in the team's language.
 */
export function StartZone({
  onAdvanced,
  onRobots,
  onSchedules,
  onConnections,
}: {
  onAdvanced: () => void;
  onRobots: () => void;
  onSchedules: () => void;
  onConnections: () => void;
}) {
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
  const addUserMessage = useStore((s) => s.addUserMessage);
  const beginRun = useStore((s) => s.beginRun);
  const forceStop = useStore((s) => s.forceStop);
  const addLocalSystem = useStore((s) => s.addLocalSystem);
  const dept = departmentById(deptId);

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

  const pickDept = (id: string | null) => {
    setDeptId(id);
    setError('');
    setText('');
    setStartingKey(null);
    applyDeptTheme(id, true); // Engineering → dark, animated
    try {
      if (id) localStorage.setItem(LS_KEY, id);
    } catch {
      /* private mode — fine */
    }
  };

  // One-step: create a session in the right mode and send the brief immediately.
  const run = async (prompt: string, mode: SessionMode, model: string = AUTO_MODEL, task?: string, attach?: File[]) => {
    const brief = prompt.trim();
    if ((!brief && !(attach && attach.length)) || busy) return;
    setBusy(true);
    setError('');
    let session;
    try {
      session = await api.createSession({ mode, model, task });
      if (attach && attach.length) await api.uploadSessionFiles(session.id, attach);
    } catch (e: any) {
      setError(e?.message ?? 'Hit a snag starting that — give it another tap.');
      setBusy(false);
      return;
    }
    const msg = brief || 'I’ve attached some files — take a look and let’s get started.';
    addUserMessage(session.id, msg);
    beginRun(session.id);
    upsertSession(session);
    setActive(session.id);
    try {
      await api.sendMessage(session.id, msg);
    } catch (e: any) {
      forceStop(session.id);
      addLocalSystem(session.id, e?.message ?? 'Couldn’t start that run — try again.', 'error');
    }
  };

  // Tapping an example opens a NEW chat with that play's skills preloaded (task=key) and waits.
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

  const runCapability = (action: CapabilityAction) => {
    if (busy) return;
    if (action.kind === 'robots') onRobots();
    else if (action.kind === 'schedules') onSchedules();
    else if (action.kind === 'connections') onConnections();
    else if (action.kind === 'play') void startChat(action.play);
  };

  // STEP A — choose your function.
  if (!dept) {
    return (
      <div className="sz">
        <p className="lp-sub">
          Pick your team and I’ll be ready with its skills — or just tell me what you need. I’ll build,
          design, report, or generate it, and check it works before you see it.
        </p>
        <div className="lp-depts">
          {DEPARTMENTS.map((d, i) => (
            <button key={d.id} className="dept-tile" style={{ ['--dept' as any]: d.accent }} onClick={() => pickDept(d.id)}>
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
    );
  }

  // STEP B — that team's plays + a free-form brief + capability discovery.
  const caps = deptCapabilities[dept.id] ?? [];
  return (
    <div className="sz" style={{ ['--dept' as any]: dept.accent }}>
      <div className="lp-headrow">
        <div className="lp-kicker dept-tinted">
          <Icon name={dept.icon} size={13} /> {dept.name} · ready
        </div>
        <button className="lp-switch" onClick={() => pickDept(null)} disabled={busy}>
          ← teams
        </button>
      </div>
      <p className="lp-sub">
        I’m set up with your {dept.name.toLowerCase()} toolkit — just tell me what you need below, or pick an example
        to jump straight into a chat for it.
      </p>

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
                void run(text, 'chat', AUTO_MODEL, dept.id, files);
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
              onClick={() => void run(text, 'chat', AUTO_MODEL, dept.id, files)}
              disabled={busy || (!text.trim() && files.length === 0)}
            >
              {busy ? 'Starting…' : 'Make it →'}
            </button>
          </div>
        </div>
        {error && <div className="lp-error">{error}</div>}
      </div>

      <div className="lp-rule" />

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

      {caps.length > 0 && (
        <div className="sz-caps">
          <div className="lp-cat-head">
            <span className="lp-cat-label">Your team can also…</span>
            <span className="lp-cat-blurb">Set-and-forget tools, in one tap</span>
          </div>
          <div className="cap-cards">
            {caps.map((c) => (
              <button key={c.title} className="cap-card" onClick={() => runCapability(c.action)} disabled={busy} title={c.blurb}>
                <span className="cap-ico">
                  <Icon name={c.icon} size={17} />
                </span>
                <span className="cap-body">
                  <span className="cap-title">{c.title}</span>
                  <span className="cap-blurb">{c.blurb}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <button className="lp-advanced" onClick={onAdvanced} disabled={busy}>
        Connect a GitHub repo or choose a mode →
      </button>
    </div>
  );
}
