import { useState } from 'react';
import { api } from '../api/client';

/**
 * The invite-accept screen (reached via /invite/<token>): a new member sets a
 * password to finish joining their org, then is logged straight in.
 */
export function InviteAccept({ token }: { token: string }) {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      setError('Use a password of at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('The passwords do not match.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.acceptInvite(token, password, name.trim() || undefined);
      window.location.href = '/'; // a fresh session cookie is set — boot in, logged in
    } catch (err: any) {
      setError(err?.message ?? 'Could not accept this invite.');
      setBusy(false);
    }
  };

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={submit}>
        <h1>
          <span className="logo-mark" />
          <span className="name">ArksAI</span>
          <span className="badge">studio</span>
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: '0 0 8px' }}>
          Join your team — set a password to finish.
        </p>
        <input type="text" placeholder="Your name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
        <input
          type="password"
          placeholder="Create a password"
          value={password}
          autoFocus
          onChange={(e) => setPassword(e.target.value)}
        />
        <input
          type="password"
          placeholder="Confirm password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        {error && <div className="error">{error}</div>}
        <button className="send-btn" type="submit" disabled={busy}>
          {busy ? '…' : 'Accept invite'}
        </button>
      </form>
    </div>
  );
}
