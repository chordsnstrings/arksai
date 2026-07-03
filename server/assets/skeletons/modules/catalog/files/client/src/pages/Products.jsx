import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useToast } from '../components/Toast.jsx';
import { Icon } from '../components/Icons.jsx';

const money = (c) => `$${(c / 100).toFixed(2)}`;
const EMPTY = { name: '', description: '', category: '', price: '', imageUrl: '' };

/** Product management: create, edit, activate/retire. */
export default function Products() {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState(null); // product id being edited
  const [busy, setBusy] = useState(false);

  const load = () => api.get('/products/all').then(setRows).catch((e) => toast(e.message, 'error'));
  useEffect(() => { load(); }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const startEdit = (p) => { setEditing(p.id); setForm({ name: p.name, description: p.description, category: p.category, price: (p.priceCents / 100).toFixed(2), imageUrl: p.imageUrl }); };
  const cancel = () => { setEditing(null); setForm(EMPTY); };

  async function save(e) {
    e.preventDefault();
    if (busy) return;
    const priceCents = Math.round(parseFloat(form.price) * 100);
    if (!form.name.trim()) return toast('Name is required', 'error');
    if (!Number.isFinite(priceCents) || priceCents < 0) return toast('Enter a valid price', 'error');
    setBusy(true);
    const body = { name: form.name, description: form.description, category: form.category, priceCents, imageUrl: form.imageUrl };
    try {
      if (editing) await api.patch(`/products/${editing}`, body);
      else await api.post('/products', body);
      cancel(); load(); toast(editing ? 'Product updated' : 'Product added');
    } catch (e2) { toast(e2.message, 'error'); }
    finally { setBusy(false); }
  }

  const toggle = (p) => api.patch(`/products/${p.id}`, { active: !p.active }).then(load).catch((e) => toast(e.message, 'error'));
  const remove = (p) => api.del(`/products/${p.id}`).then(load).catch((e) => toast(e.message, 'error'));

  if (rows === null) return <div className="page"><div className="empty loading">Loading…</div></div>;
  return (
    <div className="page">
      <div className="page-hd">
        <div className="titles">
          <div className="eyebrow">Store</div>
          <h1>Products</h1>
          <div className="sub">{rows.length} in the catalog · {rows.filter((p) => p.active).length} live.</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-hd"><h3>{editing ? 'Edit product' : 'Add a product'}</h3></div>
        <form onSubmit={save} className="fields">
          <div className="grid grid-2" style={{ width: '100%' }}>
            <label className="field"><span>Name</span><input value={form.name} onChange={set('name')} maxLength={140} /></label>
            <label className="field"><span>Price (USD)</span><input value={form.price} onChange={set('price')} inputMode="decimal" placeholder="19.00" /></label>
            <label className="field"><span>Category</span><input value={form.category} onChange={set('category')} maxLength={60} /></label>
            <label className="field"><span>Image URL (optional)</span><input value={form.imageUrl} onChange={set('imageUrl')} /></label>
          </div>
          <label className="field" style={{ width: '100%' }}><span>Description</span><textarea rows={2} value={form.description} onChange={set('description')} maxLength={2000} /></label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Add product'}</button>
            {editing && <button className="btn" type="button" onClick={cancel}>Cancel</button>}
          </div>
        </form>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {rows.map((p) => (
          // The row WRAPS on narrow screens (identity text gets the full width, actions drop
          // to their own line) — names must never be squeezed to fragments on a phone.
          <div key={p.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 12px', padding: '12px 18px', borderBottom: '1px solid var(--line-soft)', opacity: p.active ? 1 : 0.55 }}>
            <div style={{ flex: '1 1 220px', minWidth: 0 }}>
              <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><strong>{p.name}</strong>{p.category && <span className="muted"> · {p.category}</span>}</div>
              <div className="muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.description}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
              <span style={{ whiteSpace: 'nowrap' }}>{money(p.priceCents)}</span>
              <button className="btn btn-sm" onClick={() => toggle(p)}>{p.active ? 'Retire' : 'Relist'}</button>
              <button className="btn btn-ghost btn-icon btn-sm" onClick={() => startEdit(p)} aria-label={`Edit ${p.name}`}><Icon name="edit" size={14} /></button>
              <button className="btn btn-ghost btn-icon btn-sm" onClick={() => remove(p)} aria-label={`Delete ${p.name}`}><Icon name="trash" size={14} /></button>
            </div>
          </div>
        ))}
        {!rows.length && <div className="empty" style={{ padding: 24 }}>No products yet — add the first one above.</div>}
      </div>
    </div>
  );
}
