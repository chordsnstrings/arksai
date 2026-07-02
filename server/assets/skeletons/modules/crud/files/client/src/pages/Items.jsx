import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useToast } from '../components/Toast.jsx';
import { Icon } from '../components/Icons.jsx';

/** EXEMPLAR list/create/toggle/delete page — clone + rename per real entity. */
export default function Items() {
  const toast = useToast();
  const [items, setItems] = useState(null);
  const [title, setTitle] = useState('');

  const load = () => api.get('/items').then(setItems).catch((e) => toast(e.message, 'error'));
  useEffect(() => { load(); }, []);

  async function create(e) {
    e.preventDefault();
    if (!title.trim()) return;
    try { await api.post('/items', { title }); setTitle(''); load(); }
    catch (e2) { toast(e2.message, 'error'); }
  }
  const toggle = (it) => api.patch(`/items/${it.id}`, { status: it.status === 'done' ? 'open' : 'done' }).then(load).catch((e) => toast(e.message, 'error'));
  const remove = (it) => api.del(`/items/${it.id}`).then(load).catch((e) => toast(e.message, 'error'));

  if (items === null) return <div className="page"><div className="empty">Loading…</div></div>;
  return (
    <div className="page">
      <div className="page-hd">
        <div className="titles">
          <div className="eyebrow">Workspace</div>
          <h1>Items</h1>
          <div className="sub">{items.length} item{items.length === 1 ? '' : 's'}.</div>
        </div>
      </div>
      <form onSubmit={create} style={{ display: 'flex', gap: 8, marginBottom: 18, maxWidth: 520 }}>
        <input className="field-input" style={{ flex: 1, background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 'var(--r-md)', color: 'var(--ink)', padding: '10px 12px' }} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add an item…" />
        <button className="btn btn-primary" type="submit"><Icon name="plus" size={14} /> Add</button>
      </form>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {items.map((it) => (
          <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 18px', borderBottom: '1px solid var(--line-soft)' }}>
            <button className="btn btn-ghost btn-icon btn-sm" onClick={() => toggle(it)} aria-label="Toggle done">
              <Icon name="check" size={14} style={{ opacity: it.status === 'done' ? 1 : 0.25 }} />
            </button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ textDecoration: it.status === 'done' ? 'line-through' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.title}</div>
              {it.notes && <div className="muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.notes}</div>}
            </div>
            <button className="btn btn-ghost btn-icon btn-sm" onClick={() => remove(it)} aria-label="Delete"><Icon name="trash" size={14} /></button>
          </div>
        ))}
        {!items.length && <div className="empty" style={{ padding: 24 }}>Nothing yet — add the first item above.</div>}
      </div>
    </div>
  );
}
