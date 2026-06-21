import { useEffect, useState } from 'react';
import type { Robot, RobotAutonomy, RobotDraft, RobotModel, RobotRole } from '@shared/types';
import { api, type EmailAccount, type RobotDraftResult } from '../api/client';
import { useStore } from '../state/sessionStore';
import { confirmDialog } from '../state/confirmStore';
import { EmailSettings } from './EmailSettings';

/**
 * Robots: hire a standing email agent. Onboarding connects the mailbox FIRST, then the
 * user picks what the robot is (customer assistant / personal assistant / custom). The
 * robot drafts replies (locked to the inbound sender) for one-tap approval — or sends
 * automatically once you trust it. Drafts can be A/B-compared across M3 and DeepSeek-v4.
 */

const ROLES: { id: RobotRole; icon: string; title: string; blurb: string }[] = [
  { id: 'customer_service', icon: '🎧', title: 'Customer assistant', blurb: 'Reads incoming support email and drafts on-brand replies grounded in your knowledge. Escalates refunds, billing, and anything sensitive to a human.' },
  { id: 'personal_assistant', icon: '📇', title: 'Personal assistant', blurb: 'Triages your inbox, acknowledges messages, accepts or declines invitations, and proposes times — on your behalf.' },
  { id: 'custom', icon: '✦', title: 'Custom', blurb: 'You define the persona and the knowledge; it replies within exactly the scope you set.' },
];
const MODELS: { id: RobotModel; label: string; note: string }[] = [
  { id: 'arksai-max', label: 'ArksAI Max', note: 'Best quality (M3)' },
  { id: 'deepseek-v4', label: 'ArksAI v4', note: 'Fast' },
  { id: 'compare', label: 'Compare both', note: 'Draft with each, you pick' },
];
const roleTitle = (r: RobotRole) => ROLES.find((x) => x.id === r)?.title ?? r;

interface WizardState {
  step: number;
  role: RobotRole;
  name: string;
  persona: string;
  knowledge: string;
  escalateOn: string;
  signature: string;
  model: RobotModel;
  autonomy: RobotAutonomy;
}
const freshWizard = (): WizardState => ({
  step: 0, role: 'customer_service', name: '', persona: '', knowledge: '', escalateOn: '',
  signature: '', model: 'arksai-max', autonomy: 'ask',
});

export function RobotsDialog({ onClose }: { onClose: () => void }) {
  const me = useStore((s) => s.me);
  const orgId = me?.currentOrg ?? me?.orgs?.[0]?.id ?? '';
  const isAdmin = !!me?.isSuperadmin || me?.role === 'admin';

  const [view, setView] = useState<'list' | 'wizard' | 'drafts'>('list');
  const [robots, setRobots] = useState<Robot[]>([]);
  const [drafts, setDrafts] = useState<RobotDraft[]>([]);
  const [account, setAccount] = useState<EmailAccount | null | undefined>(undefined);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    if (!orgId) return;
    api.listRobots(orgId).then(setRobots).catch(() => {});
    api.listDrafts(orgId, { status: 'pending' }).then(setDrafts).catch(() => {});
    api.getEmailAccount(orgId).then(setAccount).catch(() => setAccount(null));
  };
  useEffect(refresh, [orgId]);

  const mailboxReady = !!account && account.enabled;
  const pending = drafts.length;

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog wide robots-dialog" onClick={(e) => e.stopPropagation()}>
        <h2>Robots</h2>
        <p className="an-sub">Standing email agents. They read your inbox and draft replies for approval — or run on their own once you trust them.</p>

        <div className="an-tabs">
          <button className={`an-tab ${view === 'list' ? 'active' : ''}`} onClick={() => setView('list')}>My robots</button>
          <button className={`an-tab ${view === 'drafts' ? 'active' : ''}`} onClick={() => { setView('drafts'); refresh(); }}>
            Drafts{pending ? ` (${pending})` : ''}
          </button>
        </div>

        {error && <div className="form-error" style={{ marginTop: 10 }}>{error}</div>}

        {view === 'list' && (
          <RobotList
            robots={robots} mailboxReady={mailboxReady}
            onHire={() => { setError(''); setView('wizard'); }}
            onChanged={refresh} orgId={orgId} setBusy={setBusy} setError={setError} busy={busy}
          />
        )}

        {view === 'wizard' && (
          <Wizard
            orgId={orgId} account={account} isAdmin={isAdmin} mailboxReady={mailboxReady}
            onAccountChanged={() => api.getEmailAccount(orgId).then(setAccount).catch(() => {})}
            onDone={() => { setView('list'); refresh(); }}
            onCancel={() => setView('list')}
            setError={setError}
          />
        )}

        {view === 'drafts' && (
          <DraftInbox orgId={orgId} drafts={drafts} robots={robots} onChanged={refresh} setError={setError} />
        )}

        <div style={{ display: 'flex', marginTop: 16 }}>
          <button className="cancel" onClick={onClose} style={{ marginLeft: 'auto' }}>Close</button>
        </div>
      </div>
    </div>
  );
}

