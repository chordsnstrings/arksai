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

const go = (href: string) => () => {
  window.location.href = href;
};

// Real ARKS group companies — early adopters, named (no logos: arks.ae assets aren't public-fetchable).
const ADOPTERS = ['ARKS Groups Investments', 'Ecosine', 'Powerdrive', 'EGari'];

const STEPS = [
  { no: '01', title: 'Ask in plain words', body: 'Someone on the team describes the task — a VAT return, a board deck, a dashboard, an outreach kit.' },
  { no: '02', title: 'ArksAI does the work', body: 'It builds, runs the checks, and validates the output against what actually matters — so it’s right, not just done.' },
  { no: '03', title: 'Use it the same day', body: 'A finished result: a filing-ready document, a live tool, a polished report — no back-and-forth.' },
];

// A few concrete "watch it work" vignettes — the breadth of what ArksAI delivers, shown
// as small honest mock results (no invented metrics).
const DEMOS: { tag: string; accent: string; prompt: string; result: React.ReactNode }[] = [
  {
    tag: 'Email robot',
    accent: '#2f6f6a',
    prompt: '“Answer booking enquiries from our inbox.”',
    result: (
      <>
        <div className="lnd-mini-row"><span className="lnd-mini-dot" /> Read 4 new enquiries</div>
        <div className="lnd-mini-row"><span className="lnd-mini-dot" /> Drafted 4 replies · locked to sender</div>
        <div className="lnd-mini-pill">✓ Waiting in “Needs You” to approve &amp; send</div>
      </>
    ),
  },
  {
    tag: 'Finance',
    accent: '#1f6feb',
    prompt: '“Build a 3-year cash-flow model for the new branch.”',
    result: (
      <>
        <div className="lnd-mini-row"><span className="lnd-mini-dot" /> Assumptions tab · 32 drivers</div>
        <div className="lnd-mini-row"><span className="lnd-mini-dot" /> 468 live cross-sheet formulas</div>
        <div className="lnd-mini-pill">✓ Re-computes when you change an input</div>
      </>
    ),
  },
  {
    tag: 'Legal · UAE',
    accent: '#7a2e3b',
    prompt: '“Draft a notice before action for unpaid invoices.”',
    result: (
      <>
        <div className="lnd-mini-row"><span className="lnd-mini-dot" /> English + Modern Standard Arabic</div>
        <div className="lnd-mini-row"><span className="lnd-mini-dot" /> Cites the relevant Federal law</div>
        <div className="lnd-mini-pill">✓ Execution-ready for counsel to sign</div>
      </>
    ),
  },
  {
    tag: 'Marketing',
    accent: '#b8852a',
    prompt: '“A launch ad for our app — our teal, our logo.”',
    result: (
      <>
        <div className="lnd-mini-row"><span className="lnd-mini-dot" /> On-brand AI imagery, reserved space</div>
        <div className="lnd-mini-row"><span className="lnd-mini-dot" /> Crisp headline, CTA &amp; logo composited</div>
        <div className="lnd-mini-pill">✓ Finished PNG — not garbled AI text</div>
      </>
    ),
  },
];

const FOUNDING = [
  { icon: 'dollar-sign', title: 'One simple price', body: 'Full access to every team’s capabilities for one flat monthly price — no per-seat fees and no add-ons. Founding members come in at 39 AED/month while we’re in alpha.' },
  { icon: 'rocket', title: 'Shape what gets built', body: 'You get a direct line to the team. What founding members ask for is what we build next — you’re not a number in a queue.' },
  { icon: 'circle-check', title: 'No lock-in, ever', body: 'Invitation-only while we’re in alpha, but never a trap: cancel anytime, export your work anytime. We earn the renewal.' },
];

