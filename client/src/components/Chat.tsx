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
  submit_plan: 'Sharing the plan',
  generate_creative: 'Designing the creative',
  generate_compliance_file: 'Preparing the filing',
  verify: 'Checking it works',
  crawl_site: 'Reading your website',
  save_org_profile: 'Saving your brand',
};

// Friendly label for any tool — falls back to a humanized "snake_case" → "Snake case"
// so a newly-added tool never shows the user a raw machine name in the ticker.
function toolLabel(name: string): string {
  return TOOL_LABEL[name] ?? name.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

function ToolRow({ call }: { call: ToolCallRecord }) {
  const [open, setOpen] = useState(false);
  const label = toolLabel(call.tool);
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
    const label = toolLabel(c.tool);
    byTool.set(label, (byTool.get(label) ?? 0) + 1);
  }
  const counts = [...byTool.entries()].map(([t, n]) => `${t} · ${n}`).join('  ');
  // While running, lead with a live one-line ticker of the CURRENT action.
  const current = running ? calls[calls.length - 1] : null;
  const ticker = current ? toolLabel(current.tool) : null;
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

const DELIVERABLE_NOUN: Record<string, string> = { app: 'app', pdf: 'report', sheet: 'spreadsheet', doc: 'document', image: 'creative' };

// Keep momentum after a delivery: 2 contextual next steps that pre-fill the composer
// (editable, never auto-sent) so the user always has an obvious "what now".
const NEXT_STEPS: Record<string, { label: string; prompt: string }[]> = {
  app: [
    { label: '+ Add a feature', prompt: 'Add this to the app: ' },
    { label: 'Tweak the design', prompt: 'Refine the design: ' },
  ],
  image: [
    { label: 'Make a variation', prompt: 'Make another version of this — same brief, but ' },
    { label: 'Resize it', prompt: 'Make this creative in another size/aspect ratio: ' },
  ],
  pdf: [
    { label: 'Make an edit', prompt: 'Revise the report: ' },
    { label: 'Turn into a deck', prompt: 'Turn this into a polished 16:9 slide deck.' },
  ],
  doc: [
    { label: 'Make an edit', prompt: 'Revise the document: ' },
    { label: 'Make a PDF', prompt: 'Produce a polished, print-ready PDF version of this.' },
  ],
  sheet: [
    { label: 'Add an analysis', prompt: 'Add this analysis/tab to the spreadsheet: ' },
    { label: 'Build a dashboard', prompt: 'Build a dashboard from this data.' },
  ],
};

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
  const isImageThumb = canvasTarget?.kind === 'image';
  if (canvasTarget?.port) thumbSrc = `/api/sessions/${sessionId}/preview/${canvasTarget.port}/`;
  else if (canvasTarget?.file) {
    const f = canvasTarget.file.split('/').map(encodeURIComponent).join('/');
    // An image (or PDF) shows its raw bytes; docs render via the doc viewer.
    thumbSrc =
      isImageThumb || canvasTarget.kind === 'pdf'
        ? `/api/sessions/${sessionId}/files/${f}?inline=1`
        : `/api/sessions/${sessionId}/docview/${f}`;
  }

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
          {isImageThumb ? (
            <img src={thumbSrc} alt="Your creative" />
          ) : (
            <iframe src={thumbSrc} title="Your result" tabIndex={-1} scrolling="no" />
          )}
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
      {(NEXT_STEPS[completion.kind] ?? []).length > 0 && (
        <div className="cc-next">
          <span className="cc-next-label">What’s next?</span>
          {(NEXT_STEPS[completion.kind] ?? []).map((s) => (
            <button
              key={s.label}
              className="cc-next-chip"
              onClick={() => window.dispatchEvent(new CustomEvent('arksai:compose', { detail: s.prompt }))}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Plan mode parked awaiting the user's nod — the explicit Approve / Revise gate. */
function PlanApprovalCard({ sessionId }: { sessionId: string }) {
  const addUserMessage = useStore((s) => s.addUserMessage);
  const beginRun = useStore((s) => s.beginRun);
  const [busy, setBusy] = useState(false);

  const approve = async () => {
    if (busy) return;
    setBusy(true);
    const msg = 'Approved — build it now, end to end and autonomously. No more check-ins.';
    addUserMessage(sessionId, msg);
    beginRun(sessionId);
    try {
      await api.sendMessage(sessionId, msg);
    } catch {
      /* the optimistic running state clears on the next event */
    }
  };

  return (
    <div className="plan-card reveal">
      <div className="pc-head">
        <span className="pc-badge">Plan ready</span>
        Approve to build it autonomously, or tell me what to change.
      </div>
      <div className="pc-actions">
        <button className="pc-approve" onClick={approve} disabled={busy}>
          {busy ? 'Starting…' : '✓ Approve & build'}
        </button>
        <button
          className="pc-revise"
          disabled={busy}
          onClick={() => window.dispatchEvent(new Event('arksai:focus-composer'))}
        >
          Revise
        </button>
      </div>
    </div>
  );
}

export function Chat({ live, sessionId }: { live: LiveState; sessionId: string }) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const awaitingPlan = useStore((s) => s.sessions.find((x) => x.id === sessionId)?.awaitingPlan ?? false);
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
        {!live.running && awaitingPlan && <PlanApprovalCard sessionId={sessionId} />}
        {!live.running && live.completion && (
          <CompletionCard completion={live.completion} sessionId={sessionId} />
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
