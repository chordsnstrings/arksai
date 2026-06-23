import { useEffect, useState } from 'react';
import { emailDomain, isFreeEmailDomain } from '@shared/types';
import { CURRENCY_CODES, CURRENCIES, DEFAULT_CURRENCY, currencyOf } from '@shared/currency';
import { api, type Lead, type Org, type OrgMember } from '../api/client';
import { useStore } from '../state/sessionStore';
import { confirmDialog } from '../state/confirmStore';
import { OrgAnalytics } from './OrgAnalytics';
import { EmailSettings } from './EmailSettings';
import { ConnectionsPanel } from './ConnectionsPanel';

/**
 * Admin panel. Org admins manage their members (invite via a link, change/remove);
 * the platform super-admin additionally provisions organizations and reviews the
 * waitlist. Invites are one-time links the admin copies and shares (no email infra).
 */
export function AdminDialog({ onClose }: { onClose: () => void }) {
  const me = useStore((s) => s.me);
  const setMe = useStore((s) => s.setMe);
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
  const [tab, setTab] = useState<'members' | 'usage' | 'email' | 'connections'>('members');

  // The inviting admin's own domain — used to flag invites to someone OUTSIDE the
  // org. Skipped for the super-admin (who onboards many orgs) and if their own
  // address is somehow a free one.
  const myDomain = isSuper || isFreeEmailDomain(me?.user?.email ?? '') ? '' : emailDomain(me?.user?.email ?? '');
  const inviteeDomain = emailDomain(email);
  const freeDomain = !!email.trim() && isFreeEmailDomain(email);
  const domainMismatch = !!inviteeDomain && !!myDomain && inviteeDomain !== myDomain;

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

  const changeCurrency = async (currency: string) => {
    if (!orgId) return;
    setOrgs((list) => list.map((o) => (o.id === orgId ? { ...o, currency } : o)));
    try {
      await api.updateOrg(orgId, { currency });
      // Refresh `me` so the cost bar + analytics pick up the new currency immediately.
      api.me().then(setMe).catch(() => {});
    } catch (e: any) {
      setError(e?.message || 'Could not update the currency.');
    }
  };

  const invite = async () => {
    const addr = email.trim();
    if (!addr || !orgId) {
      setError('Enter a valid email.');
      return;
    }
    if (isFreeEmailDomain(addr)) {
      setError('Use a company email — personal/free email domains (gmail, outlook, …) are not allowed.');
      return;
    }
    if (
      domainMismatch &&
      !(await confirmDialog({
        title: 'Invite someone outside your domain?',
        body: `${inviteeDomain} is outside your organization’s domain (${myDomain}).`,
        confirmLabel: 'Invite anyway',
      }))
    ) {
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
    if (!(await confirmDialog({ title: 'Remove this member?', body: `${m.email} will lose access to this organization.`, confirmLabel: 'Remove', danger: true }))) return;
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
    if (adminEmail.trim() && isFreeEmailDomain(adminEmail)) {
      setError('Use a company email for the org admin — personal/free email domains are not allowed.');
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

  const deleteSelectedOrg = async () => {
    const org = orgs.find((o) => o.id === orgId);
    if (!org) return;
    if (
      !(await confirmDialog({
        title: `Delete “${org.name}”?`,
        body: `This permanently deletes the organization and ALL its data — every chat, project, published app, schedule, and its member accounts. This cannot be undone.`,
        confirmLabel: 'Delete organization',
        danger: true,
      }))
    )
      return;
    setBusy(true);
    setError('');
    try {
      const r = await api.adminDeleteOrg(orgId);
      const list = await api.adminListOrgs();
      setOrgs(list);
      setOrgId(list[0]?.id ?? '');
      setLink('');
      setError(`Deleted “${r.name}” — removed ${r.sessions} chats, ${r.deployments} apps, and ${r.deletedUsers} user account(s).`);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to delete the org.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className={`dialog wide ${tab === 'usage' ? 'analytics' : ''}`} onClick={(e) => e.stopPropagation()}>
        <h2>{isSuper ? 'Admin · spaces & members' : 'Members'}</h2>

        <div className="an-tabs">
          <button className={`an-tab ${tab === 'members' ? 'active' : ''}`} onClick={() => setTab('members')}>
            {isSuper ? 'Spaces & members' : 'Members'}
          </button>
          <button className={`an-tab ${tab === 'usage' ? 'active' : ''}`} onClick={() => setTab('usage')}>
            Usage &amp; engagement
          </button>
          <button className={`an-tab ${tab === 'email' ? 'active' : ''}`} onClick={() => setTab('email')}>
            Email
          </button>
          <button className={`an-tab ${tab === 'connections' ? 'active' : ''}`} onClick={() => setTab('connections')}>
            Connections
          </button>
        </div>

        <label>Organization</label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select aria-label="Organization" value={orgId} onChange={(e) => { setOrgId(e.target.value); setLink(''); }} style={{ flex: 1 }}>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          {isSuper && orgId && orgId !== 'default' && (
            <button
              className="danger-btn"
              onClick={deleteSelectedOrg}
              disabled={busy}
              title="Delete this organization and all its data"
              style={{ whiteSpace: 'nowrap' }}
            >
              Delete org…
            </button>
          )}
        </div>

        <label>Currency <span style={{ color: 'var(--text-faint)', fontWeight: 400 }}>· how costs are shown for this organization</span></label>
        <select
          aria-label="Display currency"
          value={(orgs.find((o) => o.id === orgId)?.currency || DEFAULT_CURRENCY).toUpperCase()}
          onChange={(e) => changeCurrency(e.target.value)}
          disabled={!orgId || busy}
          style={{ width: '100%' }}
        >
          {CURRENCY_CODES.map((code) => (
            <option key={code} value={code}>
              {CURRENCIES[code].code} — {CURRENCIES[code].name} ({CURRENCIES[code].symbol})
            </option>
          ))}
        </select>

        {tab === 'usage' ? (
          orgId ? <OrgAnalytics orgId={orgId} currency={currencyOf(orgs.find((o) => o.id === orgId)?.currency).code} /> : <div className="an-empty">Select an organization.</div>
        ) : tab === 'email' ? (
          orgId ? <EmailSettings orgId={orgId} /> : <div className="an-empty">Select an organization.</div>
        ) : tab === 'connections' ? (
          <ConnectionsPanel />
        ) : (
        <>

        {isSuper && (
          <div style={{ margin: '14px 0 4px' }}>
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

        <label style={{ marginTop: 14 }}>Invite a member</label>
        <input
          type="email"
          autoComplete="off"
          placeholder="name@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !busy && invite()}
          style={{ width: '100%', boxSizing: 'border-box' }}
        />
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as 'member' | 'admin')}
            style={{ flex: '0 0 auto', width: 130 }}
            title="Role in the organization"
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
          <span style={{ flex: 1 }} />
          <button className="send-btn" onClick={invite} disabled={busy || !email.trim() || freeDomain}>
            Invite
          </button>
        </div>
        {freeDomain ? (
          <div style={{ color: 'var(--red)', fontSize: 12, marginTop: 6 }}>
            Company email required — personal/free email domains (gmail, outlook, …) aren’t allowed.
          </div>
        ) : domainMismatch ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 6 }}>
            Heads up: <strong>{inviteeDomain}</strong> is outside your organization’s domain (<strong>{myDomain}</strong>) —
            you’ll be asked to confirm.
          </div>
        ) : null}
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
