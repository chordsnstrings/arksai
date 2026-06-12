import { useState } from 'react';
import type { ModelId, SessionMode } from '@shared/types';
import { DEFAULT_MODEL, FALLBACK_MODEL_IDS, modelLabel } from '@shared/types';
import { api } from '../api/client';
import { useStore } from '../state/sessionStore';

export function NewSessionDialog({ onClose }: { onClose: () => void }) {
  const models = useStore((s) => s.models);
  const modelIds = models.length ? models.map((m) => m.id) : FALLBACK_MODEL_IDS;
  const [repoUrl, setRepoUrl] = useState('');
  const [branch, setBranch] = useState('');
  const [mode, setMode] = useState<SessionMode>('code');
  const [model, setModel] = useState<ModelId>(modelIds.includes(DEFAULT_MODEL) ? DEFAULT_MODEL : modelIds[0]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const upsertSession = useStore((s) => s.upsertSession);
  const setActive = useStore((s) => s.setActive);

  const create = async () => {
    setBusy(true);
    setError('');
    try {
      const session = await api.createSession({
        repoUrl: repoUrl.trim() || undefined,
        branch: branch.trim() || undefined,
        mode,
        model,
      });
      upsertSession(session);
      setActive(session.id);
      onClose();
    } catch (err: any) {
      setError(err?.message ?? 'Failed to create session');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2>New session</h2>
        <div>
          <label>GitHub repository (optional)</label>
          <input
            placeholder="owner/repo or https://github.com/owner/repo"
            value={repoUrl}
            autoFocus
            onChange={(e) => setRepoUrl(e.target.value)}
          />
        </div>
        <div className="row">
          <div>
            <label>Branch (optional)</label>
            <input placeholder="default branch" value={branch} onChange={(e) => setBranch(e.target.value)} />
          </div>
          <div>
            <label>Mode</label>
            <select value={mode} onChange={(e) => setMode(e.target.value as SessionMode)}>
              <option value="code">Code</option>
              <option value="plan">Plan</option>
              <option value="chat">Chat</option>
            </select>
          </div>
        </div>
        <div>
          <label>Model</label>
          <select value={model} onChange={(e) => setModel(e.target.value as ModelId)}>
            {modelIds.map((id) => (
              <option key={id} value={id}>
                {modelLabel(id)}
              </option>
            ))}
          </select>
        </div>
        {error && <div className="error" style={{ color: 'var(--red)', fontSize: 13 }}>{error}</div>}
        <div className="actions">
          <button className="cancel" onClick={onClose}>
            Cancel
          </button>
          <button className="send-btn" onClick={create} disabled={busy}>
            {busy ? '…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
