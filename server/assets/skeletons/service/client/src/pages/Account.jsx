import { useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useToast } from '../components/Toast.jsx';

/** Account settings — profile + password. Complete as shipped; extend, don't stub. */
export default function Account() {
  const { user, updateUser, logout } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(user?.name || '');
  const [pw, setPw] = useState({ current: '', next: '' });
  const [busy, setBusy] = useState('');
  const isDemo = String(user?.email || '').startsWith('demo@');

  async function saveProfile(e) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy('profile');
    try {
      const d = await api.patch('/auth/me', { name: name.trim() });
      updateUser(d.user);
      toast('Profile updated');
    } catch (e2) { toast(e2.message, 'error'); }
    finally { setBusy(''); }
  }

  async function changePassword(e) {
    e.preventDefault();
    if (busy) return;
    setBusy('password');
    try {
      await api.post('/auth/password', { currentPassword: pw.current, newPassword: pw.next });
      setPw({ current: '', next: '' });
      toast('Password changed');
    } catch (e2) { toast(e2.message, 'error'); }
    finally { setBusy(''); }
  }

  return (
    <div className="page">
      <div className="page-hd">
        <div className="titles">
          <div className="eyebrow">Settings</div>
          <h1>Account</h1>
          <div className="sub">{user?.email}</div>
        </div>
      </div>
      <div className="grid grid-2">
        <div className="card">
          <div className="card-hd"><h3>Profile</h3></div>
          <form onSubmit={saveProfile} className="fields">
            <label className="field">
              <span>Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
            </label>
            <button className="btn btn-primary" type="submit" disabled={busy === 'profile' || !name.trim()}>
              {busy === 'profile' ? 'Saving…' : 'Save changes'}
            </button>
          </form>
        </div>
        <div className="card">
          <div className="card-hd"><h3>Password</h3></div>
          {isDemo ? (
            <p className="muted">The shared demo account’s password can’t be changed — create your own account to manage a password.</p>
          ) : (
            <form onSubmit={changePassword} className="fields">
              <label className="field">
                <span>Current password</span>
                <input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
              </label>
              <label className="field">
                <span>New password (6+ characters)</span>
                <input type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
              </label>
              <button className="btn btn-primary" type="submit" disabled={busy === 'password' || pw.next.length < 6 || !pw.current}>
                {busy === 'password' ? 'Changing…' : 'Change password'}
              </button>
            </form>
          )}
        </div>
      </div>
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-hd"><h3>Session</h3></div>
        <p className="muted">Sign out of this device.</p>
        <button className="btn" onClick={logout}>Sign out</button>
      </div>
    </div>
  );
}
