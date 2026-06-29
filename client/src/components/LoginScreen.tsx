import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useStore } from '../state/sessionStore';

const GOOGLE_STATUS: Record<string, string> = {
  'no-account': 'No ArksAI account uses that Google email yet — ask your admin for an invite.',
  'no-org': 'Your account isn’t part of an organization yet — ask your admin for an invite.',
  unverified: 'That Google account’s email isn’t verified, so we can’t sign you in.',
  state: 'Google sign-in expired — please try again.',
  error: 'Google sign-in didn’t complete — please try again.',
  cancelled: 'Google sign-in was cancelled.',
};

/** Team-member sign-in (email + password, or Sign in with Google). The platform operator signs in at /operator. */
export function LoginScreen({ onBack }: { onBack?: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [googleOn, setGoogleOn] = useState(false);
  const setAuthed = useStore((s) => s.setAuthed);
  const setMe = useStore((s) => s.setMe);

  useEffect(() => {
    // Which login methods are configured (show the Google button only when it's set up).
    fetch('/api/auth/providers')
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => setGoogleOn(!!p?.google))
      .catch(() => {});
    // Surface a Google sign-in result redirected back as ?login=google&status=…
    const sp = new URLSearchParams(window.location.search);
    if (sp.get('login') === 'google') {
      const msg = GOOGLE_STATUS[sp.get('status') || ''] || '';
      if (msg) setError(msg);
      sp.delete('login');
      sp.delete('status');
      const qs = sp.toString();
      window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''));
    }
  }, []);

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
          <span className="brand-lockup lg" role="img" aria-label="ArksAI" />
          <span className="badge">studio</span>
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '0 0 8px' }}>Welcome back — your studio’s ready.</p>
        <input type="email" placeholder="Work email" value={email} autoFocus onChange={(e) => setEmail(e.target.value)} />
        <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <div className="error">{error}</div>}
        <button className="send-btn" type="submit" disabled={busy || !email || !password}>
          {busy ? '…' : 'Log in'}
        </button>
        {googleOn && (
          <>
            <div className="login-or">or</div>
            <a className="google-btn" href="/api/auth/google/start">
              <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
                <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
                <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z" />
                <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.47.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
              </svg>
              Sign in with Google
            </a>
          </>
        )}
        {onBack && (
          <button type="button" className="login-back" onClick={onBack}>
            ← Back
          </button>
        )}
      </form>
    </div>
  );
}
