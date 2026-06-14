import { useState } from 'react';
import { api } from '../api/client';
import { DEPARTMENTS, ICONS, type IconName } from '../lib/departments';

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
  { no: '01', title: 'Describe it', body: 'A teammate says what they need in plain language — a deck, a dashboard, a report.' },
  { no: '02', title: 'It builds & verifies', body: 'ArksAI designs it, runs the checks, and exercises it like a real user — so it actually works.' },
  { no: '03', title: 'Ship it', body: 'A finished artifact: a live URL, a polished PDF, a validated spreadsheet — ready to use.' },
];

const FORMATS = ['Web apps & internal tools', 'Pitch & board decks', 'Dashboards', 'Designed PDF reports', 'Spreadsheets', 'Word documents'];

const FAQ = [
  {
    q: 'Who is it for?',
    a: 'Every team in your company — Marketing, Sales, Finance, HR & Ops — not just engineers. Each function gets a starting point in its own language.',
  },
  {
    q: 'Do we need technical people?',
    a: 'No. People describe what they need; ArksAI builds, verifies, and ships it. The work stays visible so you can see the craft, but no one has to write code.',
  },
  {
    q: 'What can it actually produce?',
    a: 'Real, finished artifacts: live web apps and internal tools, presentation-grade decks and PDF reports, dashboards, formatted spreadsheets, and editable documents.',
  },
  {
    q: 'How do we get started?',
    a: 'Leave your details below and we’ll get your company set up. We’re onboarding teams now.',
  },
];

export function Landing({ onSignIn }: { onSignIn: () => void }) {
  const [form, setForm] = useState({ email: '', company: '', role: '', team: '', note: '' });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

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
          <button className="lnd-link" onClick={toForm}>
            Get access
          </button>
          <button className="lnd-signin" onClick={onSignIn}>
            Sign in
          </button>
        </div>
      </header>

      <section className="lnd-hero">
        <div className="lp-kicker">For every team in your company</div>
        <h1 className="lnd-h1">
          Give every team <em>a builder.</em>
        </h1>
        <p className="lnd-lede">
          ArksAI turns a sentence into a finished thing — a live app, a board deck, a dashboard, a report —
          built and verified for you. One studio, organized around the way your company actually works.
        </p>
        <div className="lnd-cta">
          <button className="lnd-primary" onClick={toForm}>
            Bring it to your team →
          </button>
          <button className="lnd-secondary" onClick={onSignIn}>
            Sign in
          </button>
        </div>
      </section>

      <section className="lnd-section">
        <div className="lp-kicker">What each team ships</div>
        <h2 className="lnd-h2">A studio that speaks your function’s language.</h2>
        <div className="lnd-depts">
          {DEPARTMENTS.map((d) => (
            <div key={d.id} className="lnd-dept" style={{ ['--dept' as any]: d.accent }}>
              <div className="lnd-dept-head">
                <span className="lnd-dept-ico">
                  <Icon name={d.icon} size={20} />
                </span>
                <span className="lnd-dept-name">{d.name}</span>
              </div>
              <ul className="lnd-dept-list">
                {d.plays.map((p) => (
                  <li key={p.title}>
                    <Icon name={p.icon} size={14} /> {p.title}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className="lnd-section">
        <div className="lp-kicker">How it works</div>
        <h2 className="lnd-h2">Describe it once. Get one finished thing.</h2>
        <div className="lnd-steps">
          {STEPS.map((s) => (
            <div key={s.no} className="lnd-step">
              <span className="lnd-step-no">{s.no}</span>
              <span className="lnd-step-title">{s.title}</span>
              <span className="lnd-step-body">{s.body}</span>
            </div>
          ))}
        </div>
        <div className="lnd-formats">
          <span className="lnd-formats-label">One studio, every format —</span>
          {FORMATS.map((f) => (
            <span key={f} className="lnd-chip">
              {f}
            </span>
          ))}
        </div>
      </section>

      <section className="lnd-section lnd-getaccess" id="get-access">
        <div className="lnd-form-wrap">
          <div className="lnd-form-copy">
            <div className="lp-kicker">Get started</div>
            <h2 className="lnd-h2">Bring ArksAI to your company.</h2>
            <p className="lnd-lede">We’re onboarding teams now. Tell us a little about you and we’ll set you up.</p>
          </div>
          {done ? (
            <div className="lnd-thanks">
              <span className="cc-check">✓</span>
              <div>
                <strong>Thanks — you’re on the list.</strong>
                <p>We’ll be in touch shortly to get your team set up.</p>
              </div>
            </div>
          ) : (
            <form className="lnd-form" onSubmit={submit}>
              <input type="email" placeholder="Work email" value={form.email} onChange={set('email')} required />
              <div className="lnd-form-row">
                <input type="text" placeholder="Company" value={form.company} onChange={set('company')} />
                <input type="text" placeholder="Your role" value={form.role} onChange={set('role')} />
              </div>
              <select value={form.team} onChange={set('team')}>
                <option value="">Which team? (optional)</option>
                {DEPARTMENTS.map((d) => (
                  <option key={d.id} value={d.name}>
                    {d.name}
                  </option>
                ))}
                <option value="Multiple / Other">Multiple / Other</option>
              </select>
              <textarea placeholder="What would your team build first? (optional)" value={form.note} onChange={set('note')} />
              {error && <div className="lnd-error">{error}</div>}
              <button className="lnd-primary" type="submit" disabled={busy || !form.email}>
                {busy ? 'Sending…' : 'Request access →'}
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
        <span className="lnd-foot-tag">A builder for every team.</span>
        <button className="lnd-link" onClick={onSignIn}>
          Sign in
        </button>
      </footer>
    </div>
  );
}
