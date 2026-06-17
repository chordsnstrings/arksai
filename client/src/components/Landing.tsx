import { useState } from 'react';
import { api } from '../api/client';
import { DEPARTMENTS, ICONS, departmentById, type IconName } from '../lib/departments';

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

// Real ARKS group companies — early adopters, named (no logos: arks.ae assets aren't public-fetchable).
const ADOPTERS = ['ARKS Groups Investments', 'Ecosine', 'Powerdrive', 'EGari'];

const STEPS = [
  { no: '01', title: 'Ask in plain words', body: 'Someone on the team describes the task — a VAT return, a board deck, a dashboard, an outreach kit.' },
  { no: '02', title: 'ArksAI does the work', body: 'It builds, runs the checks, and validates the output against what actually matters — so it’s right, not just done.' },
  { no: '03', title: 'Use it the same day', body: 'A finished result: a filing-ready document, a live tool, a polished report — no back-and-forth.' },
];

// What ArksAI makes — the output types + UAE specialties (excludes internal/admin tooling).
const CAPABILITIES: { icon: IconName; title: string; body: string }[] = [
  { icon: 'layout', title: 'Live apps & sites', body: 'Booking pages, internal tools, microsites — built, verified, and published to a live link you can share.' },
  { icon: 'bar-chart-3', title: 'Dashboards & analyses', body: 'Live KPI dashboards, cohort and ad-hoc analyses — from your own numbers, never invented.' },
  { icon: 'presentation', title: 'Reports & decks', body: 'Board-ready PDFs and 16:9 decks — genuinely designed, with real charts, not templates.' },
  { icon: 'image', title: 'Ad & social creatives', body: 'On-brand images with crisp, perfectly-legible text and your logo — not garbled AI lettering.' },
  { icon: 'landmark', title: 'UAE compliance', body: 'VAT 201 + FAF, Corporate Tax (CT 300), WPS payroll files, PINT AE e-invoicing, Excise — exact and validated.' },
  { icon: 'scale', title: 'UAE legal drafting', body: 'Contracts, notices and legal opinions — bilingual English + Arabic, execution-ready for your counsel to sign off.' },
];

const FAQ = [
  {
    q: 'What is the best AI for UAE businesses?',
    a: 'ArksAI is an AI platform built for UAE businesses. Anyone on the team describes what they need in plain words and ArksAI does the work and hands back a finished, verified result — a live app, a dashboard, a report or deck, an on-brand image, or a UAE-compliant filing document. No technical skills required, and it works for every function.',
  },
  {
    q: 'Can AI handle UAE VAT, Corporate Tax and WPS?',
    a: 'Yes. ArksAI generates the exact, validated documents each obligation requires — VAT 201 working papers plus the FAF, the Corporate Tax (CT 300) computation, monthly WPS salary files (SIF), PINT AE e-invoicing XML, and Excise returns. You review and submit them through EmaraTax, your accredited e-invoicing provider, or your WPS agent bank — ArksAI doesn’t file on your behalf.',
  },
  {
    q: 'What can AI do for a marketing team in the UAE?',
    a: 'ArksAI builds conversion-focused landing pages, generates on-brand ad and social creatives (real AI imagery with crisp text and your logo), writes campaign briefs and content calendars, and runs competitor and audience research — all on-brand and ready to publish.',
  },
  {
    q: 'Is this a no-code builder? Do I need to be technical?',
    a: 'No — it’s an enabler, not a tool to learn. You describe what you need in plain language; ArksAI plans it, does the work, checks that it actually works, and hands back something finished and correct.',
  },
  {
    q: 'Which teams is it for?',
    a: 'Every function — Finance & Tax, Marketing, Sales, HR & Ops, Engineering, BI & Analytics, and Legal (UAE). Each team gets ArksAI set up with its own skills and language; no technical people required.',
  },
  {
    q: 'How do we get access?',
    a: 'ArksAI Studio is currently in alpha and invitation-only. Leave your work email below — we review every request personally and send an invite link when there’s a fit.',
  },
];

