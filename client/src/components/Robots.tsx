import { useEffect, useMemo, useState } from 'react';
import { ICONS, type IconName } from '../lib/departments';
import {
  AUTONOMY,
  ROLES,
  STATUS_META,
  TRIGGERS,
  roleSpec,
  type AutonomyLevel,
  type Robot,
  type TriggerKind,
} from '../lib/robots';
import { useRobots } from '../state/robotsStore';
import { useStore } from '../state/sessionStore';
import { confirmDialog } from '../state/confirmStore';
import { EmailSettings } from './EmailSettings';
import { api } from '../api/client';
import type { RobotDraft } from '@shared/types';

/** Compact relative time: "just now" · "4m ago" · "2h ago" · "3d ago" · or a date. */
function ago(ms: number | null | undefined): string {
  if (!ms) return 'never';
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return new Date(ms).toLocaleDateString();
}

const DRAFT_STATUS: Record<RobotDraft['status'], { label: string; tone: string }> = {
  sent: { label: 'Replied', tone: '#2f7d5b' },
  pending: { label: 'Awaiting you', tone: '#b07d2a' },
  escalated: { label: 'Escalated', tone: '#c0502f' },
  dismissed: { label: 'Dismissed', tone: '#8a8a8a' },
};

/**
 * "Robots" — the separate, full-page agentic surface (reached from the Sidebar link / /robots).
 * A management console for standing, role-branded agents: a roster (Home), a "Needs You" approval
 * inbox, a Hire flow, and a per-robot office (mandate · autonomy · triggers · journal · outputs).
 * Chat is untouched; this is its own world. UI shell with real empty states — no mock data; the
 * durable runtime is the next build.
 */

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      dangerouslySetInnerHTML={{ __html: ICONS[name] }}
    />
  );
}

type View = { v: 'home' } | { v: 'inbox' } | { v: 'hire' } | { v: 'office'; id: string };

export function Robots({ onClose }: { onClose: () => void }) {
  const robots = useRobots((s) => s.robots);
  const approvals = useRobots((s) => s.approvals);
  const load = useRobots((s) => s.load);
  const orgId = useStore((s) => s.me?.currentOrg ?? s.me?.orgs?.[0]?.id ?? '');
  const [view, setView] = useState<View>({ v: 'home' });

  // Back the console with the real per-org engine: load robots + pending drafts on open
  // and whenever the org changes.
  useEffect(() => {
    if (orgId) void load(orgId);
  }, [orgId, load]);

  const open = (v: View) => setView(v);
  const office = view.v === 'office' ? robots.find((r) => r.id === view.id) : null;

  return (
    <div className="robots">
      <header className="rb-top">
        <button className="rb-back" onClick={onClose} title="Back to ArksAI">
          ← ArksAI
        </button>
        <div className="rb-brand">
          <span className="rb-logo">🤖</span>
          <div>
            <div className="rb-title">Robots</div>
            <div className="rb-sub">Standing agents that work while you’re away</div>
          </div>
        </div>
        <nav className="rb-tabs">
          <button className={view.v === 'home' ? 'on' : ''} onClick={() => open({ v: 'home' })}>
            Your robots
          </button>
          <button className={view.v === 'inbox' ? 'on' : ''} onClick={() => open({ v: 'inbox' })}>
            Needs you
            {approvals.length > 0 && <span className="rb-badge">{approvals.length}</span>}
          </button>
        </nav>
        <button className="rb-hire" onClick={() => open({ v: 'hire' })}>
          + Hire a robot
        </button>
      </header>

      <main className="rb-main">
        {view.v === 'home' && <Home robots={robots} onOpen={(id) => open({ v: 'office', id })} onHire={() => open({ v: 'hire' })} />}
        {view.v === 'inbox' && <Inbox onHome={() => open({ v: 'home' })} />}
        {view.v === 'hire' && <Hire onDone={(id) => open({ v: 'office', id })} onCancel={() => open({ v: 'home' })} />}
        {view.v === 'office' &&
          (office ? <Office robot={office} onBack={() => open({ v: 'home' })} /> : <Home robots={robots} onOpen={(id) => open({ v: 'office', id })} onHire={() => open({ v: 'hire' })} />)}
      </main>
    </div>
  );
}

