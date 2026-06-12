import { useState } from 'react';
import { api } from '../api/client';
import { useStore } from '../state/sessionStore';

export function LoginScreen() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const setAuthed = useStore((s) => s.setAuthed);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.login(password);
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
          <span className="badge">deepseek</span>
        </h1>
        <input
          type="password"
          placeholder="Password"
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