function RobotList({ robots, mailboxReady, onHire, onChanged, orgId, setBusy, setError, busy }: {
  robots: Robot[]; mailboxReady: boolean; onHire: () => void; onChanged: () => void;
  orgId: string; setBusy: (b: boolean) => void; setError: (s: string) => void; busy: boolean;
}) {
  const toggle = async (r: Robot) => {
    setBusy(true); setError('');
    try {
      await api.updateRobot(orgId, r.id, { status: r.status === 'active' ? 'paused' : 'active' });
      onChanged();
    } catch (e: any) { setError(e?.message || 'Could not update.'); } finally { setBusy(false); }
  };
  const remove = async (r: Robot) => {
    if (!(await confirmDialog({ title: 'Delete this robot?', body: `“${r.name}” and its drafts will be removed.`, confirmLabel: 'Delete', danger: true }))) return;
    setBusy(true);
    try { await api.deleteRobot(orgId, r.id); onChanged(); } catch (e: any) { setError(e?.message || 'Could not delete.'); } finally { setBusy(false); }
  };
  return (
    <div className="robot-list">
      <div style={{ display: 'flex', alignItems: 'center', margin: '12px 0' }}>
        <button className="send-btn" onClick={onHire}>＋ Hire a robot</button>
        {!mailboxReady && <span className="robot-hint" style={{ marginLeft: 12 }}>You'll connect a mailbox in the first step.</span>}
      </div>
      {robots.length === 0 && <div className="an-empty">No robots yet. Hire one to start handling email automatically.</div>}
      {robots.map((r) => (
        <div key={r.id} className="robot-row">
          <div className="robot-meta">
            <div className="robot-name">{r.name} <span className={`robot-status ${r.status}`}>{r.status}</span></div>
            <div className="robot-sub">{roleTitle(r.role)} · {r.model === 'compare' ? 'A/B models' : r.model === 'arksai-max' ? 'ArksAI Max' : 'ArksAI v4'} · {r.autonomy === 'auto' ? 'auto-send' : 'drafts for approval'}</div>
          </div>
          <button className="cancel sm" disabled={busy} onClick={() => toggle(r)}>{r.status === 'active' ? 'Pause' : 'Activate'}</button>
          <button className="kb-del" disabled={busy} onClick={() => remove(r)} title="Delete">✕</button>
        </div>
      ))}
    </div>
  );
}

function Wizard({ orgId, account, isAdmin, mailboxReady, onAccountChanged, onDone, onCancel, setError }: {
  orgId: string; account: EmailAccount | null | undefined; isAdmin: boolean; mailboxReady: boolean;
  onAccountChanged: () => void; onDone: () => void; onCancel: () => void; setError: (s: string) => void;
}) {
  const [w, setW] = useState<WizardState>(freshWizard);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ primary: RobotDraftResult; alt?: RobotDraftResult } | null>(null);
  const [sample, setSample] = useState('Hi, I ordered last week and haven\'t received a shipping update. Can you help?');
  const set = (p: Partial<WizardState>) => setW((s) => ({ ...s, ...p }));

  // Step 0 is the mailbox gate; if a mailbox is already connected, start at role choice.
  useEffect(() => { if (mailboxReady && w.step === 0) set({ step: 1 }); }, [mailboxReady]);

  const create = async (activate: boolean) => {
    setBusy(true); setError('');
    try {
      const robot = await api.createRobot(orgId, {
        name: w.name.trim() || roleTitle(w.role), role: w.role, model: w.model, autonomy: w.autonomy,
        config: { persona: w.persona, knowledge: w.knowledge, escalateOn: w.escalateOn, signature: w.signature },
      });
      if (activate) await api.updateRobot(orgId, robot.id, { status: 'active' });
      onDone();
    } catch (e: any) { setError(e?.message || 'Could not create the robot.'); } finally { setBusy(false); }
  };

  const runPreview = async () => {
    setBusy(true); setPreview(null); setError('');
    try {
      // Create a temporary draft robot to preview, then delete it — keeps preview honest.
      const robot = await api.createRobot(orgId, {
        name: 'preview', role: w.role, model: w.model, autonomy: 'shadow',
        config: { persona: w.persona, knowledge: w.knowledge, escalateOn: w.escalateOn, signature: w.signature },
      });
      try {
        const outcome = await api.previewRobot(orgId, robot.id, { subject: 'A question', body: sample });
        setPreview(outcome);
      } finally { api.deleteRobot(orgId, robot.id).catch(() => {}); }
    } catch (e: any) { setError(e?.message || 'Preview failed.'); } finally { setBusy(false); }
  };

  return (
    <div className="robot-wizard">
      {/* Step 0 — connect the mailbox first */}
      {w.step === 0 && (
        <div>
          <h3 className="wz-h">Step 1 · Connect your email</h3>
          <p className="an-sub">A robot works through your mailbox — it sends and reads on your behalf. Connect it once to begin.</p>
          {isAdmin ? (
            <EmailSettings orgId={orgId} />
          ) : (
            <div className="an-empty">Ask an organization admin to connect a mailbox under Settings → Email, then come back.</div>
          )}
          <div className="wz-nav">
            <button className="cancel" onClick={onCancel}>Cancel</button>
            <button className="send-btn" disabled={!mailboxReady} onClick={() => { onAccountChanged(); set({ step: 1 }); }} style={{ marginLeft: 'auto' }}>
              {mailboxReady ? 'Continue →' : 'Connect a mailbox to continue'}
            </button>
          </div>
        </div>
      )}

      {/* Step 1 — pick the role */}
      {w.step === 1 && (
        <div>
          <h3 className="wz-h">Step 2 · What should this robot do?</h3>
          <div className="role-grid">
            {ROLES.map((r) => (
              <button key={r.id} className={`role-card ${w.role === r.id ? 'picked' : ''}`} onClick={() => set({ role: r.id })}>
                <div className="role-ic">{r.icon}</div>
                <div className="role-t">{r.title}</div>
                <div className="role-b">{r.blurb}</div>
              </button>
            ))}
          </div>
          <div className="wz-nav">
            <button className="cancel" onClick={() => set({ step: mailboxReady ? 0 : 0 })}>← Back</button>
            <button className="send-btn" onClick={() => set({ step: 2 })} style={{ marginLeft: 'auto' }}>Continue →</button>
          </div>
        </div>
      )}

      {/* Step 2 — configure */}
      {w.step === 2 && (
        <div>
          <h3 className="wz-h">Step 3 · Teach it</h3>
          <label>Name</label>
          <input value={w.name} placeholder={roleTitle(w.role)} onChange={(e) => set({ name: e.target.value })} style={{ width: '100%', boxSizing: 'border-box' }} />
          <label style={{ marginTop: 10 }}>Persona &amp; tone</label>
          <textarea rows={2} value={w.persona} placeholder="e.g. Warm, concise, British English. Always thank the customer." onChange={(e) => set({ persona: e.target.value })} />
          <label style={{ marginTop: 10 }}>Knowledge it can answer from</label>
          <textarea rows={4} value={w.knowledge} placeholder="Paste product info, policies, FAQ, hours, your preferences — whatever it should ground replies in." onChange={(e) => set({ knowledge: e.target.value })} />
          <label style={{ marginTop: 10 }}>Always escalate when…</label>
          <textarea rows={2} value={w.escalateOn} placeholder="e.g. refunds, cancellations, anything about money, legal threats, an upset customer." onChange={(e) => set({ escalateOn: e.target.value })} />
          <label style={{ marginTop: 10 }}>Signature</label>
          <input value={w.signature} placeholder="— The Acme Team" onChange={(e) => set({ signature: e.target.value })} style={{ width: '100%', boxSizing: 'border-box' }} />

          <label style={{ marginTop: 12 }}>Which model drafts the replies?</label>
          <div className="model-row">
            {MODELS.map((m) => (
              <button key={m.id} className={`model-pill ${w.model === m.id ? 'picked' : ''}`} onClick={() => set({ model: m.id })}>
                <span>{m.label}</span><small>{m.note}</small>
              </button>
            ))}
          </div>

          <label style={{ marginTop: 12 }}>How much autonomy?</label>
          <div className="model-row">
            <button className={`model-pill ${w.autonomy === 'ask' ? 'picked' : ''}`} onClick={() => set({ autonomy: 'ask' })}><span>Draft for approval</span><small>Recommended</small></button>
            <button className={`model-pill ${w.autonomy === 'auto' ? 'picked' : ''}`} onClick={() => set({ autonomy: 'auto' })}><span>Send automatically</span><small>Replies on its own</small></button>
          </div>

          <div className="wz-nav">
            <button className="cancel" onClick={() => set({ step: 1 })}>← Back</button>
            <button className="cancel" onClick={() => set({ step: 3 })}>Preview a reply →</button>
            <button className="send-btn" disabled={busy} onClick={() => create(true)} style={{ marginLeft: 'auto' }}>Activate robot</button>
          </div>
        </div>
      )}

      {/* Step 3 — preview / bake-off */}
      {w.step === 3 && (
        <div>
          <h3 className="wz-h">Preview &amp; compare</h3>
          <p className="an-sub">Paste a sample message the robot might receive, then see how it would reply{w.model === 'compare' ? ' with each model side by side' : ''}.</p>
          <textarea rows={3} value={sample} onChange={(e) => setSample(e.target.value)} />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="cancel" disabled={busy} onClick={runPreview}>{busy ? 'Drafting…' : 'Draft a reply'}</button>
          </div>
          {preview && (
            <div className="preview-grid">
              <DraftPreview label={preview.primary.model || 'Draft'} d={preview.primary} />
              {preview.alt && <DraftPreview label={preview.alt.model || 'Alternate'} d={preview.alt} />}
            </div>
          )}
          <div className="wz-nav">
            <button className="cancel" onClick={() => set({ step: 2 })}>← Back</button>
            <button className="send-btn" disabled={busy} onClick={() => create(true)} style={{ marginLeft: 'auto' }}>Activate robot</button>
          </div>
        </div>
      )}
    </div>
  );
}

