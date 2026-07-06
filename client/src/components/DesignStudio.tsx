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
 * Design studio — a separate full-page surface at /design. It wears ARKSAI'S OWN
 * editorial identity (operator 2026-07-06: "it should look like arksai.studio not
 * claude") — the studio inherits the app's tokens and typography, no skin override.
 * The chat-first INTERACTION remains: a serif greeting, ONE composer with suggestion
 * chips + a Style menu, then the conversation stays INSIDE the studio (the existing
 * Chat/Composer/Canvas). Refinement is conversational — you just keep talking.
 */

type DsType =
  | 'website'
  | 'landing'
  | 'prototype'
  | 'wireframe'
  | 'deck'
  | 'onepager'
  | 'creative'
  | 'document'
  | 'animation';

/** The full artifact-kind catalog ("Start with a template…"). `brief` is the deliverable
 *  line the composed message leads with — it steers the engine's task classifier. */
const TYPES: { id: DsType; label: string; hint: string; mode: 'chat' | 'code' | 'report'; brief: string }[] = [
  { id: 'website', label: 'Website', hint: 'A multi-page site for…', mode: 'code', brief: 'Deliverable: a website.' },
  { id: 'landing', label: 'Landing page', hint: 'A landing page for…', mode: 'code', brief: 'Deliverable: a landing page.' },
  {
    id: 'prototype',
    label: 'Prototype',
    hint: 'A clickable prototype of…',
    mode: 'code',
    brief: 'Deliverable: a CLICKABLE PROTOTYPE — multi-screen, navigable, fake-but-real data, no backend.',
  },
  {
    id: 'wireframe',
    label: 'Wireframe',
    hint: 'Wireframe the flow for…',
    mode: 'code',
    brief: 'Deliverable: a lo-fi WIREFRAME BOARD of the flow — annotated sketch screens with flow arrows, NOT a polished design.',
  },
  { id: 'deck', label: 'Pitch deck', hint: 'A 16:9 deck about…', mode: 'report', brief: 'Deliverable: a pitch deck.' },
  { id: 'onepager', label: 'One-pager', hint: 'A one-page PDF about…', mode: 'report', brief: 'Deliverable: a one-pager.' },
  { id: 'creative', label: 'Social creative', hint: 'An ad / social post for…', mode: 'chat', brief: 'Deliverable: a social creative.' },
  { id: 'document', label: 'Document', hint: 'A designed document about…', mode: 'chat', brief: 'Deliverable: a designed document.' },
  {
    id: 'animation',
    label: 'Animation',
    hint: 'A short animated video about…',
    mode: 'code',
    brief:
      'Deliverable: a short ANIMATED motion-graphics VIDEO. Produce it with render_motion_video per motion-kit/MOTION.md — write a retention-first script, build the scenes as scaffolds, and pass title:"<the subject>" plus target_seconds (default ~20 unless I said otherwise). Deliver the finished video.',
  },
];

/** Sketch-style template thumbnails, drawn inline in the wireframe language (no assets). */
function TplThumb({ kind }: { kind: DsType }) {
  const s = { stroke: 'currentColor', strokeWidth: 1.4, fill: 'none' } as const;
  const soft = { fill: 'currentColor', opacity: 0.18, stroke: 'none' } as const;
  switch (kind) {
    case 'website':
      return (
        <svg viewBox="0 0 44 32" aria-hidden>
          <rect x="2" y="2" width="40" height="28" rx="3" {...s} />
          <line x1="2" y1="9" x2="42" y2="9" {...s} />
          <rect x="6" y="13" width="18" height="4" {...soft} />
          <rect x="6" y="20" width="12" height="3" {...soft} />
          <rect x="27" y="13" width="11" height="11" {...soft} />
        </svg>
      );
    case 'landing':
      return (
        <svg viewBox="0 0 44 32" aria-hidden>
          <rect x="2" y="2" width="40" height="28" rx="3" {...s} />
          <rect x="10" y="8" width="24" height="5" {...soft} />
          <rect x="14" y="16" width="16" height="3" {...soft} />
          <rect x="16" y="22" width="12" height="5" rx="2.5" {...s} />
        </svg>
      );
    case 'prototype':
      return (
        <svg viewBox="0 0 44 32" aria-hidden>
          <rect x="2" y="4" width="16" height="24" rx="3" {...s} />
          <rect x="26" y="4" width="16" height="24" rx="3" {...s} />
          <rect x="5" y="8" width="10" height="6" {...soft} />
          <rect x="29" y="8" width="10" height="10" {...soft} />
          <path d="M18 16 h6 m0 0 l-2.4 -2.2 M24 16 l-2.4 2.2" {...s} />
        </svg>
      );
    case 'wireframe':
      return (
        <svg viewBox="0 0 44 32" aria-hidden>
          <rect x="4" y="4" width="22" height="24" rx="3" {...s} strokeDasharray="3 2.4" />
          <path d="M7 8 l16 16 M23 8 l-16 16" {...s} opacity="0.4" />
          <path d="M30 10 c4 -4 9 -1 8 4 c-1 4 -6 5 -8 2" {...s} opacity="0.9" />
          <path d="M31 21 l6 5" {...s} />
        </svg>
      );
    case 'deck':
      return (
        <svg viewBox="0 0 44 32" aria-hidden>
          <rect x="4" y="6" width="36" height="20" rx="2.5" {...s} />
          <rect x="8" y="11" width="14" height="5" {...soft} />
          <rect x="8" y="19" width="10" height="3" {...soft} />
          <rect x="26" y="11" width="10" height="11" {...soft} />
        </svg>
      );
    case 'onepager':
      return (
        <svg viewBox="0 0 44 32" aria-hidden>
          <rect x="13" y="2" width="18" height="28" rx="2" {...s} />
          <rect x="16" y="6" width="12" height="4" {...soft} />
          <rect x="16" y="13" width="12" height="2" {...soft} />
          <rect x="16" y="17" width="9" height="2" {...soft} />
          <rect x="16" y="21" width="12" height="2" {...soft} />
        </svg>
      );
    case 'creative':
      return (
        <svg viewBox="0 0 44 32" aria-hidden>
          <rect x="8" y="2" width="28" height="28" rx="3" {...s} />
          <circle cx="18" cy="12" r="4" {...soft} />
          <path d="M10 24 l8 -7 6 5 6 -6 4 4" {...s} />
          <rect x="12" y="25" width="12" height="2.4" {...soft} />
        </svg>
      );
    case 'document':
      return (
        <svg viewBox="0 0 44 32" aria-hidden>
          <path d="M14 2 h12 l6 6 v22 h-18 z" {...s} />
          <path d="M26 2 v6 h6" {...s} />
          <rect x="17" y="12" width="12" height="2" {...soft} />
          <rect x="17" y="16" width="12" height="2" {...soft} />
          <rect x="17" y="20" width="8" height="2" {...soft} />
        </svg>
      );
    case 'animation':
      return (
        <svg viewBox="0 0 44 32" aria-hidden>
          <rect x="4" y="3" width="36" height="20" rx="3" {...s} />
          <path d="M19 8.5 l8 4.5 -8 4.5 z" fill="currentColor" opacity="0.55" stroke="none" />
          <line x1="6" y1="28" x2="38" y2="28" {...s} />
          <circle cx="16" cy="28" r="2.4" fill="currentColor" stroke="none" />
        </svg>
      );
  }
}

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
    if (t) parts.push(t.brief);
    parts.push(text.trim());
    // Style handling is KIND-aware: a wireframe is deliberately lo-fi (styles don't apply);
    // an animation maps the pick onto the motion engine instead of design_direction.
    if (type === 'wireframe') {
      if (style.kind !== 'auto') parts.push('(Wireframes are lo-fi greyscale by design — apply the brand/style later at the hi-fi stage.)');
    } else if (type === 'animation') {
      if (style.kind === 'brand') parts.push('Style: pass the ORG BRAND accent colour to render_motion_video (accent param) with style "clean".');
      else if (style.kind === 'direction') parts.push(`Style: pass style "clean" with accent "${style.d.accent}" to render_motion_video.`);
    } else if (style.kind === 'brand') {
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
          <span className="ds-wordmark"><span className="ds-spark" aria-hidden>✳</span> ArksAI · Design</span>
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
        <span className="ds-wordmark"><span className="ds-spark" aria-hidden>✳</span> ArksAI · Design</span>
      </header>

      <div className="ds-hero">
        <div className="ds-spark" aria-hidden>✳</div>
        <div className="ds-kicker">Design studio</div>
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
              {/* Wireframes are deliberately greyscale — a style pick would be ignored, so say so instead of offering it. */}
              {type === 'wireframe' ? (
                <button className="ds-tool ds-style-btn" disabled title="Wireframes stay greyscale — pick a style when you move to the hi-fi design">
                  Style · Lo-fi by design
                </button>
              ) : (
              <button className="ds-tool ds-style-btn" onClick={() => setStyleOpen((v) => !v)} aria-expanded={styleOpen}>
                {styleLabel} <span className="ds-caret">▾</span>
              </button>
              )}
              {styleOpen && type !== 'wireframe' && (
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

        <div className="ds-tpl-wrap">
          <div className="ds-tpl-label">Start with a template</div>
          <div className="ds-tpl-grid" role="listbox" aria-label="Templates">
            {TYPES.map((t) => (
              <button
                key={t.id}
                role="option"
                aria-selected={type === t.id}
                className={`ds-tpl ${type === t.id ? 'on' : ''}`}
                title={t.hint}
                onClick={() => setType(type === t.id ? null : t.id)}
              >
                <span className="ds-tpl-thumb"><TplThumb kind={t.id} /></span>
                <span className="ds-tpl-name">{t.label}</span>
              </button>
            ))}
          </div>
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
