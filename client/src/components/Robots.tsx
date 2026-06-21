import { useMemo, useState } from 'react';
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
import { confirmDialog } from '../state/confirmStore';

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
  const [view, setView] = useState<View>({ v: 'home' });

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
              {r.currentTask ? <span className="rb-task">{r.currentTask}</span> : <span className="rb-task muted">Waiting for its next trigger</span>}
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
              <button className="rb-approve" onClick={() => resolve(a.id)}>
                Approve
              </button>
              <button className="rb-edit" onClick={() => resolve(a.id)}>
                Edit…
              </button>
              <button className="rb-decline" onClick={() => resolve(a.id)}>
                Decline
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- Hire flow ---------------- */
function Hire({ onDone, onCancel }: { onDone: (id: string) => void; onCancel: () => void }) {
  const hire = useRobots((s) => s.hire);
  const [role, setRole] = useState<string | null>(null);
  const spec = role ? roleSpec(role) : null;
  const [name, setName] = useState('');
  const [mandate, setMandate] = useState('');
  const [autonomy, setAutonomy] = useState<AutonomyLevel>('ask_big');
  const [triggers, setTriggers] = useState<TriggerKind[]>(['schedule']);

  const pick = (id: string) => {
    const s = roleSpec(id);
    setRole(id);
    setName(s?.name ?? '');
    setMandate(s?.mandateSuggestion ?? '');
  };
  const toggleTrigger = (t: TriggerKind) =>
    setTriggers((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));

  if (!role) {
    return (
      <div className="rb-hire-flow">
        <div className="rb-hire-head">
          <h2>Hire a robot</h2>
          <p>Pick the part of your business it should run. You’ll set its mandate and how much it can do on its own next.</p>
        </div>
        <div className="rb-role-grid">
          {ROLES.map((r) => (
            <button key={r.id} className="rb-role" style={{ ['--accent' as any]: r.accent }} onClick={() => pick(r.id)}>
              <span className="rb-role-icon">
                <Icon name={r.icon} size={20} />
              </span>
              <div className="rb-role-name">{r.name}</div>
              <div className="rb-role-blurb">{r.blurb}</div>
            </button>
          ))}
        </div>
        <button className="rb-cta ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="rb-hire-flow">
      <div className="rb-hire-head" style={{ ['--accent' as any]: spec?.accent }}>
        <button className="rb-link" onClick={() => setRole(null)}>
          ← Pick a different role
        </button>
        <h2>
          {spec && <Icon name={spec.icon} size={22} />} {name || spec?.name}
        </h2>
      </div>

      <label className="rb-field">
        <span>Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={spec?.name} />
      </label>

      <label className="rb-field">
        <span>Its standing job (mandate)</span>
        <textarea rows={3} value={mandate} onChange={(e) => setMandate(e.target.value)} placeholder="Describe, in plain language, what this robot should keep doing for you." />
      </label>

      <div className="rb-field">
        <span>When should it work?</span>
        <div className="rb-triggers">
          {TRIGGERS.map((t) => (
            <button key={t.id} className={`rb-trigger ${triggers.includes(t.id) ? 'on' : ''}`} onClick={() => toggleTrigger(t.id)}>
              <Icon name={t.icon} size={15} />
              <div>
                <div className="rb-trigger-label">{t.label}</div>
                <div className="rb-trigger-blurb">{t.blurb}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="rb-field">
        <span>How much can it do on its own?</span>
        <AutonomyDial value={autonomy} onChange={setAutonomy} />
      </div>

      <div className="rb-hire-actions">
        <button
          className="rb-cta"
          style={{ ['--accent' as any]: spec?.accent }}
          disabled={!mandate.trim()}
          onClick={() => {
            const r = hire({ role, name, mandate, autonomy, triggers });
            onDone(r.id);
          }}
        >
          Hire {name || spec?.name}
        </button>
        <button className="rb-cta ghost" onClick={onCancel}>
          Cancel
        </button>
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
  const [mandate, setMandate] = useState(robot.mandate);
  const dirty = mandate.trim() !== robot.mandate;
  const st = STATUS_META[robot.status];

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
          <div className="rb-office-role">{spec?.dept}</div>
        </div>
        <span className="rb-status big" style={{ ['--tone' as any]: st.tone }}>
          {st.label}
        </span>
      </div>

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
          <h3>Activity</h3>
          {robot.journal.length === 0 ? (
            <div className="rb-mini-empty">No activity yet — once {robot.name} runs, every step it takes and decision it makes will show here.</div>
          ) : (
            <ul className="rb-journal">
              {robot.journal.map((j) => (
                <li key={j.id}>
                  <span className="rb-journal-when">{new Date(j.at).toLocaleString()}</span>
                  {j.text}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rb-panel rb-span">
          <h3>Deliverables</h3>
          {robot.outputs.length === 0 ? (
            <div className="rb-mini-empty">Nothing delivered yet. Reports, sheets, apps and messages {robot.name} produces will collect here.</div>
          ) : (
            <ul className="rb-outputs">
              {robot.outputs.map((o) => (
                <li key={o.id}>
                  <span className="rb-out-kind">{o.kind}</span> {o.title}
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