/** A looping "watch it build" mock in the hero — a brief becomes a finished, live
 *  result, so a first-time visitor SEES the product work before giving an email.
 *  Pure CSS (one synced 11s timeline); collapses to the finished card if the user
 *  prefers reduced motion. */
function LandingDemo() {
  return (
    <div className="lnd-demo" aria-hidden="true">
      <div className="lnd-demo-bar">
        <span className="d-dot" />
        <span className="d-dot" />
        <span className="d-dot" />
        <span className="lnd-demo-title">ArksAI · Studio</span>
      </div>
      <div className="lnd-demo-body">
        <div className="lnd-demo-prompt">
          “Build a booking page for our limo service”<span className="d-caret" />
        </div>
        <div className="lnd-demo-work">
          <span className="d-line"><span className="d-spin" /> Reading your brand colours…</span>
          <span className="d-line"><span className="d-spin" /> Designing the hero…</span>
          <span className="d-line"><span className="d-spin" /> Testing the booking form…</span>
        </div>
        <div className="lnd-demo-result">
          <div className="d-card">
            <div className="d-card-kicker">Dubai · Electric Chauffeur</div>
            <div className="d-card-hero">
              Silent arrivals, <em>measured in moments.</em>
            </div>
            <div className="d-card-cta">Book a transfer →</div>
          </div>
          <div className="d-ready">✓ Built, verified &amp; live</div>
        </div>
      </div>
    </div>
  );
}

