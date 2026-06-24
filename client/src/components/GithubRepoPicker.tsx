import { useEffect, useState } from 'react';
import type { GithubRepo } from '@shared/types';
import { api } from '../api/client';

export interface RepoSelection {
  repoUrl: string;
  branch: string;
  connectionId: string;
}

interface Status {
  enabled: boolean;
  connected: boolean;
  login?: string | null;
  connectionId?: string | null;
}

const linkish: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--accent)',
  cursor: 'pointer',
  padding: 0,
  fontSize: 12,
};

/**
 * Connect-your-GitHub + pick-a-repo control. Hidden entirely when the feature is not configured
 * on the server. When connected it lists the user's pushable repos (searchable) and can create a
 * new one. Calls onSelect with the chosen repo (+ the user's connection id) or null.
 */
export function GithubRepoPicker({ onSelect, compact }: { onSelect: (sel: RepoSelection | null) => void; compact?: boolean }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [repos, setRepos] = useState<GithubRepo[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPriv, setNewPriv] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.githubStatus().then(setStatus).catch(() => setStatus({ enabled: false, connected: false }));
  }, []);
  useEffect(() => {
    if (status?.connected) {
      setLoading(true);
      api.githubRepos('').then(setRepos).catch(() => {}).finally(() => setLoading(false));
    }
  }, [status?.connected]);

  if (!status || !status.enabled) return null; // dormant feature → render nothing

  const connect = () => {
    window.location.href = '/api/github/connect';
  };
  const choose = (fullName: string) => {
    setPicked(fullName);
    const r = repos.find((x) => x.fullName === fullName);
    if (r && status.connectionId) onSelect({ repoUrl: `https://github.com/${r.fullName}`, branch: r.defaultBranch, connectionId: status.connectionId });
    else onSelect(null);
  };
  const create = async () => {
    setErr('');
    setBusy(true);
    try {
      const r = await api.githubCreateRepo(newName.trim(), newPriv);
      setRepos((p) => [r, ...p]);
      setCreating(false);
      setNewName('');
      choose(r.fullName);
    } catch (e: any) {
      setErr(e?.message ?? 'Could not create the repository.');
    } finally {
      setBusy(false);
    }
  };
  const disconnect = async () => {
    await api.githubDisconnect().catch(() => {});
    setStatus({ ...status, connected: false, login: null, connectionId: null });
    setRepos([]);
    setPicked('');
    onSelect(null);
  };

  if (!status.connected) {
    return (
      <div>
        <label>Push to GitHub (optional)</label>
        <button type="button" className="cancel" onClick={connect}>
          Connect GitHub
        </button>
        <div style={{ color: 'var(--text-faint)', fontSize: 12, marginTop: 4 }}>
          Connect your GitHub account to push the generated code to a repo you choose.
        </div>
      </div>
    );
  }

  const filtered = q.trim() ? repos.filter((r) => r.fullName.toLowerCase().includes(q.toLowerCase())) : repos;
  return (
    <div>
      {compact ? (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" onClick={disconnect} style={{ ...linkish, color: 'var(--text-faint)' }}>
            disconnect @{status.login}
          </button>
        </div>
      ) : (
        <label>
          Push to GitHub — @{status.login}{' '}
          <button type="button" onClick={disconnect} style={linkish}>
            disconnect
          </button>
        </label>
      )}
      {!creating ? (
        <>
          <input
            placeholder={loading ? 'Loading your repositories…' : 'Search your repositories'}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select aria-label="Repository" value={picked} onChange={(e) => choose(e.target.value)}>
            <option value="">Choose a repository…</option>
            {filtered.slice(0, 50).map((r) => (
              <option key={r.fullName} value={r.fullName}>
                {r.fullName}
                {r.private ? ' · private' : ''}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => setCreating(true)} style={{ ...linkish, marginTop: 6 }}>
            + New repository
          </button>
        </>
      ) : (
        <div className="row" style={{ alignItems: 'center' }}>
          <input placeholder="new-repo-name" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <input type="checkbox" checked={newPriv} onChange={(e) => setNewPriv(e.target.checked)} /> Private
          </label>
          <button type="button" className="send-btn" disabled={busy || !newName.trim()} onClick={create}>
            {busy ? '…' : 'Create'}
          </button>
          <button type="button" className="cancel" onClick={() => setCreating(false)}>
            Cancel
          </button>
        </div>
      )}
      {picked && !compact && <div style={{ color: 'var(--text-faint)', fontSize: 12, marginTop: 4 }}>Code will push to {picked}.</div>}
      {err && <div style={{ color: 'var(--red)', fontSize: 12, marginTop: 4 }}>{err}</div>}
    </div>
  );
}
