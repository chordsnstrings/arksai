import { useState } from 'react';
import { api } from '../api/client';
import { useStore } from '../state/sessionStore';

export function LoginScreen({ onBack }: { onBack?: () => void }) {
  const [mode, setMode] = useState<'email' | 'password'>('email');
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
      if (mode === 'email') {
        await api.loginUser(email.trim(), password);
        const me = await api.me().catch(() => null);
        if (me) setMe(me);
      } else {
        await api.login(password);
      }
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
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          <button
            type="button"
            className={mode === 'email' ? 'send-btn' : 'cancel'}
            style={{ flex: 1 }}
            onClick={() => setMode('email')}
          >
            Team member
          </button>
          <button
            type="button"
            className={mode === 'password' ? 'send-btn' : 'cancel'}
            style={{ flex: 1 }}
            onClick={() => setMode('password')}
          >
            Operator
          </button>
        </div>
        {mode === 'email' && (
          <input
            type="email"
            placeholder="Work email"
            value={email}
            autoFocus
            onChange={(e) => setEmail(e.target.value)}
          />
        )}
        <input
          type="password"
          placeholder="Password"
          value={password}
          autoFocus={mode === 'password'}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <div className="error">{error}</div>}
        <button className="send-btn" type="submit" disabled={busy || !password || (mode === 'email' && !email)}>
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