export function Landing({ onSignIn }: { onSignIn: () => void }) {
  const [form, setForm] = useState({ email: '', company: '', role: '', team: '', note: '' });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const tax = departmentById('tax');
  const otherDepts = DEPARTMENTS.filter((d) => d.id !== 'tax');

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
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

  return (
    <div className="landing">
      <header className="lnd-nav">
        <span className="lp-mark">
          <span className="logo-mark sm" /> ARKSAI · STUDIO
        </span>
        <div className="lnd-nav-actions">
          <span className="lnd-alpha-pill">Alpha · invite-only</span>
          <button className="lnd-link" onClick={toForm}>
            Request access
          </button>
          <button className="lnd-signin" onClick={onSignIn}>
            Sign in
          </button>
        </div>
      </header>

      <section className="lnd-hero">
        <div className="lp-kicker">AI for UAE businesses</div>
        <h1 className="lnd-h1">
          The AI that <em>empowers your business.</em>
        </h1>
        <p className="lnd-lede">
          ArksAI brings AI into the everyday work of every team in your UAE company — Finance, Marketing, Sales,
          HR, and Legal. Describe what you need in plain words; ArksAI plans it, builds it, checks that it works,
          and hands back something finished and correct. Not a tool to learn — a teammate that delivers.
        </p>
        <div className="lnd-cta">
          <button className="lnd-primary" onClick={toForm}>
            Request an invite →
          </button>
          <button className="lnd-secondary" onClick={onSignIn}>
            Sign in
          </button>
        </div>
        <p className="lnd-alpha-note">
          <strong>Currently in alpha — invitation-only.</strong> We’re onboarding a small set of UAE teams and
          review every request personally.
        </p>
        <LandingDemo />
      </section>

      <section className="lnd-adopters">
        <span className="lnd-adopters-label">Already in use across the ARKS group of companies</span>
        <div className="lnd-adopters-row">
          {ADOPTERS.map((name) => (
            <span key={name} className="lnd-adopter">
              {name}
            </span>
          ))}
        </div>
      </section>

      <section className="lnd-section">
        <div className="lp-kicker">What it makes</div>
        <h2 className="lnd-h2">One sentence in. A finished thing out.</h2>
        <p className="lnd-lede">
          ArksAI reads what you ask and brings the right skill to bear — it builds, designs, analyses, writes, or
          generates, then verifies the result before you ever see it. For anything to build, it shows you the plan
          first and waits for your go-ahead.
        </p>
        <div className="lnd-caps">
          {CAPABILITIES.map((c) => (
            <div key={c.title} className="lnd-cap">
              <span className="lnd-cap-ico">
                <Icon name={c.icon} size={20} />
              </span>
              <span className="lnd-cap-title">{c.title}</span>
              <span className="lnd-cap-body">{c.body}</span>
            </div>
          ))}
        </div>
      </section>

      {tax && (
        <section className="lnd-section lnd-uae" style={{ ['--dept' as any]: tax.accent }}>
          <div className="lp-kicker">Built for the UAE</div>
          <h2 className="lnd-h2">Compliance the FTA &amp; MOHRE actually accept.</h2>
          <p className="lnd-lede">
            The hard part of a UAE business is the detail. ArksAI generates the exact, validated filing
            documents each obligation requires — you submit them through EmaraTax, your accredited e-invoicing
            provider, or your WPS agent bank.
          </p>
          <div className="lnd-uae-grid">
            {tax.plays.map((p) => (
              <div key={p.key} className="lnd-uae-card">
                <span className="lnd-uae-ico">
                  <Icon name={p.icon} size={18} />
                </span>
                <span className="lnd-uae-title">{p.title}</span>
                <span className="lnd-uae-blurb">{p.blurb}</span>
              </div>
            ))}
          </div>
          <p className="lnd-fineprint">
            Working papers for professional review — ArksAI doesn’t file or pay on your behalf. Validate against
            the official schema before submission.
          </p>
        </section>
      )}

      <section className="lnd-section">
        <div className="lp-kicker">Every team, every day</div>
        <h2 className="lnd-h2">One studio that speaks each function’s language.</h2>
        <div className="lnd-depts">
          {otherDepts.map((d) => (
            <div key={d.id} className="lnd-dept" style={{ ['--dept' as any]: d.accent }}>
              <div className="lnd-dept-head">
                <span className="lnd-dept-ico">
                  <Icon name={d.icon} size={20} />
                </span>
                <span className="lnd-dept-name">{d.name}</span>
              </div>
              <ul className="lnd-dept-list">
                {d.plays.slice(0, 5).map((p) => (
                  <li key={p.title}>
                    <Icon name={p.icon} size={14} /> {p.title}
                  </li>
                ))}
                {d.plays.length > 5 && <li className="lnd-dept-more">+{d.plays.length - 5} more</li>}
              </ul>
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
                <p>We review every request personally. If it’s a fit, you’ll get an invite link by email — open it, set a password, and you’re in.</p>
              </div>
            </div>
          ) : (
            <form className="lnd-form" onSubmit={submit}>
              <input type="email" placeholder="Work email" value={form.email} onChange={set('email')} required />
              <div className="lnd-form-row">
                <input type="text" placeholder="Company" value={form.company} onChange={set('company')} />
                <input type="text" placeholder="Your role" value={form.role} onChange={set('role')} />
              </div>
              <select aria-label="Which team" value={form.team} onChange={set('team')}>
                <option value="">Which team? (optional)</option>
                {DEPARTMENTS.map((d) => (
                  <option key={d.id} value={d.name}>
                    {d.name}
                  </option>
                ))}
                <option value="Multiple / Other">Multiple / Other</option>
              </select>
              <textarea placeholder="What would your team use it for first? (optional)" value={form.note} onChange={set('note')} />
              {error && <div className="lnd-error">{error}</div>}
              <button className="lnd-primary" type="submit" disabled={busy || !form.email}>
                {busy ? 'Sending…' : 'Request an invite →'}
              </button>
            </form>
          )}
        </div>
      </section>

      <section className="lnd-section">
        <div className="lp-kicker">Questions</div>
        <div className="lnd-faq">
          {FAQ.map((f) => (
            <div key={f.q} className="lnd-faq-item">
              <div className="lnd-faq-q">{f.q}</div>
              <div className="lnd-faq-a">{f.a}</div>
            </div>
          ))}
        </div>
      </section>

      <footer className="lnd-footer">
        <span className="lp-mark">
          <span className="logo-mark sm" /> ARKSAI · STUDIO
        </span>
        <span className="lnd-foot-tag">AI, working across your business.</span>
        <button className="lnd-link" onClick={onSignIn}>
          Sign in
        </button>
      </footer>
    </div>
  );
}