function DraftPreview({ label, d }: { label: string; d: RobotDraftResult }) {
  return (
    <div className="preview-card">
      <div className="preview-label">{label}{d.escalate && <span className="esc-badge">escalates</span>}</div>
      {d.escalate ? <div className="esc-reason">{d.reason || 'Would hand this to a human.'}</div> : <div className="preview-text">{d.text}</div>}
    </div>
  );
}

function DraftInbox({ orgId, drafts, robots, onChanged, setError }: {
  orgId: string; drafts: RobotDraft[]; robots: Robot[]; onChanged: () => void; setError: (s: string) => void;
}) {
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState('');
  const robotName = (id: string) => robots.find((r) => r.id === id)?.name ?? 'Robot';

  const send = async (d: RobotDraft) => {
    setBusyId(d.id); setError('');
    try { await api.sendDraft(orgId, d.id, edited[d.id]); onChanged(); }
    catch (e: any) { setError(e?.message || 'Send failed.'); } finally { setBusyId(''); }
  };
  const dismiss = async (d: RobotDraft) => {
    setBusyId(d.id);
    try { await api.dismissDraft(orgId, d.id); onChanged(); }
    catch (e: any) { setError(e?.message || 'Could not dismiss.'); } finally { setBusyId(''); }
  };
  const useAlt = (d: RobotDraft) => { if (d.altText) setEdited((m) => ({ ...m, [d.id]: d.altText! })); };

  if (drafts.length === 0) return <div className="an-empty" style={{ marginTop: 14 }}>No drafts waiting. When your robots reply to incoming mail, drafts appear here for approval.</div>;
  return (
    <div className="draft-inbox">
      {drafts.map((d) => (
        <div key={d.id} className={`draft-card ${d.escalated ? 'escalated' : ''}`}>
          <div className="draft-head">
            <div>
              <div className="draft-from">{d.inboundName ? `${d.inboundName} <${d.inboundFrom}>` : d.inboundFrom}</div>
              <div className="draft-subj">{robotName(d.robotId)} · re: {d.inboundSubject || '(no subject)'}</div>
            </div>
            <div className="draft-model">{d.modelUsed}</div>
          </div>
          {d.inboundSnippet && <div className="draft-inbound">“{d.inboundSnippet}”</div>}
          {d.escalated ? (
            <div className="esc-reason">⚑ Flagged for you: {d.escalationReason || 'needs a human.'} You can still write a reply below and send it.</div>
          ) : null}
          <textarea
            className="draft-text-edit" rows={5}
            value={edited[d.id] ?? d.draftText}
            onChange={(e) => setEdited((m) => ({ ...m, [d.id]: e.target.value }))}
          />
          {d.altText && (
            <details className="draft-alt">
              <summary>Compare {d.altModel || 'other model'}'s draft</summary>
              <div className="draft-alt-text">{d.altText}</div>
              <button className="cancel sm" onClick={() => useAlt(d)}>Use this version</button>
            </details>
          )}
          <div className="draft-actions">
            <div className="draft-to">to {d.toAddr}</div>
            <button className="cancel sm" disabled={busyId === d.id} onClick={() => dismiss(d)}>Dismiss</button>
            <button className="send-btn sm" disabled={busyId === d.id} onClick={() => send(d)}>{busyId === d.id ? 'Sending…' : 'Approve & send'}</button>
          </div>
        </div>
      ))}
    </div>
  );
}
