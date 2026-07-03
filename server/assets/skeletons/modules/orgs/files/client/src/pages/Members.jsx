import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import Avatar from '../components/Avatar.jsx';
import { useToast } from '../components/Toast.jsx';

/** Members of the demo workspace + the invite card. Name column gets the flexible space. */
export default function Members() {
  const toast = useToast();
  const [org, setOrg] = useState(null);
  const [members, setMembers] = useState(null);

  useEffect(() => {
    api.get('/orgs').then(async (orgs) => {
      if (!orgs.length) { setMembers([]); return; }
      const o = await api.get(`/orgs/${orgs[0].slug}`);
      setOrg(o);
      setMembers(await api.get(`/orgs/${o.slug}/members`));
    }).catch((e) => { toast(e.message, 'error'); setMembers([]); });
  }, []);

  if (members === null) return <div className="page"><div className="empty loading">Loading…</div></div>;
  return (
    <div className="page">
      <div className="page-hd">
        <div className="titles">
          <div className="eyebrow">Workspace</div>
          <h1>Members</h1>
          <div className="sub">{members.length} member{members.length === 1 ? '' : 's'}{org ? ` in ${org.name}` : ''}.</div>
        </div>
      </div>
      <div className="grid grid-sidebar">
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="table-scroll">
            <div className="members-table">
              {members.map((m) => (
                <div key={m.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1.7fr) 120px 96px', gap: 12, padding: '14px 22px', alignItems: 'center', borderBottom: '1px solid var(--line-soft)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                    <Avatar name={m.name} color={m.avatarColor || '#e8b059'} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</div>
                      <div className="muted" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.email}</div>
                    </div>
                  </div>
                  <div><span className="muted" style={{ fontSize: 12 }}>{m.role}</span></div>
                  <div className="muted" style={{ fontSize: 12, textAlign: 'right' }}>{new Date(m.joinedAt).toLocaleDateString()}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
        {org?.invite && (
          <div className="card">
            <div className="card-hd"><h3>Invite code</h3></div>
            <p className="muted">Share this code — new members join with it, no email invites needed.</p>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 20, fontWeight: 600, padding: '12px 14px', borderRadius: 'var(--r-md)', background: 'var(--bg-2)', border: '1px solid var(--line)', textAlign: 'center', marginTop: 12 }}>
              {org.invite.code}
            </div>
            <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>{org.invite.usesLeft} joins left · owner-only</p>
          </div>
        )}
      </div>
    </div>
  );
}
