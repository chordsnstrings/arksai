import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useToast } from '../components/Toast.jsx';

const money = (c) => `$${(c / 100).toFixed(2)}`;

/** Owner setup: paste Stripe/PayPal keys here and online payment goes live — no code,
 *  no webhooks, no redeploy. Keys are write-only (never shown back in full). */
export default function Payments() {
  const toast = useToast();
  const [state, setState] = useState(null); // configured flags + key tails
  const [history, setHistory] = useState([]);
  const [form, setForm] = useState({ stripeSecretKey: '', paypalClientId: '', paypalSecret: '' });
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = () => Promise.all([api.get('/payments-admin/settings'), api.get('/payments-admin/history')])
    .then(([s, h]) => { setState(s); setLive(!!s.paypalLive); setHistory(h); })
    .catch((e) => toast(e.message, 'error'));
  useEffect(() => { load(); }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const body = { paypalLive: live };
      if (form.stripeSecretKey.trim()) body.stripeSecretKey = form.stripeSecretKey;
      if (form.paypalClientId.trim()) body.paypalClientId = form.paypalClientId;
      if (form.paypalSecret.trim()) body.paypalSecret = form.paypalSecret;
      const d = await api.put('/payments-admin/settings', body);
      setForm({ stripeSecretKey: '', paypalClientId: '', paypalSecret: '' });
      toast(d.stripe || d.paypal ? 'Payments are live on your shop' : 'Saved');
      load();
    } catch (e2) { toast(e2.message, 'error'); }
    finally { setBusy(false); }
  }

  if (state === null) return <div className="page"><div className="empty loading">Loading…</div></div>;
  return (
    <div className="page">
      <div className="page-hd">
        <div className="titles">
          <div className="eyebrow">Store</div>
          <h1>Payments</h1>
          <div className="sub">
            {state.stripe || state.paypal
              ? `Online payment is ON — ${[state.stripe && 'card (Stripe)', state.paypal && 'PayPal'].filter(Boolean).join(' + ')}.`
              : 'Paste your keys below and buyers can pay online instantly.'}
          </div>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="card-hd"><h3>Card payments — Stripe {state.stripe ? `· connected (${state.stripeKeyTail})` : ''}</h3></div>
          <p className="muted">In your Stripe dashboard: Developers → API keys → copy the <strong>Secret key</strong>. Use a test key (sk_test_…) first; swap to the live key when ready. Money goes straight to your Stripe account.</p>
          <form onSubmit={save} className="fields">
            <label className="field"><span>Stripe secret key</span><input type="password" autoComplete="off" value={form.stripeSecretKey} onChange={set('stripeSecretKey')} placeholder="sk_test_… or sk_live_…" /></label>
            <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save Stripe key'}</button>
          </form>
        </div>
        <div className="card">
          <div className="card-hd"><h3>PayPal {state.paypal ? `· connected (${state.paypalClientTail})` : ''}</h3></div>
          <p className="muted">In the PayPal developer dashboard: Apps &amp; Credentials → copy the <strong>Client ID</strong> and <strong>Secret</strong>. Sandbox credentials work for testing; switch the toggle when you go live.</p>
          <form onSubmit={save} className="fields">
            <label className="field"><span>Client ID</span><input autoComplete="off" value={form.paypalClientId} onChange={set('paypalClientId')} /></label>
            <label className="field"><span>Secret</span><input type="password" autoComplete="off" value={form.paypalSecret} onChange={set('paypalSecret')} /></label>
            <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} style={{ width: 16, height: 16 }} />
              <span style={{ textTransform: 'none', letterSpacing: 0, fontSize: 13 }}>Live mode (unchecked = sandbox for testing)</span>
            </label>
            <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save PayPal keys'}</button>
          </form>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16, padding: 0, overflow: 'hidden' }}>
        <div className="card-hd" style={{ padding: '16px 18px 4px' }}><h3>Payment history</h3></div>
        {history.map((p) => (
          <div key={p.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 12px', padding: '10px 18px', borderBottom: '1px solid var(--line-soft)' }}>
            <div style={{ flex: '1 1 200px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <strong>{money(p.amountCents)}</strong> <span className="muted">{p.buyerEmail || p.orderId}</span>
            </div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginLeft: 'auto' }}>
              <span className="muted" style={{ fontSize: 12 }}>{p.provider}</span>
              <span style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', color: p.status === 'paid' ? 'var(--done)' : p.status === 'failed' ? 'var(--overdue)' : 'var(--ink-3)' }}>{p.status}</span>
              <span className="muted" style={{ fontSize: 12 }}>{new Date(p.createdAt).toLocaleDateString()}</span>
            </div>
          </div>
        ))}
        {!history.length && <div className="empty" style={{ padding: 20 }}>Payments show up here as buyers check out.</div>}
      </div>
    </div>
  );
}
