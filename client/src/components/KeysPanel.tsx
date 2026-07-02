import { useEffect, useState } from 'react';
import { api } from '../api/client';

/**
 * Platform provider keys (superadmin) — rotate the DigitalOcean API token and the BytePlus/Dola
 * ("ArksAI Swift") key without SSH or a redeploy. Keys are write-only: the panel shows only
 * whether each is configured, never the value. The master ArksAI droplet is shown as PROTECTED —
 * automation can never destroy or modify it.
 */
export function KeysPanel() {
  const [status, setStatus] = useState<Awaited<ReturnType<typeof api.adminGetProviders>> | null>(null);
  const [doTok, setDoTok] = useState('');
  const [ark, setArk] = useState('');
  const [busy, setBusy] = useState<'do' | 'ark' | null>(null);
  const [msg, setMsg] = useState('');

  const load = () => api.adminGetProviders().then(setStatus).catch(() => setStatus(null));
  useEffect(() => { load(); }, []);

  async function saveDo() {
    if (!doTok.trim().startsWith('dop_v1_')) { setMsg('Enter a DigitalOcean token (dop_v1_…).'); return; }
    setBusy('do'); setMsg('');
    try { await api.adminSetDoToken(doTok.trim()); setDoTok(''); setMsg('DigitalOcean token rotated.'); await load(); }
    catch (e: any) { setMsg(e?.message || 'Could not save the token.'); }
    finally { setBusy(null); }
  }
  async function saveArk() {
    if (!ark.trim().startsWith('ark-')) { setMsg('Enter a BytePlus ark key (ark-…).'); return; }
    setBusy('ark'); setMsg('');
    try { await api.adminSetByteplusKey(ark.trim()); setArk(''); setMsg('ArksAI Swift key rotated.'); await load(); }
    catch (e: any) { setMsg(e?.message || 'Could not save the key.'); }
    finally { setBusy(null); }
  }

  const dot = (ok: boolean) => (
    <span style={{ fontSize: 12, fontWeight: 600, color: ok ? 'var(--ok, #17915a)' : 'var(--text-faint)' }}>
      {ok ? '● Configured' : '○ Not set'}
    </span>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <p style={{ color: 'var(--text-faint)', fontSize: 13, margin: 0 }}>
        Rotate platform keys without SSH or a redeploy. Keys are stored encrypted and write-only — you’ll never see the value back, only whether it’s set.
      </p>

      <div className="kb-card" style={{ padding: 14, border: '1px solid var(--line)', borderRadius: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <b>DigitalOcean API token</b>{status && dot(status.digitalocean.configured)}
        </div>
        <p style={{ color: 'var(--text-faint)', fontSize: 12.5, margin: '4px 0 8px' }}>Used by the build orchestrator. Paste a new <code>dop_v1_…</code> token to rotate.</p>
        <div style={{ display: 'flex', gap: 8 }}>
          <input type="password" placeholder="dop_v1_…" value={doTok} onChange={(e) => setDoTok(e.target.value)} autoComplete="off" style={{ flex: 1 }} />
          <button className="send-btn" onClick={saveDo} disabled={busy === 'do' || !doTok.trim()}>{busy === 'do' ? 'Saving…' : 'Rotate'}</button>
        </div>
      </div>

      <div className="kb-card" style={{ padding: 14, border: '1px solid var(--line)', borderRadius: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <b>ArksAI Swift key <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}>· fast lane for simple builds</span></b>{status && dot(status.byteplus.configured)}
        </div>
        <p style={{ color: 'var(--text-faint)', fontSize: 12.5, margin: '4px 0 8px' }}>Paste a BytePlus <code>ark-…</code> key to rotate. When set, simple builds run on the fast lane.</p>
        <div style={{ display: 'flex', gap: 8 }}>
          <input type="password" placeholder="ark-…" value={ark} onChange={(e) => setArk(e.target.value)} autoComplete="off" style={{ flex: 1 }} />
          <button className="send-btn" onClick={saveArk} disabled={busy === 'ark' || !ark.trim()}>{busy === 'ark' ? 'Saving…' : 'Rotate'}</button>
        </div>
      </div>

      {status && (
        <div style={{ padding: '10px 14px', border: '1px solid var(--line)', borderRadius: 10, background: 'var(--surface-2, transparent)' }}>
          <div style={{ fontSize: 12.5, fontWeight: 600 }}>🔒 Protected — never touched by automation</div>
          <div style={{ color: 'var(--text-faint)', fontSize: 12.5, marginTop: 3 }}>
            Master droplet <code>{status.protected.masterDropletName}</code> (id {status.protected.masterDropletId}) is the live app. The build client hard-refuses any destroy/modify targeting it — a runaway job or tool can’t take the platform down.
          </div>
        </div>
      )}

      {msg && <div style={{ fontSize: 13, color: 'var(--text)' }}>{msg}</div>}
    </div>
  );
}
