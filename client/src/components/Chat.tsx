import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { TimelineItem, ToolCallRecord } from '@shared/types';
import type { LiveState } from '../state/sessionStore';
import { api } from '../api/client';

const TOOL_LABEL: Record<string, string> = {
  bash: 'Bash',
  bash_background: 'Bash (bg)',
  bash_output: 'Logs',
  kill_process: 'Kill',
  read_file: 'Read',
  write_file: 'Write',
  edit_file: 'Edit',
  glob: 'Glob',
  grep: 'Grep',
  git_diff_stat: 'Diff',
  git_commit: 'Commit',
  git_push: 'Push',
};

function ToolRow({ call }: { call: ToolCallRecord }) {
  const [open, setOpen] = useState(false);
  const label = TOOL_LABEL[call.tool] ?? call.tool;
  return (
    <div className="tool-row">
      <div className="head" onClick={() => setOpen((v) => !v)}>
        {call.running ? (
          <span className="spin">✳</span>
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
  const [open, setOpen] = useState(false);
  const byTool = new Map<string, number>();
  for (const c of calls) {
    const label = TOOL_LABEL[c.tool] ?? c.tool;
    byTool.set(label, (byTool.get(label) ?? 0) + 1);
  }
  const counts = [...byTool.entries()].map(([t, n]) => `${t} · ${n}`).join('  ');
  return (
    <div className="tool-group">
      <button className="tool-group-header" onClick={() => setOpen((v) => !v)}>
        <span className={`chev ${open ? 'open' : ''}`}>▶</span>
        <span>{running ? 'Running agent' : 'Ran tools'}</span>
        <span className="counts">{counts}</span>
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

function TimelineRow({ item }: { item: TimelineItem }) {
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
  }
}

function StatusFooter({ live, sessionId }: { live: LiveState; sessionId: string }) {
  const tokens = live.tokens >= 1000 ? `${(live.tokens / 1000).toFixed(1)}k` : String(live.tokens);
  return (
    <div className="status-footer">
      <span className="glyph">✳</span>
      <span>
        {live.elapsed}s · {tokens} tokens · {live.runningTasks} running task
        {live.runningTasks === 1 ? '' : 's'}
      </span>
      <button className="stop" onClick={() => api.interrupt(sessionId).catch(() => {})}>
        Stop
      </button>
    </div>
  );
}

export function Chat({ live, sessionId }: { live: LiveState; sessionId: string }) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const itemCount =
    live.items.length +
    (live.pendingAssistant ? 1 : 0) +
    (live.pendingTools?.calls.length ?? 0) +
    (live.pendingAssistant?.text.length ?? 0);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [itemCount, live.running]);

  return (
    <div className="chat">
      <div className="chat-inner">
        {live.items.map((item) => (
          <TimelineRow key={item.id} item={item} />
        ))}
        {live.pendingTools && <ToolActivity calls={live.pendingTools.calls} running />}
        {live.pendingAssistant && (
          <div className="assistant-prose">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{live.pendingAssistant.text}</ReactMarkdown>
          </div>
        )}
        {live.running && <StatusFooter live={live} sessionId={sessionId} />}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
