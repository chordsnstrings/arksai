import { useRef, useState } from 'react';
import type { ModelId, SessionMeta } from '@shared/types';
import { MODELS } from '@shared/types';
import { api } from '../api/client';
import { useStore } from '../state/sessionStore';

export function Composer({ meta, running }: { meta: SessionMeta; running: boolean }) {
  const [text, setText] = useState('');
  const taRef = useRef<HTMLTextAreaElement>(null);
  const upsertSession = useStore((s) => s.upsertSession);
  const addUserMessage = useStore((s) => s.addUserMessage);
  const loadDetail = useStore((s) => s.loadDetail);

  const setMode = async (mode: 'plan' | 'code') => {
    if (running || mode === meta.mode) return;
    const updated = await api.patchSession(meta.id, { mode });
    upsertSession(updated);
  };

  const cycleModel = async () => {
    if (running) return;
    const next = MODELS[(MODELS.indexOf(meta.model) + 1) % MODELS.length] as ModelId;
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
    const modeMatch = value.match(/^\/mode\s+(plan|code)$/);
    if (modeMatch) {
      await setMode(modeMatch[1] as 'plan' | 'code');
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
      <div className="composer">
        <textarea
          ref={taRef}
          rows={1}
          placeholder="Type / for commands"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            autoGrow();
          }}
          onKeyDown={onKeyDown}
        />
        <div className="composer-bar">
          <div className="mode-toggle">
            <button className={meta.mode === 'plan' ? 'on' : ''} onClick={() => setMode('plan')}>
              Plan
            </button>
            <button className={meta.mode === 'code' ? 'on' : ''} onClick={() => setMode('code')}>
              Code
            </button>
          </div>
          <span className="spacer" />
          <button className="model-badge" onClick={cycleModel} title="Switch model">
            {meta.model}
          </button>
          <button className="send-btn" disabled={!text.trim() || running} onClick={send}>
            {running ? '…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
