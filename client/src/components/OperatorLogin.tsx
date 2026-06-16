import { useState } from 'react';
import { api } from '../api/client';

/**
 * Platform-operator (super-admin) sign-in — a deliberately separate, unlinked
 * space at /operator, so the shared operator password is never surfaced on the
 * team login page. Team members use the email+password LoginScreen instead.
 */
export function OperatorLogin() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.login(password); // shared operator password → platform super-admin
      window.location.href = '/'; // reload into the app, logged in (clean URL)
    } catch (err: any) {
      setError(err?.message ?? 'Login failed');
      setBusy(false);
    }
  };

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={submit}>
        <h1>
          <span className="logo-mark" />
          <span className="name">ArksAI</span>
          <span className="badge">operator</span>
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '0 0 8px' }}>Platform operator sign-in.</p>
        <input
          type="password"
          placeholder="Operator password"
          value={password}
          autoFocus
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <div className="error">{error}</div>}
        <button className="send-btn" type="submit" disabled={busy || !password}>
          {busy ? '…' : 'Log in'}
        </button>
      </form>
    </div>
  );
}
