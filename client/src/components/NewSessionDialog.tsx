import { useState } from 'react';
import type { ModelId, SessionMode } from '@shared/types';
import { AUTO_MODEL, DEFAULT_MODEL, FALLBACK_MODEL_IDS, modelLabel } from '@shared/types';
import { api } from '../api/client';
import { useStore } from '../state/sessionStore';

/** One-line, confidence-building description of what each mode does. */
const MODE_DESC: Record<SessionMode, string> = {
  code: 'Build & ship a working app, site, or tool — verified end-to-end.',
  plan: 'Explore the code and produce a step-by-step plan (no changes made).',
  chat: 'Talk it through — questions, review, research. No file changes.',
  report: 'Turn data into a polished, presentation-grade PDF or slide deck.',
};

export function NewSessionDialog({
  onClose,
  projectId: initialProjectId = null,
}: {
  onClose: () => void;
  projectId?: string | null;
}) {
  const models = useStore((s) => s.models);
  const projects = useStore((s) => s.projects);
  const modelIds = models.length ? models.map((m) => m.id) : FALLBACK_MODEL_IDS;
  const [projectId, setProjectId] = useState<string | null>(initialProjectId);
  const [repoUrl, setRepoUrl] = useState('');
  const [branch, setBranch] = useState('');
  const [mode, setMode] = useState<SessionMode>('code');
  // Default to ArksAI Auto — the orchestrator picks the best engine per task.
  const [model, setModel] = useState<ModelId>(
    modelIds.includes(AUTO_MODEL) ? AUTO_MODEL : modelIds.includes(DEFAULT_MODEL) ? DEFAULT_MODEL : modelIds[0],
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const upsertSession = useStore((s) => s.upsertSession);
  const setActive = useStore((s) => s.setActive);

  // When a project is chosen, its defaults fill in (the server is authoritative,
  // but this previews the inheritance so blank fields aren't confusing).
  const proj = projects.find((p) => p.id === projectId);

  const create = async () => {
    setBusy(true);
    setError('');
    try {
      const session = await api.createSession({
        projectId: projectId ?? undefined,
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
        {projects.length > 0 && (
          <div>
            <label>Project</label>
            <select value={projectId ?? ''} onChange={(e) => setProjectId(e.target.value || null)}>
              <option value="">None (standalone)</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {proj && (
              <div style={{ color: 'var(--text-faint)', fontSize: 12, marginTop: 4 }}>
                Inherits this project's instructions, knowledge & branding. Leave fields blank to use its defaults.
              </div>
            )}
          </div>
        )}
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
              <option value="report">Report</option>
            </select>
          </div>
        </div>
        <div style={{ color: 'var(--text-faint)', fontSize: 12, marginTop: -4 }}>{MODE_DESC[mode]}</div>
        <div>
          <label>Model</label>
          <select value={model} onChange={(e) => setModel(e.target.value as ModelId)}>
            {modelIds.map((id) => (
              <option key={id} value={id}>
                {modelLabel(id)}
              </option>
            ))}
          </select>
          {model === AUTO_MODEL && (
            <div style={{ color: 'var(--text-faint)', fontSize: 12, marginTop: 4 }}>
              We pick the best engine for the job and step up automatically if a task needs more power.
            </div>
          )}
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
