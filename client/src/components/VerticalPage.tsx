import { useState } from 'react';
import { api } from '../api/client';
import { DEPARTMENTS, ICONS, departmentById, type Department, type IconName } from '../lib/departments';

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

const STEPS = [
  { no: '01', title: 'Ask in plain words', body: 'Someone on the team describes the task — no brief template, no jargon.' },
  { no: '02', title: 'ArksAI does the work', body: 'It builds, runs the checks, and validates the output against what actually matters.' },
  { no: '03', title: 'Use it the same day', body: 'A finished result — ready to send, publish, file, or share.' },
];

// Per-vertical marketing copy. Slugs map to a department; hr → "people". Hero copy
// mirrors the server-side <title>/OG so a shared link and the page tell one story.
interface Vertical {
  slug: string;
  deptId: string;
  eyebrow: string;
  h1: React.ReactNode;
  lede: string;
}
const VERTICALS: Vertical[] = [
  {
    slug: 'marketing',
    deptId: 'marketing',
    eyebrow: 'AI for marketing teams · UAE',
    h1: (
      <>
        AI for your <em>marketing team.</em>
      </>
    ),
    lede: 'Conversion-focused landing pages built live, on-brand ad & social creatives with crisp real text and your logo, campaign briefs, content calendars and competitor research — finished, on-brand, and ready to publish. No designer or developer needed.',
  },
  {
    slug: 'sales',
    deptId: 'sales',
    eyebrow: 'AI for sales teams · UAE',
    h1: (
      <>
        AI for your <em>sales team.</em>
      </>
    ),
    lede: 'Pitch decks, pricing and proposals, case studies, battlecards, ROI models and account plans — finished, on-brand, and ready to send the same day. You describe the deal; ArksAI does the work.',
  },
  {
    slug: 'finance',
    deptId: 'finance',
    eyebrow: 'AI for finance & strategy · UAE',
    h1: (
      <>
        AI for your <em>finance team.</em>
      </>
    ),
    lede: 'Formula-driven financial models (DCF, ratios, variance, forecasts), KPI dashboards, board decks and investor updates — computed and verified, never hand-typed. Real numbers, board-ready.',
  },
  {
    slug: 'hr',
    deptId: 'people',
    eyebrow: 'AI for HR & people teams · UAE',
    h1: (
      <>
        AI for your <em>people team.</em>
      </>
    ),
    lede: 'Job descriptions, offer letters, policies and handbooks, onboarding portals and checklists, surveys and people dashboards — inclusive, compliant and ready to use, with no technical skills required.',
  },
  {
    slug: 'tax',
    deptId: 'tax',
    eyebrow: 'AI for UAE tax & compliance',
    h1: (
      <>
        UAE tax &amp; compliance, <em>done right.</em>
      </>
    ),
    lede: 'The exact documents each obligation requires — VAT 201 working papers + FAF, Corporate Tax (CT 300) computations, monthly WPS salary files (SIF), PINT AE e-invoicing XML and Excise returns. You review and submit through EmaraTax, your e-invoicing provider, or your WPS agent bank.',
  },
  {
    slug: 'legal',
    deptId: 'legal',
    eyebrow: 'AI for UAE legal teams',
    h1: (
      <>
        UAE legal drafting, <em>ready to sign.</em>
      </>
    ),
    lede: 'Contracts, NDAs, employment agreements, powers of attorney, corporate documents, notices and legal opinions — drafted to sign, bilingual in eloquent English and Modern Standard Arabic where the destination requires it, citing the relevant law.',
  },
];

export function verticalSlugs(): string[] {
  return VERTICALS.map((v) => v.slug);
}

