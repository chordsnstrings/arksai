import { useRef, useState } from 'react';
import type { SessionMeta, SessionMode } from '@shared/types';
import { FALLBACK_MODEL_IDS, modelLabel } from '@shared/types';
import { api } from '../api/client';
import { useStore } from '../state/sessionStore';

export function Composer({ meta, running }: { meta: SessionMeta; running: boolean }) {
  const [text, setText] = useState('');
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const upsertSession = useStore((s) => s.upsertSession);
  const addUserMessage = useStore((s) => s.addUserMessage);
  const loadDetail = useStore((s) => s.loadDetail);

  const setMode = async (mode: SessionMode) => {
    if (running || mode === meta.mode) return;
    const updated = await api.patchSession(meta.id, { mode });
    upsertSession(updated);
  };

  const modelIds = useStore((s) => s.models).map((m) => m.id);
  const cycleModel = async () => {
    if (running) return;
    const ids = modelIds.length ? modelIds : FALLBACK_MODEL_IDS;
    const idx = ids.indexOf(meta.model);
    const next = ids[(idx + 1) % ids.length];
    const updated = await api.patchSession(meta.id, { model: next });
    upsertSession(updated);
  };

  const send = async () => {
    const value = text.trim();
    if (!value || running) return;

    // slash commands
    if (value === '/clear') {
      await api.clear(meta.id);
      const detail = await api.getSession(meta.id);
      loadDetail(detail);
      upsertSession(detail.meta);
      setText('');
      return;
    }
    const modeMatch = value.match(/^\/mode\s+(chat|plan|code)$/);
    if (modeMatch) {
      await setMode(modeMatch[1] as SessionMode);
      setText('');
      return;
    }

    setText('');
    addUserMessage(meta.id, value);
    try {
      await api.sendMessage(meta.id, value);
    } catch (err: any) {
      alert(err?.message ?? 'Failed to send');
    }
  };

  const uploadFiles = async (files: FileList | File[]) => {
    const list = [...files];
    if (list.length === 0 || uploading) return;
    const form = new FormData();
    for (const file of list) form.append('files', file, file.name);
    setUploading(true);
    try {
      const res = await fetch(`/api/sessions/${meta.id}/upload`, {
        method: 'POST',
        body: form,
        credentials: 'same-origin',
      });
      if (!res.ok) {
        let message = res.statusText;
        try {
          message = (await res.json()).error ?? message;
        } catch {}
        throw new Error(message);
      }
    } catch (err: any) {
      alert(err?.message ?? 'Upload failed');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
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

  return (
    <div className="composer-wrap">
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
            autoGrow();
          }}
          onKeyDown={onKeyDown}
        />
        <div className="composer-bar">
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            onChange={(e) => e.target.files && uploadFiles(e.target.files)}
          />
          <button
            className="attach-btn"
            title="Upload files to the workspace (or drag & drop)"
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
          </div>
          <span className="spacer" />
          <button className="model-badge" onClick={cycleModel} title={`${meta.model} — click to switch model`}>
            {modelLabel(meta.model)}
          </button>
          <button className="send-btn" disabled={!text.trim() || running} onClick={send}>
            {running ? '…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
