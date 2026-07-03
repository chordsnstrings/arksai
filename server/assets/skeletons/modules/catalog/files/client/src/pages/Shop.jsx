import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useToast } from '../components/Toast.jsx';
import { Icon } from '../components/Icons.jsx';

const money = (c) => `$${(c / 100).toFixed(2)}`;
const CART_KEY = 'shop.cart';
const readCart = () => { try { return JSON.parse(localStorage.getItem(CART_KEY)) || {}; } catch { return {}; } };

/** Storefront: browse, search, cart, and place an order (totals are computed server-side). */
export default function Shop() {
  const { user } = useAuth();
  const toast = useToast();
  const [products, setProducts] = useState(null);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [cart, setCart] = useState(readCart); // { productId: qty }
  const [placing, setPlacing] = useState(false);
  const [placed, setPlaced] = useState(null);
  const [payOptions, setPayOptions] = useState(null); // {stripe,paypal} when the payments module is installed
  const [paying, setPaying] = useState('');

  useEffect(() => { api.get('/products').then(setProducts).catch(() => setProducts([])); }, []);
  // Payments module present? (404 = not installed → the order-request flow stands alone.)
  useEffect(() => { api.get('/payments/options').then(setPayOptions).catch(() => setPayOptions(null)); }, []);
  // Confirm-on-return: the provider redirected back — verify SERVER-SIDE and show the outcome.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const provider = q.get('paid');
    if (!provider) return;
    const body = provider === 'stripe' ? { provider, sessionId: q.get('session_id') } : { provider, token: q.get('token') };
    window.history.replaceState(null, '', window.location.pathname);
    api.post('/payments/confirm', body)
      .then((d) => toast(`Payment received — order ${d.orderId} is paid`))
      .catch((e) => toast(e.message, 'error'));
  }, []);

  async function payNow(provider) {
    if (!placed || paying) return;
    setPaying(provider);
    try {
      const d = await api.post('/payments/checkout', { orderId: placed.orderId, provider, returnUrl: window.location.href });
      window.location.href = d.url;
    } catch (e) { toast(e.message, 'error'); setPaying(''); }
  }
  useEffect(() => { try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch {} }, [cart]);

  const cats = useMemo(() => [...new Set((products || []).map((p) => p.category).filter(Boolean))], [products]);
  const visible = useMemo(() => (products || []).filter((p) =>
    (!cat || p.category === cat) && (!q.trim() || `${p.name} ${p.description}`.toLowerCase().includes(q.trim().toLowerCase())),
  ), [products, q, cat]);

  const lines = useMemo(() => Object.entries(cart)
    .map(([id, qty]) => ({ product: (products || []).find((p) => p.id === id), qty }))
    .filter((l) => l.product && l.qty > 0), [cart, products]);
  const total = lines.reduce((s, l) => s + l.product.priceCents * l.qty, 0);
  const add = (id, d) => setCart((c) => { const n = Math.max(0, (c[id] || 0) + d); const next = { ...c }; if (n) next[id] = n; else delete next[id]; return next; });

  async function placeOrder() {
    if (placing || !lines.length) return;
    setPlacing(true);
    try {
      const d = await api.post('/checkout', {
        name: user?.name, email: user?.email,
        items: lines.map((l) => ({ productId: l.product.id, qty: l.qty })),
      });
      setCart({});
      setPlaced(d);
      toast('Order placed');
    } catch (e) { toast(e.message, 'error'); }
    finally { setPlacing(false); }
  }

  if (products === null) return <div className="page"><div className="empty loading">Loading…</div></div>;
  return (
    <div className="page">
      <div className="page-hd">
        <div className="titles">
          <div className="eyebrow">Store</div>
          <h1>Shop</h1>
          <div className="sub">{products.length} product{products.length === 1 ? '' : 's'} available.</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <label className="field" style={{ flex: '1 1 220px' }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products…" aria-label="Search products" />
        </label>
        {cats.length > 0 && (
          <label className="field">
            <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Filter by category">
              <option value="">All categories</option>
              {cats.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        )}
      </div>

      <div className="grid grid-3">
        {visible.map((p) => (
          <div key={p.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {p.imageUrl
              ? <img src={p.imageUrl} alt={p.name} style={{ width: '100%', height: 120, objectFit: 'cover', borderRadius: 'var(--r-md)' }} />
              : <div aria-hidden style={{ height: 120, borderRadius: 'var(--r-md)', background: 'var(--bg-2)', display: 'grid', placeItems: 'center', fontSize: 34, color: 'var(--ink-3)', fontWeight: 700 }}>{p.name.charAt(0)}</div>}
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
              <strong>{p.name}</strong>
              <span style={{ whiteSpace: 'nowrap' }}>{money(p.priceCents)}</span>
            </div>
            {p.description && <p className="muted" style={{ margin: 0 }}>{p.description}</p>}
            <div style={{ marginTop: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
              {cart[p.id]
                ? <>
                    <button className="btn btn-sm" onClick={() => add(p.id, -1)} aria-label={`Remove one ${p.name}`}>−</button>
                    <span aria-live="polite">{cart[p.id]}</span>
                    <button className="btn btn-sm" onClick={() => add(p.id, +1)} aria-label={`Add one ${p.name}`}>+</button>
                  </>
                : <button className="btn btn-primary btn-sm" onClick={() => add(p.id, +1)}><Icon name="plus" size={13} /> Add to cart</button>}
            </div>
          </div>
        ))}
        {!visible.length && <div className="empty" style={{ gridColumn: '1 / -1', padding: 24 }}>No products match — try a different search.</div>}
      </div>

      {(lines.length > 0 || placed) && (
        <div className="card" style={{ marginTop: 18 }}>
          <div className="card-hd"><h3>Your cart</h3></div>
          {placed && !lines.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <p style={{ margin: 0 }}>Order <strong>{placed.orderId}</strong> received — total {money(placed.totalCents)}.</p>
              {payOptions && (payOptions.stripe || payOptions.paypal) ? (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {payOptions.stripe && <button className="btn btn-primary" onClick={() => payNow('stripe')} disabled={!!paying}>{paying === 'stripe' ? 'Opening secure checkout…' : 'Pay now by card'}</button>}
                  {payOptions.paypal && <button className="btn" onClick={() => payNow('paypal')} disabled={!!paying}>{paying === 'paypal' ? 'Opening PayPal…' : 'Pay with PayPal'}</button>}
                </div>
              ) : (
                <p className="muted" style={{ margin: 0 }}>We'll email {user?.email} to confirm and arrange payment.</p>
              )}
            </div>
          ) : (
            <>
              {lines.map((l) => (
                <div key={l.product.id} style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 10px', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--line-soft)' }}>
                  <span style={{ flex: '1 1 160px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.product.name}</span>
                  <span className="muted">× {l.qty}</span>
                  <span style={{ width: 84, textAlign: 'right' }}>{money(l.product.priceCents * l.qty)}</span>
                  <button className="btn btn-ghost btn-icon btn-sm" onClick={() => add(l.product.id, -l.qty)} aria-label={`Remove ${l.product.name}`}><Icon name="x" size={13} /></button>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 12 }}>
                <strong>Total {money(total)}</strong>
                <button className="btn btn-primary" onClick={placeOrder} disabled={placing}>{placing ? 'Placing…' : 'Place order'}</button>
              </div>
              <p className="muted" style={{ margin: '8px 0 0' }}>No card needed now — the team confirms your order and arranges payment.</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
