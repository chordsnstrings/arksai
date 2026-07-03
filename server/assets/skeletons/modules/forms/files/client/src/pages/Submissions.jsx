import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

/** The outbox — every public form submission, newest first. */
export default function Submissions() {
  const [rows, setRows] = useState(null);
  useEffect(() => { api.get('/submissions').then(setRows).catch(() => setRows([])); }, []);
  if (rows === null) return <div className="page"><div className="empty loading">Loading…</div></div>;
  return (
    <div className="page">
      <div className="page-hd">
        <div className="titles">
          <div className="eyebrow">Inbox</div>
          <h1>Submissions</h1>
          <div className="sub">{rows.length} received.</div>
        </div>
      </div>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {rows.map((s) => (
          <div key={s.id} style={{ padding: '14px 18px', borderBottom: '1px solid var(--line-soft)' }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
              <strong>{s.name}</strong>
              <span className="muted">{s.email}</span>
              <span className="muted" style={{ marginLeft: 'auto', fontSize: 12 }}>{new Date(s.createdAt).toLocaleString()}</span>
            </div>
            <p className="muted" style={{ margin: '6px 0 0' }}>{s.message}</p>
          </div>
        ))}
        {!rows.length && <div className="empty" style={{ padding: 24 }}>No submissions yet.</div>}
      </div>
    </div>
  );
}