// A tight, objection-clearing FAQ. Deeper questions (per-team capability, compliance
// detail) live on /features so the landing stays focused on converting.
const FAQ = [
  {
    q: 'What is ArksAI, exactly?',
    a: 'An AI platform built for UAE businesses. Anyone on the team describes what they need in plain words and ArksAI does the work and hands back a finished, verified result — a live app, a dashboard, a report or deck, an on-brand image, an email reply, or a UAE-compliant filing. No technical skills required, and it works for every function.',
  },
  {
    q: 'How much does ArksAI cost?',
    a: 'Founding members get full access for a flat 39 AED per month while we’re in alpha, covering every team’s capabilities. It’s invitation-only; apply with your work email and we review every request personally.',
  },
  {
    q: 'Can AI handle UAE VAT, Corporate Tax and WPS?',
    a: 'Yes. ArksAI generates the exact, validated documents each obligation requires — VAT 201 working papers + FAF, the Corporate Tax (CT 300) computation, monthly WPS salary files (SIF), PINT AE e-invoicing XML, and Excise returns. You review and submit through EmaraTax, your e-invoicing provider, or your WPS agent bank — ArksAI doesn’t file on your behalf.',
  },
  {
    q: 'Do I need to be technical?',
    a: 'No — it’s an enabler, not a tool to learn. You describe what you need in plain language; ArksAI plans it, does the work, checks that it actually works, and hands back something finished and correct.',
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
  const [step, setStep] = useState<1 | 2>(1);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (busy || !emailOk) return;
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
          <button className="lnd-link" onClick={go('/features')}>
            Features
          </button>
          <button className="lnd-link" onClick={go('/research')}>
            Research
          </button>
          <span className="lnd-alpha-pill">Founding alpha · invite-only</span>
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
            Apply for founding access →
          </button>
          <button className="lnd-secondary" onClick={go('/features')}>
            See what it does
          </button>
        </div>
        <p className="lnd-alpha-note">
          <strong>Founding alpha — 39 AED/month, invitation-only.</strong> We’re onboarding a small founding cohort
          of UAE teams and review every application personally.
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

      <section className="lnd-section lnd-demos-sec">
        <div className="lp-kicker">See it work</div>
        <h2 className="lnd-h2">Four teams, four asks, four finished results.</h2>
        <p className="lnd-lede">
          One studio, speaking each function’s language. A sentence goes in; a verified, ready-to-use thing comes
          back — an app, a financial model, a bilingual legal draft, a finished ad.
        </p>
        <div className="lnd-demos">
          {DEMOS.map((d) => (
            <div key={d.tag} className="lnd-mini" style={{ ['--dept' as any]: d.accent }}>
              <div className="lnd-mini-tag">{d.tag}</div>
              <div className="lnd-mini-prompt">{d.prompt}</div>
              <div className="lnd-mini-result">{d.result}</div>
            </div>
          ))}
        </div>
        <div className="lnd-more-link">
          <button className="lnd-link" onClick={go('/features')}>
            See everything ArksAI does — for every team →
          </button>
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

      <section className="lnd-section lnd-founding" id="founding">
        <div className="lp-kicker">Founding membership</div>
        <h2 className="lnd-h2">Join the founding cohort.</h2>
        <p className="lnd-lede">
          We’re onboarding a small group of UAE teams who want to put AI to work across the whole business now —
          and help shape what it becomes. One honest price, no lock-in, a real say.
        </p>
        <div className="lnd-found-grid">
          {FOUNDING.map((f) => (
            <div key={f.title} className="lnd-found-card">
              <span className="lnd-found-ico">
                <Icon name={f.icon as IconName} size={20} />
              </span>
              <span className="lnd-found-title">{f.title}</span>
              <span className="lnd-found-body">{f.body}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="lnd-section lnd-getaccess" id="get-access">
        <div className="lnd-form-wrap">
          <div className="lnd-form-copy">
            <div className="lp-kicker">Apply for founding access</div>
            <h2 className="lnd-h2">Two quick steps. We’ll do the rest.</h2>
            <p className="lnd-lede">
              Invitation-only while we’re in alpha. Tell us where to send the invite and a little about your team —
              we review every application personally and send a link when there’s a fit.
            </p>
          </div>
          {done ? (
            <div className="lnd-thanks">
              <span className="cc-check">✓</span>
              <div>
                <strong>Thanks — your application is in.</strong>
                <p>We review every request personally. If it’s a fit, you’ll get a founding invite link by email — open it, set a password, and you’re in.</p>
              </div>
            </div>
          ) : (
            <form className="lnd-form" onSubmit={submit}>
              <div className="lnd-form-steps">
                <span className={`lnd-fstep ${step === 1 ? 'on' : 'done'}`}>1 · You</span>
                <span className="lnd-fstep-rule" />
                <span className={`lnd-fstep ${step === 2 ? 'on' : ''}`}>2 · Your team</span>
              </div>

              {step === 1 ? (
                <>
                  <input
                    type="email"
                    placeholder="Work email"
                    value={form.email}
                    onChange={set('email')}
                    required
                  />
                  <input type="text" placeholder="Company (optional)" value={form.company} onChange={set('company')} />
                  {error && <div className="lnd-error">{error}</div>}
                  <div className="lnd-form-actions">
                    <button
                      type="button"
                      className="lnd-primary"
                      disabled={!emailOk}
                      onClick={() => setStep(2)}
                    >
                      Continue →
                    </button>
                    <button type="submit" className="lnd-secondary" disabled={busy || !emailOk}>
                      {busy ? 'Sending…' : 'Just apply with email'}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="lnd-form-row">
                    <input type="text" placeholder="Your role" value={form.role} onChange={set('role')} />
                    <select aria-label="Which team" value={form.team} onChange={set('team')}>
                      <option value="">Which team?</option>
                      {DEPARTMENTS.map((d) => (
                        <option key={d.id} value={d.name}>
                          {d.name}
                        </option>
                      ))}
                      <option value="Multiple / Other">Multiple / Other</option>
                    </select>
                  </div>
                  <textarea
                    placeholder="What would your team use it for first? (optional)"
                    value={form.note}
                    onChange={set('note')}
                  />
                  {error && <div className="lnd-error">{error}</div>}
                  <div className="lnd-form-actions">
                    <button type="button" className="lnd-secondary" onClick={() => setStep(1)}>
                      ← Back
                    </button>
                    <button className="lnd-primary" type="submit" disabled={busy || !emailOk}>
                      {busy ? 'Sending…' : 'Submit application →'}
                    </button>
                  </div>
                </>
              )}
            </form>
          )}
        </div>
      </section>

      <section className="lnd-section lnd-founder">
        <div className="lnd-founder-card">
          <div className="lp-kicker">A note from us</div>
          <p className="lnd-founder-body">
            We built ArksAI in the UAE because we kept watching capable teams stall on the same wall: the work
            needed someone “technical,” and that person was always busy, expensive, or not there. So we didn’t
            build another chat box. We built a studio that does the work and checks its own output — a finished
            app, a board deck, a VAT file, a bilingual notice — and hands it back ready to use.
          </p>
          <p className="lnd-founder-body">
            It’s early, and we’d rather have a hundred founding members who push us than ten thousand who drift
            off. If that’s you, apply — and tell us what your team needs first. We read every one.
          </p>
          <div className="lnd-founder-sign">— The team behind ArksAI · Dubai</div>
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
        <div className="lnd-more-link">
          <button className="lnd-link" onClick={go('/features')}>
            More about what ArksAI does →
          </button>
        </div>
      </section>

      <footer className="lnd-footer">
        <span className="lp-mark">
          <span className="logo-mark sm" /> ARKSAI · STUDIO
        </span>
        <span className="lnd-foot-tag">AI, working across your business.</span>
        <div style={{ display: 'flex', gap: 16 }}>
          <button className="lnd-link" onClick={go('/features')}>
            Features
          </button>
          <button className="lnd-link" onClick={go('/research')}>
            Research
          </button>
          <button className="lnd-link" onClick={onSignIn}>
            Sign in
          </button>
        </div>
      </footer>
    </div>
  );
}
