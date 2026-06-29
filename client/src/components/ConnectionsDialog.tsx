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
    // Keep the under-chat RepoBar in sync without a reload.
    window.dispatchEvent(new Event('arksai:github-changed'));
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

const GG_ICON = (
  <svg width="20" height="20" viewBox="0 0 18 18" aria-hidden="true">
    <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
    <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
    <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z" />
    <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.47.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
  </svg>
);

/** Account-level Google Workspace connection: Gmail / Calendar / Drive·Sheets for the agent & robots. */
function GoogleCard() {
  const [status, setStatus] = useState<{ enabled: boolean; connected: boolean; email?: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const load = () => api.googleConnStatus().then(setStatus).catch(() => setStatus({ enabled: false, connected: false }));
  useEffect(() => {
    load();
    // Surface the OAuth round-trip result (?google=connected|failed|invalid).
    const p = new URLSearchParams(window.location.search);
    const r = p.get('google');
    if (r) {
      setMsg(r === 'connected' ? 'Google connected.' : r === 'cancelled' ? 'Connection cancelled.' : `Couldn’t connect (${r}).`);
      p.delete('google');
      const qs = p.toString();
      window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''));
    }
  }, []);

  if (!status) return <div className="conn-card">Loading…</div>;

  if (!status.enabled) {
    return (
      <div className="conn-card">
        <div className="conn-head">
          {GG_ICON} <strong>Google Workspace</strong>
        </div>
        <div className="conn-note">Google isn’t enabled on this workspace yet — the operator needs to add a Google OAuth client.</div>
      </div>
    );
  }

  const connect = () => {
    window.location.href = '/api/google/connect';
  };
  const disconnect = async () => {
    setBusy(true);
    await api.googleDisconnect().catch(() => {});
    await load();
    setBusy(false);
  };

  return (
    <div className="conn-card">
      <div className="conn-head">
        {GG_ICON} <strong>Google Workspace</strong>
        {status.connected ? (
          <span className="conn-badge ok">{status.email || 'connected'}</span>
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
            Connect Google
          </button>
        )}
      </div>
      <div className="conn-note">
        {status.connected
          ? 'Connected — the agent & robots can work with your Gmail, Calendar, Drive/Sheets and Google Ads.'
          : 'Connect your Google account so the agent & robots can send/read email (Gmail), manage events (Calendar), read your Sheets/Drive, and pull Google Ads performance.'}
      </div>
      {msg && <div className="conn-ok">{msg}</div>}
      <div className="conn-note" style={{ color: 'var(--text-faint)', fontSize: 11.5 }}>
        These use Google-restricted permissions — until this app finishes Google’s verification, only
        people added as test users in Google Cloud can connect. (Google Ads reporting also needs a
        developer token added by the operator.)
      </div>
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

        <GoogleCard />

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
