import { useState } from 'react';
import { api } from '../api/client';
import { useStore } from '../state/sessionStore';

/** Team-member sign-in (email + password). The platform operator signs in separately at /operator. */
export function LoginScreen({ onBack }: { onBack?: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const setAuthed = useStore((s) => s.setAuthed);
  const setMe = useStore((s) => s.setMe);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.loginUser(email.trim(), password);
      const me = await api.me().catch(() => null);
      if (me) setMe(me);
      setAuthed(true);
    } catch (err: any) {
      setError(err?.message ?? 'Login failed');
    } finally {
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
        <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '0 0 8px' }}>Welcome back — your studio’s ready.</p>
        <input type="email" placeholder="Work email" value={email} autoFocus onChange={(e) => setEmail(e.target.value)} />
        <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <div className="error">{error}</div>}
        <button className="send-btn" type="submit" disabled={busy || !email || !password}>
          {busy ? '…' : 'Log in'}
        </button>
        {onBack && (
          <button type="button" className="login-back" onClick={onBack}>
            ← Back
          </button>
        )}
      </form>
    </div>
  );
}
