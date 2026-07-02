import { useState } from 'react';
import { useAuth } from '../lib/auth.jsx';

/** Sign in / sign up. The demo credentials card is REQUIRED — the pre-delivery quality gate
 *  signs in with them to audit every page; never remove it. */
export default function Auth() {
  const [mode, setMode] = useState('login');
  const { login, signup } = useAuth();
  const [email, setEmail] = useState('demo@__APP_SLUG__.app');
  const [password, setPassword] = useState('demo1234');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e) {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      if (mode === 'login') await login(email.trim(), password);
      else await signup({ email: email.trim(), password, name: name.trim() });
    } catch (e2) { setErr(e2.message || 'something went wrong'); }
    finally { setBusy(false); }
  }

  return (
    <div className="auth-page">
      <div className="auth-art">
        <div className="stamp">__APP_INITIAL__</div>
        <div className="auth-art-content">
          <h2>__APP_TAGLINE__</h2>
          <p>__APP_DESCRIPTION__</p>
        </div>
      </div>
      <div className="auth-form-wrap">
        <form className="auth-form" onSubmit={submit}>
          <div className="auth-brand-mobile"><span className="mark">__APP_INITIAL__</span> __APP_NAME__</div>
          <h1>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h1>
          <p className="lede">{mode === 'login' ? 'Sign in to continue.' : 'It takes a few seconds.'}</p>
          <div className="fields">
            {mode === 'signup' && (
              <label className="field">
                <span>Name</span>
                <input value={name} onChange={(e) => setName(e.target.value)} required />
              </label>
            )}
            <label className="field">
              <span>Email</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>
            <label className="field">
              <span>Password</span>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
            </label>
          </div>
          {err && <div className="form-error">{err}</div>}
          <button className="btn btn-primary submit" disabled={busy} type="submit">
            {busy ? '…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
          {mode === 'login' && (
            <div className="demo-box">
              <div className="demo-label">Demo credentials</div>
              <code>demo@__APP_SLUG__.app</code> / <code>demo1234</code>
            </div>
          )}
          <p className="alt">
            {mode === 'login' ? (
              <>Don't have an account? <a href="#" onClick={(e) => { e.preventDefault(); setMode('signup'); }}>Create one</a></>
            ) : (
              <>Already have an account? <a href="#" onClick={(e) => { e.preventDefault(); setMode('login'); }}>Sign in</a></>
            )}
          </p>
        </form>
      </div>
    </div>
  );
}
