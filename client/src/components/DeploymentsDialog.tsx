import { useEffect, useState } from 'react';
import type { Deployment, SessionMeta } from '@shared/types';
import { api } from '../api/client';

/** "expires in 23h 12m" countdown for the 24h-preview window. */
function expiresLabel(ms?: number | null): string {
  if (ms == null) return '';
  const left = ms - Date.now();
  if (left <= 0) return 'expired';
  const h = Math.floor(left / 3_600_000);
  const m = Math.floor((left % 3_600_000) / 60_000);
  return h > 0 ? `expires in ${h}h ${m}m` : `expires in ${m}m`;
}

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
    setLatest('');
    try {
      const dep = await api.publish(meta.id, meta.title === 'New session' ? undefined : meta.title);
      // Only surface the live URL when the deployment is verified-green. A failed
      // post-publish smoke test means the user must NOT get a broken link.
      if (dep.status === 'running') {
        setLatest(dep.url);
      } else {
        setError(
          dep.verifyDetail
            ? `The published app failed its live check, so the URL is held back. Ask the agent to fix it and republish.\n\n${dep.verifyDetail}`
            : "The published app didn't start, so the URL is held back. Ask the agent to fix it and republish.",
        );
      }
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
        <h2>Publish & share</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 0 }}>
          Publish a <strong>24-hour preview link</strong> anyone can open and share — no login needed to view. It
          auto-deletes after 24 hours; re-publish any time to refresh the window.
        </p>

        <button className="send-btn" onClick={publish} disabled={busy} style={{ alignSelf: 'flex-start' }}>
          {busy ? 'Publishing…' : '🚀 Publish 24-hour preview'}
        </button>

        {latest && (
          <div style={{ marginTop: 8 }}>
            <div style={{ color: 'var(--green, #16a34a)', fontSize: 12, marginBottom: 4 }}>
              ✓ Verified live — the public URL renders cleanly.
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 4 }}>
              Live for 24 hours · share with anyone · re-publish to refresh.
            </div>
            <div className="kb-row">
              <span className="kb-name">
                <a href={fullUrl(latest)} target="_blank" rel="noreferrer">
                  {fullUrl(latest)}
                </a>
              </span>
              <a className="canvas-btn" href={fullUrl(latest)} target="_blank" rel="noreferrer">
                Open
              </a>
              <button className="canvas-btn" onClick={() => navigator.clipboard?.writeText(fullUrl(latest))}>
                Copy
              </button>
            </div>
          </div>
        )}
        {error && (
          <div style={{ color: 'var(--red)', fontSize: 13, whiteSpace: 'pre-wrap', marginTop: 6 }}>{error}</div>
        )}

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
                  <span style={{ color: 'var(--text-faint)' }}>
                    · {d.kind} · {d.status}
                    {d.expiresAt ? ` · ${expiresLabel(d.expiresAt)}` : ''}
                  </span>
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
