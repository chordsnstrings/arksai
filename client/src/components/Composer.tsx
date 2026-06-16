import { useEffect, useRef, useState } from 'react';
import type { SessionMeta, SessionMode } from '@shared/types';
import { computeCost, expandTemplate, FALLBACK_MODEL_IDS, modelLabel } from '@shared/types';
import { api } from '../api/client';
import { useStore } from '../state/sessionStore';
import { clearLoopTimer, startLoopTimer } from '../api/useAutomation';
import { COMMANDS, matchCommands, type CommandMeta } from '../commands';

function parseInterval(s: string): number | null {
  const m = s.match(/^(\d+)(s|m|h)?$/);
  if (!m) return null;
  const n = Number(m[1]);
  return n * (m[2] === 'h' ? 3600000 : m[2] === 's' ? 1000 : 60000);
}

export function Composer({
  meta,
  running,
  onOpenCommands,
  onOpenMemory,
}: {
  meta: SessionMeta;
  running: boolean;
  onOpenCommands: () => void;
  onOpenMemory: () => void;
}) {
  const [text, setText] = useState('');
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [attached, setAttached] = useState<string[]>([]);
  const [menuIdx, setMenuIdx] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Pending attachments are per-session; drop the hint when the session changes,
  // and focus the box so the user can just type the moment a session opens.
  useEffect(() => {
    setAttached([]);
    taRef.current?.focus();
  }, [meta.id]);

  const upsertSession = useStore((s) => s.upsertSession);
  const addUserMessage = useStore((s) => s.addUserMessage);
  const beginRun = useStore((s) => s.beginRun);
  const forceStop = useStore((s) => s.forceStop);
  const addLocalSystem = useStore((s) => s.addLocalSystem);
  const loadDetail = useStore((s) => s.loadDetail);
  const setActive = useStore((s) => s.setActive);
  const models = useStore((s) => s.models);
  const live = useStore((s) => s.live[meta.id]);
  const customCommands = useStore((s) => s.commands);
  const toggleCanvas = useStore((s) => s.toggleCanvas);
  const setAutomation = useStore((s) => s.setAutomation);

  const modelIds = models.map((m) => m.id);
  const customMetas: CommandMeta[] = customCommands.map((c) => ({
    name: c.name,
    desc: c.description || 'custom command',
    arg: '[args]',
    custom: true,
  }));
  const menuItems = menuOpen ? matchCommands(text, customMetas) : [];

  const setMode = async (mode: SessionMode) => {
    if (mode === meta.mode) return;
    upsertSession(await api.patchSession(meta.id, { mode }));
  };

  const cycleModel = async () => {
    if (running) return;
    const ids = modelIds.length ? modelIds : FALLBACK_MODEL_IDS;
    const next = ids[(ids.indexOf(meta.model) + 1) % ids.length];
    upsertSession(await api.patchSession(meta.id, { model: next }));
  };

  const sys = (t: string, level: 'info' | 'error' = 'info') => addLocalSystem(meta.id, t, level);

  const sendToAgent = async (value: string) => {
    addUserMessage(meta.id, value);
    beginRun(meta.id); // optimistic: the progress bar + footer appear instantly
    try {
      await api.sendMessage(meta.id, value);
    } catch (err: any) {
      forceStop(meta.id); // roll back the optimistic running state
      setText(value); // don't lose what they typed
      sys(err?.message ?? 'Couldn’t send that — try again', 'error');
    }
  };

  async function runCommand(name: string, args: string) {
    // custom command? expand its template and send to the agent.
    const custom = customCommands.find((c) => c.name === name);
    if (custom) {
      await sendToAgent(expandTemplate(custom.template, args));
      return;
    }
    switch (name) {
      case 'help':
        sys('Commands:\n' + COMMANDS.map((c) => `/${c.name}${c.arg ? ' ' + c.arg : ''} — ${c.desc}`).join('\n'));
        break;
      case 'mode':
        if (['chat', 'plan', 'code', 'report'].includes(args)) await setMode(args as SessionMode);
        else sys('Usage: /mode chat|plan|code|report', 'error');
        break;
      case 'model':
        if (!args) sys('Available models:\n' + (modelIds.length ? modelIds : FALLBACK_MODEL_IDS).map((id) => `${id}${id === meta.model ? '  (current)' : ''}`).join('\n'));
        else {
          try {
            upsertSession(await api.patchSession(meta.id, { model: args }));
            sys(`Model set to ${args}`);
          } catch (e: any) {
            sys(e?.message ?? 'Invalid model', 'error');
          }
        }
        break;
      case 'clear': {
        await api.clear(meta.id);
        const detail = await api.getSession(meta.id);
        loadDetail(detail);
        upsertSession(detail.meta);
        break;
      }
      case 'stop':
        await api.interrupt(meta.id);
        sys('Interrupted.');
        break;
      case 'retry': {
        const lastUser = [...(live?.items ?? [])].reverse().find((i) => i.kind === 'user') as
          | { text: string }
          | undefined;
        if (lastUser) await sendToAgent(lastUser.text);
        else sys('Nothing to retry.', 'error');
        break;
      }
      case 'push':
        await sendToAgent(`Commit all current changes with a clear message and push${args ? ` to branch ${args}` : ''}.`);
        break;
      case 'diff': {
        const { diff } = await api.diff(meta.id);
        sys(diff);
        break;
      }
      case 'verify': {
        sys('Running project checks…');
        const { report } = await api.verify(meta.id);
        sys(report);
        break;
      }
      case 'files': {
        const { files } = await api.tree(meta.id);
        sys(files.length ? files.join('\n') : 'No files in the workspace.');
        break;
      }
      case 'ps': {
        const { processes } = await api.processes(meta.id);
        sys(
          processes.length
            ? processes
                .map((p) => `[${p.id}] ${p.name} — ${p.running ? 'running' : `exited (${p.exitCode ?? '?'})`}`)
                .join('\n')
            : 'No background processes.',
        );
        break;
      }
      case 'kill': {
        if (!args) return sys('Usage: /kill <process-id>', 'error');
        const r = await api.killProcess(meta.id, args);
        sys(r.killed ? `Killed ${args}.` : `${args} was not running.`);
        break;
      }
      case 'rename':
        if (!args) sys('Usage: /rename <title>', 'error');
        else upsertSession(await api.patchSession(meta.id, { title: args }));
        break;
      case 'cost': {
        const p = meta.promptTokens + (live?.running ? live.promptTokens : 0);
        const o = meta.completionTokens + (live?.running ? live.completionTokens : 0);
        const c =
          meta.costUsd +
          (live?.running
            ? computeCost(meta.model, { cacheHit: live.cacheHitTokens, cacheMiss: live.cacheMissTokens, completion: live.completionTokens })
            : 0);
        sys(`Session cost (${meta.model})\ninput:  ${p} tokens\noutput: ${o} tokens\ntotal:  ${p + o} tokens\ncost:   $${c < 0.01 ? c.toFixed(5) : c.toFixed(2)}`);
        break;
      }
      case 'new': {
        const session = await api.createSession(args ? { repoUrl: args } : {});
        upsertSession(session);
        setActive(session.id);
        break;
      }
      case 'canvas':
        toggleCanvas();
        break;
      case 'commands':
        onOpenCommands();
        break;
      case 'memory':
        onOpenMemory();
        break;
      case 'remember':
        if (!args) sys('Usage: /remember <fact>', 'error');
        else {
          try {
            await api.addMemory('global', args);
            sys(`🧠 Remembered (global): ${args}`);
          } catch (e: any) {
            sys(e?.message ?? 'Failed to save memory', 'error');
          }
        }
        break;
      case 'goal':
        if (!args || args === 'stop' || args === 'clear') {
          setAutomation(meta.id, null);
          sys('Goal cleared.');
        } else {
          setAutomation(meta.id, { goalCondition: args, goalRounds: 0 });
          sys(`🎯 Goal set: "${args}". The agent will keep working until it's met (or it needs you). /goal stop to cancel.`);
          await sendToAgent(
            `Work toward this goal until it is fully achieved: ${args}\n\nWhen it is complete, reply with GOAL_ACHIEVED on its own line. If you get blocked and need my input, say so.`,
          );
        }
        break;
      case 'loop': {
        const rest = args.trim();
        if (!rest || rest === 'stop') {
          clearLoopTimer(meta.id);
          sys('Loop stopped.');
          break;
        }
        const firstSpace = rest.indexOf(' ');
        const maybeInterval = firstSpace > 0 ? rest.slice(0, firstSpace) : rest;
        const ms = parseInterval(maybeInterval);
        const prompt = ms ? rest.slice(firstSpace + 1).trim() : rest;
        const intervalMs = ms ?? 600000;
        if (!prompt) return sys('Usage: /loop [interval e.g. 5m] <prompt>', 'error');
        startLoopTimer(meta.id, prompt, intervalMs);
        sys(`🔁 Looping every ${Math.round(intervalMs / 1000)}s: "${prompt}". /loop stop to cancel.`);
        await sendToAgent(prompt);
        break;
      }
      default:
        sys(`Unknown command: /${name}. Type /help for the list.`, 'error');
    }
  }

  const selectCommand = (cmd: CommandMeta) => {
    setMenuOpen(false);
    if (cmd.arg) {
      setText(`/${cmd.name} `);
      taRef.current?.focus();
    } else {
      setText('');
      void runCommand(cmd.name, '');
    }
  };

  const send = async () => {
    const value = text.trim();
    if (!value) return;
    if (value.startsWith('/')) {
      const m = value.match(/^\/(\w+)\s*([\s\S]*)$/);
      setText('');
      if (m) await runCommand(m[1], m[2].trim());
      return;
    }
    if (running) return;
    setText('');
    setAttached([]);
    await sendToAgent(value);
  };

  const uploadFiles = async (files: FileList | File[]) => {
    const list = [...files];
    if (list.length === 0 || uploading) return;
    const form = new FormData();
    for (const file of list) form.append('files', file, file.name);
    setUploading(true);
    try {
      const res = await fetch(`/api/sessions/${meta.id}/upload`, { method: 'POST', body: form, credentials: 'same-origin' });
      if (!res.ok) {
        let message = res.statusText;
        try {
          message = (await res.json()).error ?? message;
        } catch {}
        throw new Error(message);
      }
      // Seamless: surface what's attached and focus the box so the user just types
      // the request — the agent is told about these files automatically on the next run.
      setAttached((prev) => [...prev, ...list.map((f) => f.name)]);
      taRef.current?.focus();
    } catch (err: any) {
      sys(err?.message ?? 'Upload failed', 'error');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (menuItems.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMenuIdx((i) => (i + 1) % menuItems.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMenuIdx((i) => (i - 1 + menuItems.length) % menuItems.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        selectCommand(menuItems[Math.min(menuIdx, menuItems.length - 1)]);
        return;
      }
      if (e.key === 'Escape') {
        setMenuOpen(false);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const autoGrow = () => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  };

  const isCommand = text.trim().startsWith('/');

  return (
    <div className="composer-wrap">
      {menuItems.length > 0 && (
        <div className="cmd-menu">
          {menuItems.map((c, i) => (
            <button
              key={c.name}
              className={`cmd-item ${i === Math.min(menuIdx, menuItems.length - 1) ? 'active' : ''}`}
              onMouseEnter={() => setMenuIdx(i)}
              onClick={() => selectCommand(c)}
            >
              <span className="cmd-name">
                /{c.name}
                {c.arg && <span className="cmd-arg"> {c.arg}</span>}
              </span>
              <span className="cmd-desc">{c.desc}</span>
            </button>
          ))}
        </div>
      )}
      <div
        className={`composer ${dragOver ? 'drag-over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void uploadFiles(e.dataTransfer.files);
        }}
      >
        <textarea
          ref={taRef}
          rows={1}
          placeholder={meta.mode === 'chat' ? 'Chat with the model…' : 'Type / for commands'}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setMenuOpen(e.target.value.startsWith('/')); // command menu only for slash-commands
            setMenuIdx(0);
            autoGrow();
          }}
          onKeyDown={onKeyDown}
          onPaste={(e) => {
            const dt = e.clipboardData;
            if (!dt) return;
            // Files copied from the OS file manager arrive in .files; a pasted
            // screenshot sometimes only shows up as a .items file blob.
            let files: File[] = Array.from(dt.files);
            if (files.length === 0) {
              files = Array.from(dt.items)
                .filter((it) => it.kind === 'file')
                .map((it) => it.getAsFile())
                .filter((f): f is File => !!f);
            }
            if (files.length > 0) {
              e.preventDefault(); // don't also paste a path/blob URL as text
              void uploadFiles(files);
            }
          }}
        />
        {attached.length > 0 && (
          <div className="composer-attached">
            {attached.map((n, i) => (
              <span key={`${n}-${i}`} className="att-chip" title={n}>
                📎 {n}
              </span>
            ))}
            <span className="att-hint">
              attached — tell me what to do{attached.length > 1 ? ' with them' : ''}, or just say “go”.
            </span>
          </div>
        )}
        <div className="composer-bar">
          <input ref={fileRef} type="file" multiple hidden onChange={(e) => e.target.files && uploadFiles(e.target.files)} />
          <button
            className="attach-btn"
            title="Attach files — click, drag & drop, or paste (⌘/Ctrl+V)"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
          >
            {uploading ? '…' : '+'}
          </button>
          <div className="mode-toggle">
            <button className={meta.mode === 'chat' ? 'on' : ''} onClick={() => setMode('chat')}>
              Chat
            </button>
            <button className={meta.mode === 'plan' ? 'on' : ''} onClick={() => setMode('plan')}>
              Plan
            </button>
            <button className={meta.mode === 'code' ? 'on' : ''} onClick={() => setMode('code')}>
              Code
            </button>
            <button className={meta.mode === 'report' ? 'on' : ''} onClick={() => setMode('report')}>
              Report
            </button>
          </div>
          <span className="spacer" />
          <button className="model-badge" onClick={cycleModel} title={`${meta.model} — click to switch model`}>
            {modelLabel(meta.model)}
          </button>
          <button className="send-btn" disabled={!text.trim() || (running && !isCommand)} onClick={send}>
            {running && !isCommand ? '…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
