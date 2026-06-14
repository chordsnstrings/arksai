import { useEffect, useState } from 'react';
import type { Deployment, SessionMeta } from '@shared/types';
import { api } from '../api/client';

export function DeploymentsDialog({ meta, onClose }: { meta: SessionMeta; onClose: () => void }) {
  const [deps, setDeps] = useState<Deployment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [latest, setLatest] = useState<string>('');

  const refresh = () => api.listDeployments(meta.id).then(setDeps).catch(() => {});
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta.id]);

  const fullUrl = (u: string) => `${window.location.origin}${u}`;

  const publish = async () => {
    setBusy(true);
    setError('');
    try {
      const dep = await api.publish(meta.id, meta.title === 'New session' ? undefined : meta.title);
      setLatest(dep.url);
      await refresh();
    } catch (e: any) {
      setError(e?.message ?? 'Publish failed');
    } finally {
      setBusy(false);
    }
  };

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog wide" onClick={(e) => e.stopPropagation()}>
        <h2>Publish & deployments</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 0 }}>
          Put this app live at a durable URL anyone can open. It survives the session and server restarts.
        </p>

        <button className="send-btn" onClick={publish} disabled={busy} style={{ alignSelf: 'flex-start' }}>
          {busy ? 'Publishing…' : '🚀 Publish this app'}
        </button>

        {latest && (
          <div className="kb-row" style={{ marginTop: 8 }}>
            <span className="kb-name">
              <a href={fullUrl(latest)} target="_blank" rel="noreferrer">
                {fullUrl(latest)}
              </a>
            </span>
            <button className="canvas-btn" onClick={() => navigator.clipboard?.writeText(fullUrl(latest))}>
              Copy
            </button>
          </div>
        )}
        {error && <div style={{ color: 'var(--red)', fontSize: 13 }}>{error}</div>}

        <div style={{ marginTop: 10 }}>
          <label>Live deployments</label>
          <div className="kb-list">
            {deps.length === 0 && (
              <div style={{ color: 'var(--text-faint)', fontSize: 12, padding: '4px 2px' }}>None yet.</div>
            )}
            {deps.map((d) => (
              <div key={d.id} className="kb-row">
                <span className={`status-dot ${d.status === 'running' ? 'idle' : 'error'}`} />
                <span className="kb-name">
                  <a href={fullUrl(d.url)} target="_blank" rel="noreferrer">
                    {d.slug}
                  </a>{' '}
                  <span style={{ color: 'var(--text-faint)' }}>· {d.kind} · {d.status}</span>
                </span>
                {d.kind !== 'static' &&
                  (d.status === 'running' ? (
                    <button className="canvas-btn" onClick={() => act(() => api.stopDeployment(d.slug))}>
                      Stop
                    </button>
                  ) : (
                    <button className="canvas-btn" onClick={() => act(() => api.restartDeployment(d.slug))}>
                      Restart
                    </button>
                  ))}
                <button className="kb-del" title="Delete" onClick={() => act(() => api.deleteDeployment(d.slug))}>
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="actions">
          <button className="cancel" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
