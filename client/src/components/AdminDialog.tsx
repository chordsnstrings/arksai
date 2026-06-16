import { useEffect, useState } from 'react';
import { api, type Lead, type Org, type OrgMember } from '../api/client';
import { useStore } from '../state/sessionStore';

/**
 * Admin panel. Org admins manage their members (invite via a link, change/remove);
 * the platform super-admin additionally provisions organizations and reviews the
 * waitlist. Invites are one-time links the admin copies and shares (no email infra).
 */
export function AdminDialog({ onClose }: { onClose: () => void }) {
  const me = useStore((s) => s.me);
  const isSuper = !!me?.isSuperadmin;
  const [orgs, setOrgs] = useState<Org[]>(me?.orgs ?? []);
  const [orgId, setOrgId] = useState<string>(me?.currentOrg ?? me?.orgs[0]?.id ?? '');
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [link, setLink] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'member' | 'admin'>('member');
  const [orgName, setOrgName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');

  const refreshMembers = (id: string) => {
    if (id) api.listMembers(id).then(setMembers).catch(() => setMembers([]));
  };
  useEffect(() => refreshMembers(orgId), [orgId]);
  useEffect(() => {
    if (isSuper) {
      api.adminListOrgs().then(setOrgs).catch(() => {});
      api.adminListLeads().then(setLeads).catch(() => {});
    }
  }, [isSuper]);

  const invite = async () => {
    if (!email.trim() || !orgId) {
      setError('Enter a valid email.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const r = await api.inviteMember(orgId, email.trim(), role);
      setLink(r.link);
      setEmail('');
      refreshMembers(orgId);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to create the invite.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (m: OrgMember) => {
    if (!confirm(`Remove ${m.email} from this organization?`)) return;
    try {
      await api.removeMember(orgId, m.userId);
      refreshMembers(orgId);
    } catch {
      /* ignore */
    }
  };

  const createOrg = async () => {
    if (!orgName.trim()) {
      setError('An organization name is required.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const r = await api.adminCreateOrg(orgName.trim(), adminEmail.trim() || undefined);
      setLink(r.adminInviteLink ?? '');
      setOrgName('');
      setAdminEmail('');
      const list = await api.adminListOrgs();
      setOrgs(list);
      setOrgId(r.org.id);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to create the org.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog wide" onClick={(e) => e.stopPropagation()}>
        <h2>{isSuper ? 'Admin · spaces & members' : 'Members'}</h2>

        {isSuper && (
          <div style={{ marginBottom: 18 }}>
            <label>Create an organization (optionally invite its admin)</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input placeholder="Organization name" value={orgName} onChange={(e) => setOrgName(e.target.value)} style={{ flex: 1, minWidth: 160 }} />
              <input placeholder="Admin email (optional)" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} style={{ flex: 1, minWidth: 160 }} />
              <button className="send-btn" onClick={createOrg} disabled={busy}>
                Create
              </button>
            </div>
          </div>
        )}

        <label>Organization</label>
        <select value={orgId} onChange={(e) => { setOrgId(e.target.value); setLink(''); }}>
          {orgs.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>

        <label style={{ marginTop: 14 }}>Invite a member</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input placeholder="work@email.com" value={email} onChange={(e) => setEmail(e.target.value)} style={{ flex: 1 }} />
          <select value={role} onChange={(e) => setRole(e.target.value as 'member' | 'admin')}>
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
          <button className="send-btn" onClick={invite} disabled={busy}>
            Invite
          </button>
        </div>
        {link && (
          <div className="lnd-thanks" style={{ marginTop: 10 }}>
            <span className="cc-check">→</span>
            <div>
              <strong>Invite link — copy &amp; send it to them:</strong>
              <p style={{ wordBreak: 'break-all', fontSize: 13 }}>{link}</p>
              <button className="canvas-btn" onClick={() => navigator.clipboard?.writeText(link)}>
                Copy link
              </button>
            </div>
          </div>
        )}
        {error && <div style={{ color: 'var(--red)', fontSize: 13, marginTop: 6 }}>{error}</div>}

        <label style={{ marginTop: 16 }}>Members</label>
        <div className="kb-list">
          {members.map((m) => (
            <div key={m.id} className="kb-row">
              <span className="kb-name">
                {m.email} <span style={{ color: 'var(--text-faint)' }}>· {m.role}</span>
              </span>
              {m.userId !== me?.user?.id && (
                <button className="kb-del" onClick={() => remove(m)} title="Remove">
                  ✕
                </button>
              )}
            </div>
          ))}
          {members.length === 0 && <div style={{ color: 'var(--text-faint)', fontSize: 13, padding: 6 }}>No members yet.</div>}
        </div>

        {isSuper && leads.length > 0 && (
          <>
            <label style={{ marginTop: 16 }}>Waitlist ({leads.length})</label>
            <div className="kb-list">
              {leads.slice(0, 50).map((l) => (
                <div key={l.id} className="kb-row">
                  <span className="kb-name">
                    {l.email}
                    {l.company ? ` · ${l.company}` : ''}
                    {l.team ? ` · ${l.team}` : ''}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="actions" style={{ marginTop: 16 }}>
          <button className="cancel" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
