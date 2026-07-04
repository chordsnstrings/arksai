import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';
import type { DesignDirectionSummary } from '../api/client';
import { useStore, emptyLive } from '../state/sessionStore';
import { displayName, greeting } from '../lib/greeting';
import { Chat } from './Chat';
import { Composer } from './Composer';
import { ProgressBar } from './ProgressBar';
import { CheckpointTrail } from './CheckpointTrail';
import { Canvas } from './Canvas';
import { AUTO_MODEL } from '@shared/types';

/**
 * Design studio — a separate full-page surface at /design ("exactly like Claude", the
 * operator's ask): Anthropic's warm-paper look (scoped token override, .ds-claude) and
 * claude.ai's chat-first interaction — a serif greeting, ONE big rounded composer with
 * suggestion chips + a Style menu, then the conversation stays INSIDE the studio (the
 * existing Chat/Composer/Canvas re-skinned by the token scope). Refinement is
 * conversational — you just keep talking.
 */

type DsType = 'website' | 'landing' | 'deck' | 'onepager' | 'creative' | 'document';

const TYPES: { id: DsType; label: string; hint: string; mode: 'chat' | 'code' | 'report' }[] = [
  { id: 'website', label: 'Website', hint: 'A multi-page site for…', mode: 'code' },
  { id: 'landing', label: 'Landing page', hint: 'A landing page for…', mode: 'code' },
  { id: 'deck', label: 'Pitch deck', hint: 'A 16:9 deck about…', mode: 'report' },
  { id: 'onepager', label: 'One-pager', hint: 'A one-page PDF about…', mode: 'report' },
  { id: 'creative', label: 'Social creative', hint: 'An ad / social post for…', mode: 'chat' },
  { id: 'document', label: 'Document', hint: 'A designed document about…', mode: 'chat' },
];

const GROUP_LABEL: Record<DesignDirectionSummary['group'], string> = {
  modern: 'Modern product',
  glass: 'Glass & light',
  structural: 'Structural',
  aesthetic: 'Aesthetic',
};

type StylePick = { kind: 'auto' } | { kind: 'brand' } | { kind: 'direction'; d: DesignDirectionSummary };

