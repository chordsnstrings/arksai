import { useEffect, useState } from 'react';
import type { GithubRepo } from '@shared/types';
import { api } from '../api/client';
import { useStore } from '../state/sessionStore';
import { ConnectionsPanel } from './ConnectionsPanel';

const GH_ICON = (
  <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
  </svg>
);

/** Account-level GitHub management: connect / disconnect + create a new repo right here. */
function GithubCard() {
  const [status, setStatus] = useState<{ enabled: boolean; connected: boolean; login?: string | null } | null>(null);
  const [repos, setRepos] = useState<GithubRepo[]>([]);
  const [newName, setNewName] = useState('');
  const [priv, setPriv] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const load = () => api.githubStatus().then(setStatus).catch(() => setStatus({ enabled: false, connected: false }));
  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    if (status?.connected) api.githubRepos('').then((r) => setRepos(r.slice(0, 6))).catch(() => {});
  }, [status?.connected]);

  if (!status) return <div className="conn-card">Loading…</div>;

  if (!status.enabled) {
    return (
      <div className="conn-card">
        <div className="conn-head">
          {GH_ICON} <strong>GitHub</strong>
        </div>
        <div className="conn-note">GitHub isn’t enabled on this workspace yet — the operator needs to add a GitHub OAuth app.</div>
      </div>
    );
  }

  const connect = () => {
    window.location.href = '/api/github/connect';
  };
  const disconnect = async () => {
    setBusy(true);
    await api.githubDisconnect().catch(() => {});
    setRepos([]);
    await load();
    setBusy(false);
  };
  const create = async () => {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    setErr('');
    setMsg('');
    try {
      const repo = await api.githubCreateRepo(name, priv);
      setRepos((r) => [repo, ...r].slice(0, 6));
      setNewName('');
      setMsg(`Created ${repo.fullName}`);
    } catch (e: any) {
      setErr(e?.message || 'Could not create the repository.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="conn-card">
      <div className="conn-head">
        {GH_ICON} <strong>GitHub</strong>
        {status.connected ? (
          <span className="conn-badge ok">@{status.login}</span>
        ) : (
          <span className="conn-badge">Not connected</span>
        )}
        <span style={{ flex: 1 }} />
        {status.connected ? (
          <button className="cancel" disabled={busy} onClick={disconnect}>
            Disconnect
          </button>
        ) : (
          <button className="send-btn" onClick={connect}>
            Connect GitHub
          </button>
        )}
      </div>
      {status.connected ? (
        <>
          <div className="conn-note">Push generated code to a repo you choose (per session) or create one here.</div>
          <div className="conn-create">
            <input placeholder="new-repo-name" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <label className="conn-priv">
              <input type="checkbox" checked={priv} onChange={(e) => setPriv(e.target.checked)} /> Private
            </label>
            <button className="send-btn" disabled={busy || !newName.trim()} onClick={create}>
              Create repo
            </button>
          </div>
          {msg && <div className="conn-ok">{msg}</div>}
          {err && <div className="conn-err">{err}</div>}
          {repos.length > 0 && (
            <div className="conn-repos">
              <div className="conn-sub">Recent repositories</div>
              {repos.map((r) => (
                <div key={r.fullName} className="conn-repo">
                  <span>{r.fullName}</span>
                  <span className="conn-repo-meta">{r.private ? 'private' : 'public'}</span>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="conn-note">Connect your GitHub account to push your builds to your own repositories.</div>
      )}
    </div>
  );
}

/**
 * The Connections hub — a user-facing place to manage every connector. GitHub for everyone;
 * the ad-platform connectors for org admins. Designed to grow as we add more connectors.
 */
export function ConnectionsDialog({ onClose }: { onClose: () => void }) {
  const me = useStore((s) => s.me);
  const isAdmin = me?.isSuperadmin || me?.role === 'admin';
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog conn-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="conn-title-row">
          <h2 style={{ margin: 0 }}>Connections</h2>
          <button className="cancel" onClick={onClose}>
            Close
          </button>
        </div>
        <div style={{ color: 'var(--text-faint)', fontSize: 12.5, margin: '2px 0 12px' }}>
          Connect the tools your work lives in. More connectors are on the way.
        </div>

        <GithubCard />

        {isAdmin && (
          <div className="conn-card">
            <div className="conn-head">
              <span style={{ fontSize: 18 }}>📣</span> <strong>Advertising platforms</strong>
              <span className="conn-badge">org</span>
            </div>
            <div className="conn-note">Connect Meta / Google / TikTok ad accounts to pull live performance into reports.</div>
            <ConnectionsPanel />
          </div>
        )}
      </div>
    </div>
  );
}