export function VerticalPage({ slug, onSignIn }: { slug: string; onSignIn: () => void }) {
  const v = VERTICALS.find((x) => x.slug === slug);
  const dept: Department | undefined = v ? departmentById(v.deptId) : undefined;
  const [form, setForm] = useState({ email: '', company: '', role: '', team: dept?.name ?? '', note: '' });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  if (!v || !dept) {
    // Unknown vertical — send them home.
    if (typeof window !== 'undefined') window.location.href = '/';
    return null;
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await api.submitLead(form);
      setDone(true);
    } catch (err: any) {
      setError(err?.message ?? 'Something went wrong — please try again.');
    } finally {
      setBusy(false);
    }
  };
  const toForm = () => document.getElementById('get-access')?.scrollIntoView({ behavior: 'smooth' });
  const go = (href: string) => () => {
    window.history.pushState({}, '', href);
    window.location.href = href;
  };

  return (
    <div className="landing" style={{ ['--dept' as any]: dept.accent }}>
      <header className="lnd-nav">
        <button className="lp-mark" onClick={go('/')} style={{ background: 'none', border: 0, cursor: 'pointer' }}>
          <span className="logo-mark sm" /> ARKSAI · STUDIO
        </button>
        <div className="lnd-nav-actions">
          <button className="lnd-link" onClick={go('/')}>
            ← All teams
          </button>
          <button className="lnd-link" onClick={toForm}>
            Request access
          </button>
          <button className="lnd-signin" onClick={onSignIn}>
            Sign in
          </button>
        </div>
      </header>

      <section className="lnd-hero">
        <div className="lp-kicker" style={{ color: dept.accent }}>
          {v.eyebrow}
        </div>
        <h1 className="lnd-h1">{v.h1}</h1>
        <p className="lnd-lede">{v.lede}</p>
        <div className="lnd-cta">
          <button className="lnd-primary" onClick={toForm}>
            Request an invite →
          </button>
          <button className="lnd-secondary" onClick={onSignIn}>
            Sign in
          </button>
        </div>
        <p className="lnd-alpha-note">
          <strong>The biggest reason teams choose ArksAI:</strong> adopt AI without hiring or training a single
          AI-skilled person. Anyone on {dept.name.toLowerCase()} just describes the task.
        </p>
      </section>

      <section className="lnd-section lnd-uae" style={{ ['--dept' as any]: dept.accent }}>
        <div className="lp-kicker">What {dept.name} can ask for</div>
        <h2 className="lnd-h2">Everything this team does, finished for you.</h2>
        <div className="lnd-uae-grid">
          {dept.plays.map((p) => (
            <div key={p.key} className="lnd-uae-card">
              <span className="lnd-uae-ico">
                <Icon name={p.icon} size={18} />
              </span>
              <span className="lnd-uae-title">{p.title}</span>
              <span className="lnd-uae-blurb">{p.blurb}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="lnd-section">
        <div className="lp-kicker">How it works</div>
        <h2 className="lnd-h2">Ask once. Get it done.</h2>
        <div className="lnd-steps">
          {STEPS.map((s) => (
            <div key={s.no} className="lnd-step">
              <span className="lnd-step-no">{s.no}</span>
              <span className="lnd-step-title">{s.title}</span>
              <span className="lnd-step-body">{s.body}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="lnd-section lnd-getaccess" id="get-access">
        <div className="lnd-form-wrap">
          <div className="lnd-form-copy">
            <div className="lp-kicker">Request access</div>
            <h2 className="lnd-h2">Get an invite to the alpha.</h2>
            <p className="lnd-lede">
              Invitation-only while we’re in alpha. Tell us about your team — we review every request and send a
              link when there’s a fit.
            </p>
          </div>
          {done ? (
            <div className="lnd-thanks">
              <span className="cc-check">✓</span>
              <div>
                <strong>Thanks — your request is in.</strong>
                <p>We review every request personally. If it’s a fit, you’ll get an invite link by email.</p>
              </div>
            </div>
          ) : (
            <form className="lnd-form" onSubmit={submit}>
              <input type="email" placeholder="Work email" value={form.email} onChange={set('email')} required />
              <div className="lnd-form-row">
                <input type="text" placeholder="Company" value={form.company} onChange={set('company')} />
                <input type="text" placeholder="Your role" value={form.role} onChange={set('role')} />
              </div>
              <textarea
                placeholder={`What would your ${dept.name.toLowerCase()} team use it for first? (optional)`}
                value={form.note}
                onChange={set('note')}
              />
              {error && <div className="lnd-error">{error}</div>}
              <button className="lnd-primary" type="submit" disabled={busy || !form.email}>
                {busy ? 'Sending…' : 'Request an invite →'}
              </button>
            </form>
          )}
        </div>
      </section>

      <footer className="lnd-footer">
        <button className="lp-mark" onClick={go('/')} style={{ background: 'none', border: 0, cursor: 'pointer' }}>
          <span className="logo-mark sm" /> ARKSAI · STUDIO
        </button>
        <span className="lnd-foot-tag">AI, working across your business.</span>
        <div style={{ display: 'flex', gap: 16 }}>
          {DEPARTMENTS.filter((d) => verticalSlugs().includes(slugForDept(d.id)) && d.id !== dept.id)
            .slice(0, 4)
            .map((d) => (
              <button key={d.id} className="lnd-link" onClick={go(`/for/${slugForDept(d.id)}`)}>
                {d.name}
              </button>
            ))}
        </div>
      </footer>
    </div>
  );
}

/** Map a department id to its public marketing slug (people → hr). */
function slugForDept(deptId: string): string {
  const v = VERTICALS.find((x) => x.deptId === deptId);
  return v ? v.slug : deptId;
}
