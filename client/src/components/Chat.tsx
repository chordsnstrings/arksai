import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { TimelineItem, ToolCallRecord } from '@shared/types';
import type { CompletionState, LiveState } from '../state/sessionStore';
import { useStore } from '../state/sessionStore';
import { api } from '../api/client';

const TOOL_LABEL: Record<string, string> = {
  web_search: 'Searching',
  web_fetch: 'Reading the web',
  bash: 'Working',
  bash_background: 'Running a server',
  bash_output: 'Checking logs',
  kill_process: 'Stopping a process',
  read_file: 'Reading',
  write_file: 'Writing',
  edit_file: 'Editing',
  glob: 'Finding files',
  grep: 'Searching the code',
  git_diff_stat: 'Reviewing changes',
  git_commit: 'Saving a version',
  git_push: 'Pushing',
  // High-signal "magic" moments — warm, human labels (the user is watching).
  see_image: 'Looking at your image',
  extract_palette: 'Reading your brand colours',
  add_fonts: 'Setting the typography',
  generate_image: 'Designing an image',
  generate_spreadsheet: 'Building the spreadsheet',
  generate_doc: 'Writing the document',
  generate_pptx: 'Building the deck',
  render_report: 'Designing the PDF',
  render_chart: 'Drawing the charts',
  add_ui_kit: 'Adding the design kit',
  publish_app: 'Publishing it live',
  fetch_data: 'Pulling your data',
  send_webhook: 'Sending it out',
  text_to_speech: 'Recording the voiceover',
  generate_video: 'Filming the clip',
  generate_music: 'Composing the track',
  switch_mode: 'Switching gears',
};

function ToolRow({ call }: { call: ToolCallRecord }) {
  const [open, setOpen] = useState(false);
  const label = TOOL_LABEL[call.tool] ?? call.tool;
  return (
    <div className="tool-row">
      <div className="head" onClick={() => setOpen((v) => !v)}>
        {call.running ? (
          <span className="spinner sm" />
        ) : call.ok ? (
          <span className="ok">✓</span>
        ) : (
          <span className="fail">✗</span>
        )}
        <span className="name">{label}</span>
        <span>{call.argsSummary}</span>
        {call.durationMs !== undefined && <span>· {(call.durationMs / 1000).toFixed(1)}s</span>}
      </div>
      {open && call.outputPreview && <pre>{call.outputPreview}</pre>}
    </div>
  );
}

function ToolActivity({ calls, running }: { calls: ToolCallRecord[]; running: boolean }) {
  // Auto-expand while working so the "expert at work" is VISIBLE (visible competence
  // builds trust); collapse the finished record so the transcript stays tidy.
  const [open, setOpen] = useState(running);
  const byTool = new Map<string, number>();
  for (const c of calls) {
    const label = TOOL_LABEL[c.tool] ?? c.tool;
    byTool.set(label, (byTool.get(label) ?? 0) + 1);
  }
  const counts = [...byTool.entries()].map(([t, n]) => `${t} · ${n}`).join('  ');
  // While running, lead with a live one-line ticker of the CURRENT action.
  const current = running ? calls[calls.length - 1] : null;
  const ticker = current ? TOOL_LABEL[current.tool] ?? current.tool : null;
  return (
    <div className="tool-group">
      <button className="tool-group-header" onClick={() => setOpen((v) => !v)}>
        <span className={`chev ${open ? 'open' : ''}`}>▶</span>
        {running && ticker ? (
          <span className="tool-ticker">
            <span className="spinner sm" /> {ticker}
            {current?.argsSummary ? <span className="tk-arg"> · {current.argsSummary}</span> : null}
          </span>
        ) : (
          <>
            <span>{running ? 'Working…' : 'Ran tools'}</span>
            <span className="counts">{counts}</span>
          </>
        )}
      </button>
      {open && (
        <div className="tool-rows">
          {calls.map((c) => (
            <ToolRow key={c.callId} call={c} />
          ))}
        </div>
      )}
    </div>
  );
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function TimelineRow({ item, sessionId }: { item: TimelineItem; sessionId: string }) {
  switch (item.kind) {
    case 'user':
      return <div className="user-bubble">{item.text}</div>;
    case 'assistant':
      return (
        <div className="assistant-prose">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.text}</ReactMarkdown>
        </div>
      );
    case 'tools':
      return <ToolActivity calls={item.calls} running={false} />;
    case 'system':
      return <div className={`system-line ${item.level}`}>{item.text}</div>;
    case 'file': {
      const href = `/api/sessions/${sessionId}/files/${item.path
        .split('/')
        .map(encodeURIComponent)
        .join('/')}`;
      return (
        <a className="file-chip" href={href} download={item.name} title={item.path}>
          <span className="icon">📄</span>
          <span className="name">{item.name}</span>
          <span className="size">{fmtBytes(item.size)}</span>
          <span className="dl">⬇</span>
        </a>
      );
    }
  }
}

function StatusFooter({ live, sessionId }: { live: LiveState; sessionId: string }) {
  const tokens = live.tokens >= 1000 ? `${(live.tokens / 1000).toFixed(1)}k` : String(live.tokens);
  // Lead with the live expert action ("Exercising every route…") so the user
  // sees the system doing real work; keep the timer/tokens as proof of effort.
  const label = live.progress?.label ?? 'Working…';
  return (
    <div className="status-footer">
      <span className="spinner" />
      <span className="sf-label">{label}</span>
      <span className="sf-meta">
        {live.elapsed}s · {tokens} tokens
      </span>
      <button
        className="stop"
        onClick={() => {
          useStore.getState().forceStop(sessionId); // clear UI immediately
          api.interrupt(sessionId).catch(() => {});
        }}
      >
        Stop
      </button>
    </div>
  );
}

