import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useToast } from '../components/Toast.jsx';

const money = (c) => `$${(c / 100).toFixed(2)}`;
const NEXT = { new: ['confirmed', 'cancelled'], confirmed: ['fulfilled', 'cancelled'], fulfilled: [], cancelled: [] };
const TONE = { new: 'var(--accent)', confirmed: '#7c9cd9', fulfilled: '#5fb98a', cancelled: 'var(--ink-3)' };

/** Order fulfillment: every order, newest first, with the status flow. */
export default function Orders() {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(null); // expanded order (with items)

  const load = () => api.get('/orders').then(setRows).catch((e) => toast(e.message, 'error'));
  useEffect(() => { load(); }, []);

  const expand = async (o) => {
    if (open?.id === o.id) return setOpen(null);
    try { setOpen(await api.get(`/orders/${o.id}`)); } catch (e) { toast(e.message, 'error'); }
  };
  const setStatus = (o, status) => api.patch(`/orders/${o.id}`, { status }).then(() => { load(); setOpen(null); toast(`Order ${status}`); }).catch((e) => toast(e.message, 'error'));

  if (rows === null) return <div className="page"><div className="empty">Loading…</div></div>;
  return (
    <div className="page">
      <div className="page-hd">
        <div className="titles">
          <div className="eyebrow">Store</div>
          <h1>Orders</h1>
          <div className="sub">{rows.filter((o) => o.status === 'new').length} awaiting confirmation · {rows.length} total.</div>
        </div>
      </div>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {rows.map((o) => (
          <div key={o.id} style={{ borderBottom: '1px solid var(--line-soft)' }}>
            <button onClick={() => expand(o)} style={{ all: 'unset', cursor: 'pointer', boxSizing: 'border-box', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 12px', padding: '12px 18px', width: '100%' }} aria-expanded={open?.id === o.id}>
              <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><strong>{o.name}</strong> <span className="muted">{o.email}</span></div>
                <div className="muted" style={{ fontSize: 12 }}>{new Date(o.createdAt).toLocaleString()}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginLeft: 'auto' }}>
                <span style={{ whiteSpace: 'nowrap' }}>{money(o.totalCents)}</span>
                <span style={{ color: TONE[o.status], fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' }}>{o.status}</span>
              </div>
            </button>
            {open?.id === o.id && (
              <div style={{ padding: '0 18px 14px' }}>
                {open.items.map((i) => (
                  <div key={i.id} style={{ display: 'flex', gap: 10, padding: '4px 0' }} className="muted">
                    <span style={{ flex: 1 }}>{i.name}</span><span>× {i.qty}</span><span style={{ width: 80, textAlign: 'right' }}>{money(i.priceCents * i.qty)}</span>
                  </div>
                ))}
                {open.note && <p className="muted" style={{ margin: '6px 0' }}>Note: {open.note}</p>}
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  {NEXT[o.status].map((s) => (
                    <button key={s} className={s === 'cancelled' ? 'btn btn-sm' : 'btn btn-primary btn-sm'} onClick={() => setStatus(o, s)}>
                      {s === 'confirmed' ? 'Confirm' : s === 'fulfilled' ? 'Mark fulfilled' : 'Cancel order'}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
        {!rows.length && <div className="empty" style={{ padding: 24 }}>No orders yet — they'll appear here the moment one is placed.</div>}
      </div>
    </div>
  );
}
