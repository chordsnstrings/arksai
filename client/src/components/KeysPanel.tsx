import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { confirmDialog } from '../state/confirmStore';

/**
 * Platform provider keys (superadmin) — rotate the DigitalOcean API token and the BytePlus
 * ModelArk key (every ArksAI model lane, images and video run on it) without SSH or a redeploy. Keys are write-only: the panel shows only
 * whether each is configured (and, for the model key, where it comes from), never the value. The master ArksAI droplet is shown as PROTECTED —
 * automation can never destroy or modify it.
 */
export function KeysPanel() {
  const [status, setStatus] = useState<Awaited<ReturnType<typeof api.adminGetProviders>> | null>(null);
  const [doTok, setDoTok] = useState('');
  const [ark, setArk] = useState('');
  const [busy, setBusy] = useState<'do' | 'ark' | 'ark-clear' | null>(null);
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
    if (!ark.trim().startsWith('ark-')) { setMsg('Enter an ark key (ark-…).'); return; }
    // Same rule as the server (ARK_KEY_RE): printable ASCII only — a stray line break or
    // zero-width char from a copy-paste would otherwise be saved as a broken key.
    if (!/^ark-[\x21-\x7e]+$/.test(ark.trim())) { setMsg('That key contains invalid characters — paste it again.'); return; }
    setBusy('ark'); setMsg('');
    try { await api.adminSetByteplusKey(ark.trim()); setArk(''); setMsg('ArksAI model key rotated.'); await load(); }
    catch (e: any) { setMsg(e?.message || 'Could not save the key.'); }
    finally { setBusy(null); }
  }
  async function useServerArk() {
    const ok = await confirmDialog({
      title: 'Use the server key instead?',
      body: 'The model key set here will be removed and every model will run on the ARK_API_KEY from the server environment.',
      confirmLabel: 'Use server key',
    });
    if (!ok) return;
    setBusy('ark-clear'); setMsg('');
    try { await api.adminClearByteplusKey(); setMsg('Now using the server’s model key.'); await load(); }
    catch (e: any) { setMsg(e?.message || 'Could not switch to the server key.'); }
    finally { setBusy(null); }
  }

  const arkSource = status?.byteplus.source;
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
          <b>ArksAI model key <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}>· powers every model</span></b>{status && dot(status.byteplus.configured)}
        </div>
        {status && arkSource !== 'none' && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 12.5, color: 'var(--text-faint)', marginTop: 4 }}>
            <span>{arkSource === 'admin' ? 'Set here — overrides the server environment' : 'From the server environment'}</span>
            {arkSource === 'admin' && status.byteplus.envKey && (
              <button
                type="button"
                onClick={useServerArk}
                disabled={busy === 'ark-clear'}
                style={{ background: 'none', border: 0, padding: 0, font: 'inherit', color: 'var(--accent)', textDecoration: 'underline', cursor: 'pointer' }}
              >
                {busy === 'ark-clear' ? 'Switching…' : 'Use server key instead'}
              </button>
            )}
          </div>
        )}
        <p style={{ color: 'var(--text-faint)', fontSize: 12.5, margin: '4px 0 8px' }}>Paste an <code>ark-…</code> key to rotate. Chat, builds, reports, images and video all run on it.</p>
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