const DELIVERABLE_NOUN: Record<string, string> = { app: 'app', pdf: 'report', sheet: 'spreadsheet', doc: 'document' };

/** The "it's ready" moment: names the finished thing and offers the next action
 *  in-flow (open it, or — for apps — put it online and get a shareable link). */
function CompletionCard({ completion, sessionId }: { completion: CompletionState; sessionId: string }) {
  const toggleCanvas = useStore((s) => s.toggleCanvas);
  const canvasTarget = useStore((s) => s.canvasTarget);
  const beginRun = useStore((s) => s.beginRun);
  const addUserMessage = useStore((s) => s.addUserMessage);
  const [link, setLink] = useState('');
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [err, setErr] = useState('');
  const [phase, setPhase] = useState(0);
  const noun = DELIVERABLE_NOUN[completion.kind] ?? 'result';

  // Walk the real publish phases so the 30-60s wait shows visible motion, not a freeze.
  const PUB_PHASES = ['Snapshotting your app…', 'Installing what it needs…', 'Booting it up…', 'Checking the live URL…'];
  useEffect(() => {
    if (!busy) {
      setPhase(0);
      return;
    }
    const t = setInterval(() => setPhase((p) => Math.min(p + 1, PUB_PHASES.length - 1)), 2600);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);

  // A live thumbnail of the finished thing — the reveal — using whatever the canvas
  // auto-loaded (a running app's preview, or the produced document).
  let thumbSrc: string | null = null;
  if (canvasTarget?.port) thumbSrc = `/api/sessions/${sessionId}/preview/${canvasTarget.port}/`;
  else if (canvasTarget?.file)
    thumbSrc = `/api/sessions/${sessionId}/docview/${canvasTarget.file.split('/').map(encodeURIComponent).join('/')}`;

  const publish = async () => {
    setBusy(true);
    setErr('');
    setFailed(false);
    try {
      const dep = await api.publish(sessionId);
      if (dep.status === 'running') setLink(`${window.location.origin}${dep.url}`);
      else setFailed(true);
    } catch (e: any) {
      setErr(e?.message ?? 'Could not publish');
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  // Recovery is one tap: send the defect back to the agent to fix + republish.
  const fixAndRepublish = async () => {
    const msg = 'The shared preview didn’t pass its check — please fix what’s broken and publish it again.';
    setFailed(false);
    addUserMessage(sessionId, msg);
    beginRun(sessionId);
    try {
      await api.sendMessage(sessionId, msg);
    } catch {
      /* the optimistic state will clear on the next event */
    }
  };

  const copy = () => {
    navigator.clipboard?.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="completion-card reveal">
      {thumbSrc && (
        <button className="cc-thumb" onClick={() => toggleCanvas(true)} title="Open">
          <iframe src={thumbSrc} title="Your result" tabIndex={-1} scrolling="no" />
          <span className="cc-thumb-open">Open ↗</span>
        </button>
      )}
      <div className="cc-head">
        <span className="cc-check">✓</span> Your {noun} is ready
      </div>
      {completion.name && <div className="cc-name">{completion.name}</div>}
      <div className="cc-actions">
        <button className="cc-open" onClick={() => toggleCanvas(true)}>
          Open {noun}
        </button>
        {completion.kind === 'app' && !link && (
          <button className="cc-link" onClick={publish} disabled={busy}>
            {busy ? PUB_PHASES[phase] : '🔗 Share it'}
          </button>
        )}
      </div>
      {link && (
        <div className="cc-live">
          <strong>✓ Live — share with anyone, no login needed.</strong>
          <div className="cc-link-row">
            <a href={link} target="_blank" rel="noreferrer">
              {link}
            </a>
            <button className="cc-copy" onClick={copy}>
              {copied ? 'Copied ✓' : 'Copy'}
            </button>
          </div>
          <span className="cc-note">Stays live for 24 hours — re-publish any time to refresh it.</span>
        </div>
      )}
      {failed && (
        <div className="cc-recover">
          <span>Putting it online hit a snag.</span>
          <button className="cc-fix" onClick={fixAndRepublish}>
            Fix &amp; republish
          </button>
        </div>
      )}
      {err && <div className="cc-err">{err}</div>}
    </div>
  );
}

export function Chat({ live, sessionId }: { live: LiveState; sessionId: string }) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const itemCount =
    live.items.length +
    (live.pendingAssistant ? 1 : 0) +
    (live.pendingTools?.calls.length ?? 0) +
    (live.pendingAssistant?.text.length ?? 0);

  // Only autoscroll when the user is already near the bottom — never yank them down
  // while they've scrolled up to read earlier output during a long run.
  useEffect(() => {
    const el = scrollRef.current;
    const nearBottom = !el || el.scrollHeight - el.scrollTop - el.clientHeight < 140;
    if (nearBottom) bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [itemCount, live.running]);

  return (
    <div className="chat" ref={scrollRef}>
      <div className="chat-inner">
        {live.items.length === 0 && !live.running && !live.pendingAssistant && !live.pendingTools && (
          <div className="chat-ready">
            <span className="logo-mark" />
            <p>Ready when you are — tell me what you need and I’ll take it from here.</p>
          </div>
        )}
        {live.items.map((item) => (
          <TimelineRow key={item.id} item={item} sessionId={sessionId} />
        ))}
        {live.pendingTools && <ToolActivity calls={live.pendingTools.calls} running />}
        {live.pendingAssistant && (
          <div className="assistant-prose">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{live.pendingAssistant.text}</ReactMarkdown>
          </div>
        )}
        {live.running && <StatusFooter live={live} sessionId={sessionId} />}
        {!live.running && live.completion && (
          <CompletionCard completion={live.completion} sessionId={sessionId} />
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
