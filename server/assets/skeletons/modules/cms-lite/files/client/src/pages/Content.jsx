import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useToast } from '../components/Toast.jsx';
import { renderMarkdown } from '../lib/markdown.js';
import { Icon } from '../components/Icons.jsx';

const EMPTY = { title: '', slug: '', excerpt: '', bodyMd: '' };

/** Content editor: write in markdown, preview live, publish when ready. */
export default function Content() {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState(null);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = () => api.get('/content-admin').then(setRows).catch((e) => toast(e.message, 'error'));
  useEffect(() => { load(); }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const startEdit = (p) => { setEditing(p.id); setForm({ title: p.title, slug: p.slug, excerpt: p.excerpt, bodyMd: p.bodyMd }); setPreview(false); };
  const reset = () => { setEditing(null); setForm(EMPTY); setPreview(false); };

  async function save(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const body = { title: form.title, excerpt: form.excerpt, bodyMd: form.bodyMd, ...(form.slug ? { slug: form.slug } : {}) };
      if (editing) await api.patch(`/content-admin/${editing}`, body);
      else await api.post('/content-admin', body);
      reset(); load(); toast(editing ? 'Saved' : 'Draft created');
    } catch (e2) { toast(e2.message, 'error'); }
    finally { setBusy(false); }
  }
  const togglePublish = (p) => api.patch(`/content-admin/${p.id}`, { published: !p.published }).then(() => { load(); toast(p.published ? 'Unpublished' : 'Published'); }).catch((e) => toast(e.message, 'error'));
  const remove = (p) => api.del(`/content-admin/${p.id}`).then(() => { if (editing === p.id) reset(); load(); toast('Deleted'); }).catch((e) => toast(e.message, 'error'));

  if (rows === null) return <div className="page"><div className="empty loading">Loading…</div></div>;
  return (
    <div className="page">
      <div className="page-hd">
        <div className="titles">
          <div className="eyebrow">Publishing</div>
          <h1>Content</h1>
          <div className="sub">{rows.filter((p) => p.published).length} live · {rows.length} total.</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-hd" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3>{editing ? 'Edit post' : 'New post'}</h3>
          <button className="btn btn-sm" type="button" onClick={() => setPreview((v) => !v)}>{preview ? 'Write' : 'Preview'}</button>
        </div>
        <form onSubmit={save} className="fields">
          <div className="grid grid-2" style={{ width: '100%' }}>
            <label className="field"><span>Title</span><input value={form.title} onChange={set('title')} maxLength={200} /></label>
            <label className="field"><span>Slug (the URL — auto from the title if blank)</span><input value={form.slug} onChange={set('slug')} placeholder="my-first-post" /></label>
          </div>
          <label className="field" style={{ width: '100%' }}><span>Excerpt</span><input value={form.excerpt} onChange={set('excerpt')} maxLength={500} /></label>
          {preview ? (
            <div className="card" style={{ width: '100%', background: 'var(--bg-2)' }} dangerouslySetInnerHTML={{ __html: renderMarkdown(form.bodyMd) }} />
          ) : (
            <label className="field" style={{ width: '100%' }}>
              <span>Body (markdown: # headings, **bold**, *italic*, - lists, [links](https://…), ``` code)</span>
              <textarea rows={10} value={form.bodyMd} onChange={set('bodyMd')} style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }} />
            </label>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" type="submit" disabled={busy || !form.title.trim()}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Save draft'}</button>
            {editing && <button className="btn" type="button" onClick={reset}>Cancel</button>}
          </div>
        </form>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {rows.map((p) => (
          <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px', borderBottom: '1px solid var(--line-soft)' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><strong>{p.title}</strong> <span className="muted">/{p.slug}</span></div>
              <div className="muted" style={{ fontSize: 12 }}>{p.published ? 'Live' : 'Draft'} · updated {new Date(p.updatedAt).toLocaleDateString()}</div>
            </div>
            <button className="btn btn-sm" onClick={() => togglePublish(p)}>{p.published ? 'Unpublish' : 'Publish'}</button>
            <button className="btn btn-ghost btn-icon btn-sm" onClick={() => startEdit(p)} aria-label={`Edit ${p.title}`}><Icon name="edit" size={14} /></button>
            <button className="btn btn-ghost btn-icon btn-sm" onClick={() => remove(p)} aria-label={`Delete ${p.title}`}><Icon name="trash" size={14} /></button>
          </div>
        ))}
        {!rows.length && <div className="empty" style={{ padding: 24 }}>Nothing written yet — draft the first post above.</div>}
      </div>
    </div>
  );
}