export function DesignStudio({ onClose }: { onClose: () => void }) {
  const sessions = useStore((s) => s.sessions);
  const me = useStore((s) => s.me);
  const setActive = useStore((s) => s.setActive);
  const upsertSession = useStore((s) => s.upsertSession);
  const addUserMessage = useStore((s) => s.addUserMessage);
  const beginRun = useStore((s) => s.beginRun);
  const canvasOpen = useStore((s) => s.canvasOpen);

  // The session this studio visit owns; null = the Claude-style landing.
  const [sid, setSid] = useState<string | null>(null);
  const live = useStore((s) => (sid ? s.live[sid] : undefined)) ?? emptyLive();
  const meta = sessions.find((s) => s.id === sid) ?? null;

  const [text, setText] = useState('');
  const [type, setType] = useState<DsType | null>(null);
  const [style, setStyle] = useState<StylePick>({ kind: 'auto' });
  const [styleOpen, setStyleOpen] = useState(false);
  const [dirs, setDirs] = useState<DesignDirectionSummary[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const name = displayName(me?.user?.name);
  const greet = useMemo(() => greeting(name), [name]);

  useEffect(() => {
    api.getDesignDirections().then(setDirs).catch(() => {});
    taRef.current?.focus();
  }, []);

  // Close the style menu on an outside click.
  const styleRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!styleOpen) return;
    const onDown = (e: MouseEvent) => {
      if (styleRef.current && !styleRef.current.contains(e.target as Node)) setStyleOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [styleOpen]);

  const recents = sessions.filter((s) => (s.task || '').startsWith('design.')).slice(0, 6);

  const styleLabel =
    style.kind === 'auto' ? 'Style · ArksAI chooses' : style.kind === 'brand' ? 'Style · My brand' : `Style · ${style.d.name}`;

  function composeBrief(): string {
    const t = type ? TYPES.find((x) => x.id === type) : null;
    const parts: string[] = [];
    if (t) parts.push(`Deliverable: a ${t.label.toLowerCase()}.`);
    parts.push(text.trim());
    if (style.kind === 'brand') {
      parts.push('Identity: use OUR organization brand — the org profile logo and accent colour — as the visual identity.');
    } else if (style.kind === 'direction') {
      const d = style.d;
      parts.push(
        `Visual direction (I picked this — lock it): the "${d.name}" direction, design_direction recipe id "${d.id}" — ${d.mood}; accent ${d.accent}; ${d.dark ? 'dark' : 'light'} ground; signature: ${d.signature}. Type: ${d.display} display + ${d.body} body.`,
      );
    }
    return parts.filter(Boolean).join('\n');
  }

  async function send() {
    const brief = text.trim();
    if (!brief || busy) return;
    setBusy(true);
    setErr('');
    try {
      const t = type ? TYPES.find((x) => x.id === type) : null;
      const session = await api.createSession({
        mode: t?.mode ?? 'chat',
        model: AUTO_MODEL,
        task: `design.${type ?? 'studio'}`,
      });
      upsertSession(session);
      if (files.length) await api.uploadSessionFiles(session.id, files);
      const msg = composeBrief();
      addUserMessage(session.id, msg);
      beginRun(session.id);
      await api.sendMessage(session.id, msg);
      setActive(session.id); // subscribes the event stream at the App level
      setSid(session.id); // …and the conversation renders INSIDE the studio
      setText('');
      setFiles([]);
    } catch (e: any) {
      setErr(e?.message || 'Could not start the design. Try again.');
    } finally {
      setBusy(false);
    }
  }

  function openRecent(id: string) {
    setActive(id);
    setSid(id);
  }

  // ---------- conversation view (inside the studio, Claude-shaped) ----------
  if (sid && meta) {
    return (
      <div className="ds-claude">
        <header className="ds-top">
          <button className="ds-back" onClick={() => setSid(null)} aria-label="Back to Design studio">←</button>
          <span className="ds-wordmark">✳ Design</span>
          <span className="ds-top-title" title={meta.title || ''}>{meta.title || 'New design'}</span>
          <button className="ds-close" onClick={onClose} aria-label="Close Design studio">Exit studio</button>
        </header>
        <div className="ds-body">
          <div className="ds-conv">
            <ProgressBar live={live} />
            <CheckpointTrail live={live} />
            <Chat live={live} sessionId={meta.id} />
            <Composer meta={meta} running={live.running} onOpenCommands={() => {}} onOpenMemory={() => {}} onOpenConnections={() => {}} />
          </div>
          {canvasOpen && <Canvas sessionId={meta.id} />}
        </div>
      </div>
    );
  }

  // ---------- landing (claude.ai home) ----------
  return (
    <div className="ds-claude">
      <header className="ds-top">
        <button className="ds-back" onClick={onClose} aria-label="Back">←</button>
        <span className="ds-wordmark">✳ Design</span>
      </header>

      <div className="ds-hero">
        <div className="ds-spark" aria-hidden>✳</div>
        <h1 className="ds-greet">{greet}</h1>

        <div className="ds-composer">
          <textarea
            ref={taRef}
            className="ds-input"
            placeholder={type ? TYPES.find((x) => x.id === type)?.hint : 'What are we designing today?'}
            value={text}
            rows={3}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          {files.length > 0 && (
            <div className="ds-files">
              {files.map((f, i) => (
                <span key={`${f.name}-${i}`} className="ds-file">
                  {f.name}
                  <button onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`}>×</button>
                </span>
              ))}
            </div>
          )}
          <div className="ds-toolrow">
            <button className="ds-tool" title="Attach a logo or content file" onClick={() => fileRef.current?.click()}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M21 12.5l-8.5 8.5a6 6 0 01-8.5-8.5L12.5 4a4 4 0 015.7 5.7L9.7 18.2a2 2 0 01-2.9-2.9l8-8"/></svg>
            </button>
            <input
              ref={fileRef}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                const list = Array.from(e.target.files ?? []);
                if (list.length) setFiles((cur) => [...cur, ...list].slice(0, 6));
                e.target.value = '';
              }}
            />
            <div className="ds-style" ref={styleRef}>
              <button className="ds-tool ds-style-btn" onClick={() => setStyleOpen((v) => !v)} aria-expanded={styleOpen}>
                {styleLabel} <span className="ds-caret">▾</span>
              </button>
              {styleOpen && (
                <div className="ds-style-menu" role="menu">
                  <button className={`ds-style-row ${style.kind === 'auto' ? 'on' : ''}`} onClick={() => { setStyle({ kind: 'auto' }); setStyleOpen(false); }}>
                    <span className="ds-sw ds-sw-auto" />
                    <span><strong>Let ArksAI choose</strong><em>a direction picked for your subject</em></span>
                  </button>
                  {me?.currentOrg && (
                    <button className={`ds-style-row ${style.kind === 'brand' ? 'on' : ''}`} onClick={() => { setStyle({ kind: 'brand' }); setStyleOpen(false); }}>
                      <span className="ds-sw ds-sw-brand" />
                      <span><strong>Use my brand</strong><em>your logo + accent from the workspace</em></span>
                    </button>
                  )}
                  {(['modern', 'glass', 'structural', 'aesthetic'] as const).map((g) => {
                    const list = dirs.filter((d) => d.group === g);
                    if (!list.length) return null;
                    return (
                      <div key={g}>
                        <div className="ds-style-group">{GROUP_LABEL[g]}</div>
                        {list.map((d) => (
                          <button
                            key={d.id}
                            className={`ds-style-row ${style.kind === 'direction' && style.d.id === d.id ? 'on' : ''}`}
                            onClick={() => { setStyle({ kind: 'direction', d }); setStyleOpen(false); }}
                          >
                            <span className="ds-sw" style={{ background: d.accent }} />
                            <span><strong>{d.name}</strong><em>{d.mood}</em></span>
                            {d.dark && <span className="ds-dark-chip">dark</span>}
                          </button>
                        ))}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <span className="ds-spacer" />
            <button className="ds-send" onClick={() => void send()} disabled={!text.trim() || busy} aria-label="Start designing">
              {busy ? '…' : '↑'}
            </button>
          </div>
        </div>

        {err && <div className="ds-err">{err}</div>}

        <div className="ds-chips">
          {TYPES.map((t) => (
            <button
              key={t.id}
              className={`ds-chip ${type === t.id ? 'on' : ''}`}
              onClick={() => setType(type === t.id ? null : t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {recents.length > 0 && (
          <div className="ds-recents">
            <div className="ds-recents-label">Your recent designs</div>
            {recents.map((s) => (
              <button key={s.id} className="ds-recent" onClick={() => openRecent(s.id)}>
                <span className="ds-recent-title">{s.title || 'Untitled design'}</span>
                <span className="ds-recent-when">{new Date(s.updatedAt ?? s.createdAt).toLocaleDateString()}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