/* ---------------- Home: the roster ---------------- */
function Home({ robots, onOpen, onHire }: { robots: Robot[]; onOpen: (id: string) => void; onHire: () => void }) {
  if (robots.length === 0) {
    return (
      <div className="rb-empty">
        <div className="rb-empty-art">🤖</div>
        <h2>Put a function on autopilot</h2>
        <p>
          A robot is a standing teammate for one part of your business — it works on a schedule or when something
          happens, and checks in with you when it needs a decision. You don’t have one yet.
        </p>
        <button className="rb-cta" onClick={onHire}>
          Hire your first robot
        </button>
        <div className="rb-suggest">
          <span>Popular roles</span>
          <div className="rb-suggest-row">
            {ROLES.slice(0, 5).map((r) => (
              <button key={r.id} className="rb-chip" style={{ ['--accent' as any]: r.accent }} onClick={onHire}>
                <Icon name={r.icon} size={15} /> {r.name}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="rb-roster">
      {robots.map((r) => {
        const spec = roleSpec(r.role);
        const st = STATUS_META[r.status];
        return (
          <button key={r.id} className="rb-card" style={{ ['--accent' as any]: spec?.accent ?? '#555' }} onClick={() => onOpen(r.id)}>
            <div className="rb-card-head">
              <span className="rb-card-icon">{spec && <Icon name={spec.icon} size={20} />}</span>
              <span className="rb-status" style={{ ['--tone' as any]: st.tone }}>
                {st.label}
              </span>
            </div>
            <div className="rb-card-name">{r.name}</div>
            <div className="rb-card-mandate">{r.mandate || spec?.blurb}</div>
            <div className="rb-card-foot">
              {r.mailboxReady === false ? (
                <span className="rb-task warn">⚠ Needs a mailbox</span>
              ) : r.currentTask ? (
                <span className="rb-task">{r.currentTask}</span>
              ) : (
                <span className="rb-task muted">Watching its inbox</span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

/* ---------------- Inbox: Needs You ---------------- */
function Inbox({ onHome }: { onHome: () => void }) {
  const approvals = useRobots((s) => s.approvals);
  const robots = useRobots((s) => s.robots);
  const resolve = useRobots((s) => s.resolveApproval);

  if (approvals.length === 0) {
    return (
      <div className="rb-empty">
        <div className="rb-empty-art">✓</div>
        <h2>Nothing needs you right now</h2>
        <p>
          When a robot wants to do something it isn’t cleared to do on its own — send an email, pause an ad, finalize a
          report — it’ll wait for you here. You’ll approve, edit, or decline in one tap.
        </p>
        <button className="rb-cta ghost" onClick={onHome}>
          Back to your robots
        </button>
      </div>
    );
  }
  return (
    <div className="rb-inbox">
      {approvals.map((a) => {
        const r = robots.find((x) => x.id === a.robotId);
        const spec = r && roleSpec(r.role);
        return (
          <div key={a.id} className="rb-approval" style={{ ['--accent' as any]: spec?.accent ?? '#555' }}>
            <div className="rb-approval-from">
              {spec && <Icon name={spec.icon} size={15} />} {r?.name ?? 'A robot'}
            </div>
            <div className="rb-approval-title">{a.title}</div>
            <div className="rb-approval-why">{a.why}</div>
            {a.draft && <pre className="rb-approval-draft">{a.draft}</pre>}
            <div className="rb-approval-actions">
              <button className="rb-approve" onClick={() => resolve(a.id, 'send')}>
                Approve &amp; send
              </button>
              <button className="rb-decline" onClick={() => resolve(a.id, 'dismiss')}>
                Dismiss
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- Hire flow ---------------- */
type Kind = 'customer_service' | 'personal_assistant' | 'custom';
const KINDS: { id: Kind; emoji: string; title: string; blurb: string }[] = [
  { id: 'customer_service', emoji: '🎧', title: 'Customer assistant', blurb: 'Handles incoming customer & support email — drafts on-brand replies from your knowledge, escalates the sensitive stuff.' },
  { id: 'personal_assistant', emoji: '📇', title: 'Personal assistant', blurb: 'Manages your inbox on your behalf — triages, acknowledges, accepts or declines invites, proposes times.' },
  { id: 'custom', emoji: '✦', title: 'Department specialist', blurb: 'An expert for one function (Finance, Marketing, Legal…) that answers email in that domain.' },
];
const DEFAULT_MANDATE: Record<Kind, string> = {
  customer_service:
    'Reply to incoming customer email: answer from our knowledge, keep it warm and on-brand, and escalate refunds, billing, or anything sensitive to a human.',
  personal_assistant:
    'Manage my inbox: triage what arrives, acknowledge messages, accept or decline meeting invitations, and propose times — checking with me before anything consequential.',
  custom: '',
};

function Hire({ onDone, onCancel }: { onDone: (id: string) => void; onCancel: () => void }) {
  const hire = useRobots((s) => s.hire);
  const setStatus = useRobots((s) => s.setStatus);
  const orgId = useRobots((s) => s.orgId) ?? '';

  const [step, setStep] = useState(0);
  const [kind, setKind] = useState<Kind | null>(null);
  const [dept, setDept] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [mandate, setMandate] = useState('');
  const [knowledge, setKnowledge] = useState('');
  const [escalateOn, setEscalateOn] = useState('');
  const [signature, setSignature] = useState('');
  const [autonomy, setAutonomy] = useState<AutonomyLevel>('ask_big');
  const [triggers, setTriggers] = useState<TriggerKind[]>(['event']);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const spec = dept ? roleSpec(dept) : null;
  const accent = spec?.accent ?? '#3a6ea5';
  const toggleTrigger = (t: TriggerKind) =>
    setTriggers((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));

  const pickKind = (k: Kind) => {
    setKind(k);
    if (k !== 'custom') {
      setDept(null);
      setName(KINDS.find((x) => x.id === k)!.title);
      setMandate(DEFAULT_MANDATE[k]);
    }
  };
  const pickDept = (id: string) => {
    const s = roleSpec(id);
    setDept(id);
    setName(s?.name ?? '');
    setMandate(s?.mandateSuggestion ?? '');
  };

  const create = async () => {
    setBusy(true);
    try {
      const r = await hire({ kind: kind!, dept: dept ?? undefined, name, mandate, knowledge, escalateOn, signature, autonomy, triggers });
      setCreatedId(r.id);
      setStep(2);
    } finally {
      setBusy(false);
    }
  };

  // Step 0 — what kind of assistant?
  if (step === 0) {
    const ready = kind && (kind !== 'custom' || dept);
    return (
      <div className="rb-hire-flow">
        <div className="rb-hire-head">
          <h2>Hire a robot</h2>
          <p>What should it do? This sets how it reads and answers your email.</p>
        </div>
        <div className="rb-role-grid">
          {KINDS.map((k) => (
            <button key={k.id} className={`rb-role ${kind === k.id ? 'picked' : ''}`} onClick={() => pickKind(k.id)}>
              <span className="rb-role-icon" style={{ fontSize: 22 }}>{k.emoji}</span>
              <div className="rb-role-name">{k.title}</div>
              <div className="rb-role-blurb">{k.blurb}</div>
            </button>
          ))}
        </div>
        {kind === 'custom' && (
          <>
            <p className="rb-sub" style={{ margin: '14px 0 8px' }}>Which function is it an expert in?</p>
            <div className="rb-role-grid">
              {ROLES.map((r) => (
                <button key={r.id} className={`rb-role ${dept === r.id ? 'picked' : ''}`} style={{ ['--accent' as any]: r.accent }} onClick={() => pickDept(r.id)}>
                  <span className="rb-role-icon"><Icon name={r.icon} size={20} /></span>
                  <div className="rb-role-name">{r.name}</div>
                </button>
              ))}
            </div>
          </>
        )}
        <div className="rb-hire-actions">
          <button className="rb-cta" disabled={!ready} onClick={() => setStep(1)}>Continue →</button>
          <button className="rb-cta ghost" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    );
  }

  // Step 1 — teach it
  if (step === 1) {
    return (
      <div className="rb-hire-flow">
        <div className="rb-hire-head" style={{ ['--accent' as any]: accent }}>
          <button className="rb-link" onClick={() => setStep(0)}>← Back</button>
          <h2>Teach {name || 'your robot'}</h2>
        </div>
        <label className="rb-field"><span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name this robot" />
        </label>
        <label className="rb-field"><span>Its standing job (mandate)</span>
          <textarea rows={3} value={mandate} onChange={(e) => setMandate(e.target.value)} placeholder="In plain language, what should it keep doing?" />
        </label>
        <label className="rb-field"><span>Knowledge it can answer from</span>
          <textarea rows={4} value={knowledge} onChange={(e) => setKnowledge(e.target.value)} placeholder="Paste product info, policies, FAQ, hours, your preferences — whatever it should ground replies in." />
        </label>
        <label className="rb-field"><span>Always escalate when…</span>
          <textarea rows={2} value={escalateOn} onChange={(e) => setEscalateOn(e.target.value)} placeholder="e.g. refunds, cancellations, anything about money, legal threats, an upset customer." />
        </label>
        <label className="rb-field"><span>Signature</span>
          <input value={signature} onChange={(e) => setSignature(e.target.value)} placeholder="— The Acme Team" />
        </label>
        <div className="rb-field"><span>When should it work?</span>
          <div className="rb-triggers">
            {TRIGGERS.map((t) => (
              <button key={t.id} className={`rb-trigger ${triggers.includes(t.id) ? 'on' : ''}`} onClick={() => toggleTrigger(t.id)}>
                <Icon name={t.icon} size={15} />
                <div><div className="rb-trigger-label">{t.label}</div><div className="rb-trigger-blurb">{t.blurb}</div></div>
              </button>
            ))}
          </div>
        </div>
        <div className="rb-field"><span>How much can it do on its own?</span>
          <AutonomyDial value={autonomy} onChange={setAutonomy} />
        </div>
        <div className="rb-hire-actions">
          <button className="rb-cta" style={{ ['--accent' as any]: accent }} disabled={!mandate.trim() || busy} onClick={create}>
            {busy ? 'Creating…' : 'Continue → connect its mailbox'}
          </button>
          <button className="rb-cta ghost" onClick={() => setStep(0)}>Back</button>
        </div>
      </div>
    );
  }

  // Step 2 — connect the robot's own mailbox (connect-first, but skippable)
  return (
    <div className="rb-hire-flow">
      <div className="rb-hire-head" style={{ ['--accent' as any]: accent }}>
        <h2>Connect {name || 'your robot'}’s mailbox</h2>
        <p>Each robot has its own email identity. Connect a mailbox so it can read and reply on its own. It won’t start working until one is connected.</p>
      </div>
      {createdId && orgId && <EmailSettings orgId={orgId} robotId={createdId} />}
      <div className="rb-hire-actions" style={{ marginTop: 16 }}>
        <button className="rb-cta" style={{ ['--accent' as any]: accent }} onClick={() => { if (createdId) setStatus(createdId, 'idle'); onDone(createdId!); }}>
          Activate robot
        </button>
        <button className="rb-cta ghost" onClick={() => onDone(createdId!)}>Connect later (stays paused)</button>
      </div>
    </div>
  );
}

/* ---------------- Office: one robot ---------------- */
function Office({ robot, onBack }: { robot: Robot; onBack: () => void }) {
  const spec = roleSpec(robot.role);
  const update = useRobots((s) => s.update);
  const remove = useRobots((s) => s.remove);
  const setStatus = useRobots((s) => s.setStatus);
  const reload = useRobots((s) => s.load);
  const orgId = useRobots((s) => s.orgId) ?? '';
  const [mandate, setMandate] = useState(robot.mandate);
  const dirty = mandate.trim() !== robot.mandate;
  const st = STATUS_META[robot.status];

  // Real activity comes from the robot's drafts (every email it acted on) + its last-poll
  // heartbeat — not the old hard-coded empty journal. Deliverables = the replies it sent.
  const [drafts, setDrafts] = useState<RobotDraft[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkMsg, setCheckMsg] = useState<string | null>(null);

  const loadDrafts = useMemo(
    () => async () => {
      if (!orgId) return;
      try {
        setDrafts(await api.listDrafts(orgId, { robotId: robot.id }));
      } catch {
        setDrafts([]);
      }
    },
    [orgId, robot.id],
  );
  useEffect(() => {
    setDrafts(null);
    void loadDrafts();
  }, [loadDrafts]);

  const sent = (drafts ?? []).filter((d) => d.status === 'sent');

  const checkNow = async () => {
    if (!orgId || checking) return;
    setChecking(true);
    setCheckMsg(null);
    try {
      const s = await api.pollRobot(orgId, robot.id);
      setCheckMsg(
        s.error
          ? `Couldn’t check: ${s.error}`
          : s.read === 0
            ? 'Inbox checked — nothing new.'
            : `Checked — ${s.read} new · ${s.sent} replied${s.drafted - s.sent > 0 ? ` · ${s.drafted - s.sent} for you` : ''}${s.escalated ? ` · ${s.escalated} escalated` : ''}.`,
      );
      await Promise.all([loadDrafts(), reload(orgId)]);
    } catch (e: any) {
      setCheckMsg(typeof e?.message === 'string' ? e.message : 'Couldn’t check the inbox right now.');
    } finally {
      setChecking(false);
    }
  };

  const fire = async () => {
    if (await confirmDialog({ title: `Dismiss ${robot.name}?`, body: 'This removes the robot and anything waiting on it.', confirmLabel: 'Dismiss', danger: true })) {
      remove(robot.id);
      onBack();
    }
  };

  return (
    <div className="rb-office" style={{ ['--accent' as any]: spec?.accent ?? '#555' }}>
      <button className="rb-link" onClick={onBack}>
        ← All robots
      </button>

      <div className="rb-office-head">
        <span className="rb-office-icon">{spec && <Icon name={spec.icon} size={26} />}</span>
        <div className="rb-office-id">
          <div className="rb-office-name">{robot.name}</div>
          <div className="rb-office-role">
            {spec?.dept}
            {robot.mailboxReady && <> · checked {ago(robot.lastPolledAt)}</>}
          </div>
        </div>
        {robot.mailboxReady && robot.status !== 'paused' && (
          <button className="rb-ghost-btn rb-check" onClick={checkNow} disabled={checking}>
            {checking ? 'Checking…' : 'Check inbox now'}
          </button>
        )}
        <span className="rb-status big" style={{ ['--tone' as any]: st.tone }}>
          {st.label}
        </span>
      </div>
      {checkMsg && <div className="rb-check-msg">{checkMsg}</div>}

      <div className="rb-office-grid">
        <section className="rb-panel">
          <h3>Mandate</h3>
          <textarea rows={4} value={mandate} onChange={(e) => setMandate(e.target.value)} />
          <div className="rb-panel-actions">
            <button className="rb-save" disabled={!dirty} onClick={() => update(robot.id, { mandate: mandate.trim() })}>
              {dirty ? 'Save changes' : 'Saved'}
            </button>
          </div>
        </section>

        <section className="rb-panel">
          <h3>Autonomy</h3>
          <AutonomyDial value={robot.autonomy} onChange={(a) => update(robot.id, { autonomy: a })} />
          <h3 style={{ marginTop: 18 }}>Triggers</h3>
          <div className="rb-trigger-tags">
            {robot.triggers.map((t) => {
              const tm = TRIGGERS.find((x) => x.id === t);
              return (
                <span key={t} className="rb-trigger-tag">
                  {tm && <Icon name={tm.icon} size={13} />} {tm?.label}
                </span>
              );
            })}
          </div>
          <div className="rb-panel-actions">
            {robot.status === 'paused' ? (
              <button className="rb-save" onClick={() => setStatus(robot.id, 'idle')}>
                Resume
              </button>
            ) : (
              <button className="rb-ghost-btn" onClick={() => setStatus(robot.id, 'paused')}>
                Pause
              </button>
            )}
            <button className="rb-danger-btn" onClick={fire}>
              Dismiss
            </button>
          </div>
        </section>

        <section className="rb-panel rb-span">
          <h3>Mailbox {robot.mailboxReady
            ? <span className="rb-status" style={{ ['--tone' as any]: '#2f7d5b' }}>connected</span>
            : <span className="rb-status" style={{ ['--tone' as any]: '#c0502f' }}>needs setup</span>}</h3>
          <p className="rb-mini-empty" style={{ marginBottom: 6 }}>
            This robot has its own email identity. Connect a mailbox here so it can read incoming mail and send replies on its own behalf.
          </p>
          {orgId && <EmailSettings orgId={orgId} robotId={robot.id} />}
        </section>

        <section className="rb-panel rb-span">
          <div className="rb-panel-head">
            <h3>Activity</h3>
            {drafts && drafts.length > 0 && <span className="rb-count">{drafts.length}</span>}
          </div>
          {drafts === null ? (
            <div className="rb-mini-empty">Loading…</div>
          ) : drafts.length === 0 ? (
            <div className="rb-mini-empty">
              {robot.mailboxReady
                ? `No emails handled yet. When mail arrives, ${robot.name} will draft or send a reply and each one shows here.`
                : `Connect a mailbox above so ${robot.name} can read incoming mail and act on it.`}
            </div>
          ) : (
            <ul className="rb-feed">
              {drafts.map((d) => {
                const ds = DRAFT_STATUS[d.status];
                return (
                  <li key={d.id} className="rb-feed-row">
                    <span className="rb-feed-dot" style={{ ['--tone' as any]: ds.tone }} />
                    <div className="rb-feed-main">
                      <div className="rb-feed-top">
                        <span className="rb-feed-from">{d.inboundName || d.inboundFrom}</span>
                        <span className="rb-feed-when">{ago(d.sentAt ?? d.createdAt)}</span>
                      </div>
                      <div className="rb-feed-subj">{d.inboundSubject || '(no subject)'}</div>
                      {d.inboundSnippet && <div className="rb-feed-snip">{d.inboundSnippet}</div>}
                    </div>
                    <span className="rb-status" style={{ ['--tone' as any]: ds.tone }}>{ds.label}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="rb-panel rb-span">
          <div className="rb-panel-head">
            <h3>Delivered</h3>
            {sent.length > 0 && <span className="rb-count">{sent.length}</span>}
          </div>
          {drafts === null ? (
            <div className="rb-mini-empty">Loading…</div>
          ) : sent.length === 0 ? (
            <div className="rb-mini-empty">No replies sent yet. Replies {robot.name} sends on its own (or that you approve) collect here.</div>
          ) : (
            <ul className="rb-feed">
              {sent.map((d) => (
                <li key={d.id} className="rb-feed-row">
                  <span className="rb-out-kind">reply</span>
                  <div className="rb-feed-main">
                    <div className="rb-feed-top">
                      <span className="rb-feed-from">To {d.inboundName || d.inboundFrom}</span>
                      <span className="rb-feed-when">{ago(d.sentAt ?? d.createdAt)}</span>
                    </div>
                    <div className="rb-feed-subj">{d.subject || d.inboundSubject || '(no subject)'}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

/* ---------------- Autonomy dial ---------------- */
function AutonomyDial({ value, onChange }: { value: AutonomyLevel; onChange: (v: AutonomyLevel) => void }) {
  const idx = useMemo(() => AUTONOMY.findIndex((a) => a.id === value), [value]);
  return (
    <div className="rb-dial">
      <div className="rb-dial-track">
        {AUTONOMY.map((a, i) => (
          <button key={a.id} className={`rb-dial-stop ${i === idx ? 'on' : ''} ${i <= idx ? 'lit' : ''}`} onClick={() => onChange(a.id)} title={a.label}>
            <span className="rb-dial-dot" />
          </button>
        ))}
      </div>
      <div className="rb-dial-label">
        <strong>{AUTONOMY[idx]?.label}</strong>
        <span>{AUTONOMY[idx]?.blurb}</span>
      </div>
    </div>
  );
}
