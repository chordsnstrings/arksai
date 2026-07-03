import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useToast } from '../components/Toast.jsx';

const money = (c) => `$${(c / 100).toFixed(2)}`;
const RAIL_NAMES = { stripe: 'Stripe', ziina: 'Ziina', telr: 'Telr', ngenius: 'Network International', paypal: 'PayPal', binance: 'Binance Pay' };

/** Owner setup: paste keys for any provider and online payment goes live — no code, no
 *  webhooks, no redeploy. Keys are write-only (never shown back in full). Apple Pay and
 *  Google Pay appear automatically on the providers' hosted checkout pages. */
export default function Payments() {
  const toast = useToast();
  const [state, setState] = useState(null);
  const [history, setHistory] = useState([]);
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);

  const load = () => Promise.all([api.get('/payments-admin/settings'), api.get('/payments-admin/history')])
    .then(([s, h]) => { setState(s); setHistory(h); })
    .catch((e) => toast(e.message, 'error'));
  useEffect(() => { load(); }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  async function save(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const body = {};
      for (const [k, v] of Object.entries(form)) {
        // The UI shows "Live mode"; the API's Ziina/Telr fields are TEST flags — invert.
        if (k === 'ziinaTest_inv') body.ziinaTest = !v;
        else if (k === 'telrTest_inv') body.telrTest = !v;
        else if (typeof v === 'boolean') body[k] = v;
        else if (String(v).trim()) body[k] = v;
      }
      const d = await api.put('/payments-admin/settings', body);
      setForm({});
      const on = ['stripe', 'paypal', 'ziina', 'telr', 'ngenius', 'binance'].filter((p) => d[p]);
      toast(on.length ? `Payments live: ${on.map((p) => RAIL_NAMES[p] || p).join(', ')}` : 'Saved');
      load();
    } catch (e2) { toast(e2.message, 'error'); }
    finally { setBusy(false); }
  }

  if (state === null) return <div className="page"><div className="empty loading">Loading…</div></div>;
  const configuredRails = ['ziina', 'telr', 'ngenius', 'stripe'].filter((p) => state[p]);
  const anyOn = configuredRails.length > 0 || state.paypal || state.binance;

  const Key = ({ label, k, placeholder, type = 'password' }) => (
    <label className="field"><span>{label}</span><input type={type} autoComplete="off" value={form[k] ?? ''} onChange={set(k)} placeholder={placeholder} /></label>
  );
  const LiveToggle = ({ k, current, offLabel = 'sandbox / test' }) => (
    <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <input type="checkbox" checked={form[k] ?? current} onChange={set(k)} style={{ width: 16, height: 16 }} />
      <span style={{ textTransform: 'none', letterSpacing: 0, fontSize: 13 }}>Live mode (unchecked = {offLabel})</span>
    </label>
  );

  return (
    <div className="page">
      <div className="page-hd">
        <div className="titles">
          <div className="eyebrow">Store</div>
          <h1>Payments</h1>
          <div className="sub">
            {anyOn
              ? `Online payment is ON — ${[state.cardProvider && `card via ${RAIL_NAMES[state.cardProvider]}`, state.paypal && 'PayPal', state.binance && 'crypto (Binance Pay)'].filter(Boolean).join(' + ')}. Apple Pay & Google Pay show automatically at checkout.`
              : 'Paste keys for any ONE provider below and buyers can pay online instantly.'}
          </div>
        </div>
      </div>

      <form onSubmit={save}>
        <div className="grid grid-2">
          <div className="card">
            <div className="card-hd"><h3>Ziina {state.ziina ? `· connected (${state.ziinaKeyTail})` : ''}</h3></div>
            <p className="muted">Fast to set up for UAE businesses and freelancers — AED-native, Apple/Google Pay included. Ziina app → Business → Developers → API key.</p>
            <div className="fields">
              <Key label="Ziina API key" k="ziinaSecret" placeholder="paste your Ziina secret key" />
              <LiveToggle k="ziinaTest_inv" current={!state.ziinaTest} />
            </div>
          </div>
          <div className="card">
            <div className="card-hd"><h3>Card payments — Stripe {state.stripe ? `· connected (${state.stripeKeyTail})` : ''}</h3></div>
            <p className="muted">Best for international cards. Stripe dashboard → Developers → API keys → <strong>Secret key</strong> (sk_test_… first, sk_live_… when ready).</p>
            <div className="fields"><Key label="Stripe secret key" k="stripeSecretKey" placeholder="sk_test_… or sk_live_…" /></div>
          </div>
          <div className="card">
            <div className="card-hd"><h3>Telr {state.telr ? `· connected (store ${state.telrStoreTail})` : ''}</h3></div>
            <p className="muted">UAE/GCC gateway with low local-card rates. Telr merchant admin → Integrations → Hosted payment page: Store ID + Authentication key.</p>
            <div className="fields">
              <Key label="Store ID" k="telrStoreId" type="text" placeholder="e.g. 12345" />
              <Key label="Authentication key" k="telrAuthKey" />
              <LiveToggle k="telrTest_inv" current={!state.telrTest} />
            </div>
          </div>
          <div className="card">
            <div className="card-hd"><h3>Network International {state.ngenius ? `· connected (${state.ngeniusOutletTail})` : ''}</h3></div>
            <p className="muted">The UAE's bank-backed enterprise gateway (N-Genius, incl. Samsung Pay). Portal → Settings → Integrations: Service-account API key + Outlet reference.</p>
            <div className="fields">
              <Key label="API key (service account)" k="ngeniusApiKey" />
              <Key label="Outlet reference" k="ngeniusOutletRef" type="text" placeholder="xxxxxxxx-xxxx-…" />
              <LiveToggle k="ngeniusLive" current={state.ngeniusLive} />
            </div>
          </div>
          <div className="card">
            <div className="card-hd"><h3>PayPal {state.paypal ? `· connected (${state.paypalClientTail})` : ''}</h3></div>
            <p className="muted">PayPal developer dashboard → Apps &amp; Credentials → Client ID + Secret.</p>
            <div className="fields">
              <Key label="Client ID" k="paypalClientId" type="text" />
              <Key label="Secret" k="paypalSecret" />
              <LiveToggle k="paypalLive" current={state.paypalLive} />
            </div>
          </div>
          <div className="card">
            <div className="card-hd"><h3>Binance Pay {state.binance ? `· connected (${state.binanceKeyTail})` : ''}</h3></div>
            <p className="muted">Accept crypto (settled in USDT). Binance Merchant dashboard → API Management: API key (certificate) + Secret. Shows as "Pay with crypto" at checkout.</p>
            <div className="fields">
              <Key label="API key" k="binanceApiKey" type="text" />
              <Key label="Secret key" k="binanceSecret" />
            </div>
          </div>
          <div className="card">
            <div className="card-hd"><h3>Checkout preferences</h3></div>
            <div className="fields">
              <label className="field">
                <span>Currency</span>
                <select value={form.currencyCode ?? state.currencyCode} onChange={set('currencyCode')}>
                  {(state.currencies || ['USD', 'AED']).map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label className="field">
                <span>Preferred card provider (the storefront's "Pay now" button)</span>
                <select value={form.defaultProvider ?? state.defaultProvider ?? ''} onChange={set('defaultProvider')}>
                  <option value="">Automatic ({RAIL_NAMES[state.cardProvider] ?? 'first configured'})</option>
                  {configuredRails.map((p) => <option key={p} value={p}>{RAIL_NAMES[p]}</option>)}
                </select>
              </label>
              <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save all payment settings'}</button>
            </div>
          </div>
        </div>
      </form>

      <div className="card" style={{ marginTop: 16, padding: 0, overflow: 'hidden' }}>
        <div className="card-hd" style={{ padding: '16px 18px 4px' }}><h3>Payment history</h3></div>
        {history.map((p) => (
          <div key={p.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 12px', padding: '10px 18px', borderBottom: '1px solid var(--line-soft)' }}>
            <div style={{ flex: '1 1 200px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <strong>{money(p.amountCents)}</strong> <span className="muted">{p.buyerEmail || p.orderId}</span>
            </div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginLeft: 'auto' }}>
              <span className="muted" style={{ fontSize: 12 }}>{RAIL_NAMES[p.provider] || p.provider}</span>
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
