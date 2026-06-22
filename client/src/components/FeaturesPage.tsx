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

interface Feature {
  icon: IconName;
  title: string;
  body: string;
}
interface Group {
  kicker: string;
  heading: string;
  lede: string;
  accent?: string;
  features: Feature[];
}

const GROUPS: Group[] = [
  {
    kicker: 'Build & ship',
    heading: 'Real software, built and verified — then live.',
    lede: 'Describe the tool; ArksAI builds it, boots it in a real browser, exercises every route, and publishes it to a shareable link. You never see a broken build.',
    features: [
      { icon: 'layout', title: 'Live web apps & sites', body: 'Booking pages, internal tools, microsites, portals — built responsive and on-brand, then booted and checked before you ever see them.' },
      { icon: 'bar-chart-3', title: 'Dashboards & analyses', body: 'Live KPI dashboards, cohort, variance and ad-hoc analyses — from your own numbers (pull a public CSV/JSON/Sheet), never invented.' },
      { icon: 'rocket', title: 'One-click publish', body: 'Every app is snapshotted, classified, and served at a public link — then smoke-tested on the live URL so you never share something broken.' },
      { icon: 'circle-check', title: 'A verification gate', body: 'Static checks, a real headless-browser boot, and an interaction pass (it fills forms and clicks buttons) hard-fail a broken build so it self-heals first.' },
    ],
  },
  {
    kicker: 'Design & document',
    heading: 'Magazine-grade documents, not templates.',
    lede: 'Every visual deliverable is rendered to an image, design-reviewed by a senior-director rubric, and revised until it looks right — automatically.',
    features: [
      { icon: 'presentation', title: 'Reports, decks & PDFs', body: 'Board-ready PDFs and 16:9 decks with real charts (dual-axis, heatmaps), embedded fonts and editorial covers — page-perfect, never bleeding.' },
      { icon: 'file-text', title: 'Editable .docx / .xlsx / .pptx', body: 'Typographic Word docs, formula-driven Excel models (live cross-sheet formulas, not typed-in numbers), and real editable PowerPoint.' },
      { icon: 'image', title: 'Ad & social creatives', body: 'A finished PNG/JPEG: on-brand AI imagery with pixel-crisp headline, sub, bullets, CTA and your logo composited on top — never garbled AI lettering.' },
      { icon: 'chart-pie', title: 'Real charts from real data', body: 'Server-rendered, editorial, flat 2D charts with direct value labels — built from your figures, design-checked for contrast and legibility.' },
    ],
  },
  {
    kicker: 'Automate & operate',
    heading: 'Work that runs without you.',
    lede: 'Beyond one-off builds — ArksAI keeps working. Autonomous email agents, recurring scheduled deliveries, live data in, and results pushed out.',
    accent: '#2f6f6a',
    features: [
      { icon: 'mail', title: 'Email robots', body: 'Give a robot its own mailbox and a mandate; it reads incoming mail and drafts (or, when certified, sends) replies — locked to the sender, injection-resistant, with a "Needs You" approval inbox.' },
      { icon: 'calendar', title: 'Scheduled deliveries', body: 'Recurring tasks — a Monday dashboard, a month-end pack — run on a durable server scheduler and land finished, with a "Delivered" badge.' },
      { icon: 'search', title: 'Live data in', body: 'Pull a public CSV, JSON, or published Google Sheet straight into a dashboard or report — credential-free and SSRF-guarded.' },
      { icon: 'target', title: 'Deliver out', body: 'Post results to a Slack, Discord or Zapier webhook so a finished deliverable lands where your team already works.' },
    ],
  },
  {
    kicker: 'Finance & strategy',
    heading: 'Models that actually compute.',
    lede: 'FP&A rigor baked in. Finance gets formula-driven models that are computed and verified — a workbook of hand-typed numbers is rejected and rebuilt.',
    accent: '#1f6feb',
    features: [
      { icon: 'dollar-sign', title: 'Formula-driven models', body: 'DCF, three-statement, ratios, variance and forecasts with live cross-sheet formulas and a real Assumptions/Drivers tab — change an input, the model recomputes.' },
      { icon: 'trending-up', title: 'Board decks & investor updates', body: 'Magazine-grade board packs and updates with real charts, reconciled numbers, and an insight-led narrative — not a wall of tables.' },
      { icon: 'bar-chart-3', title: 'KPI dashboards', body: 'Live finance dashboards (5–7 KPIs, F-pattern layout) from your own data, with the analysis done first so the numbers reconcile.' },
      { icon: 'wallet', title: 'Budgets & scenarios', body: 'Budgets, cash-flow models and scenario analysis — structured the way an FP&A lead would build them, validated on re-open.' },
    ],
  },
  {
    kicker: 'UAE compliance',
    heading: 'The exact documents the FTA & MOHRE expect.',
    lede: 'Built for the UAE regime. ArksAI produces the precise, validated filing artifacts each obligation requires — you review and submit through the official channel.',
    accent: '#b8852a',
    features: [
      { icon: 'landmark', title: 'VAT 201 + FAF', body: 'VAT 201 working papers and the FTA Audit File — computed from your transactions, validated against the schema before you submit via EmaraTax.' },
      { icon: 'file-text', title: 'Corporate Tax (CT 300)', body: 'The CT 300 computation with the adjustments and disclosures, structured for review and submission — ArksAI prepares, you file.' },
      { icon: 'users', title: 'WPS payroll (SIF)', body: 'Monthly WPS salary files (SIF) in the agent-bank format, reconciled to your payroll — ready to lodge through your WPS agent bank.' },
      { icon: 'file-text', title: 'PINT AE e-invoicing & Excise', body: 'PINT AE-conformant e-invoicing XML and Excise returns — the exact artifacts, validated, for your accredited provider.' },
    ],
  },
  {
    kicker: 'UAE legal',
    heading: 'Drafted to sign — bilingual where it counts.',
    lede: 'UAE legal practice baked in: jurisdiction-first, citing the relevant law, execution-ready, and bilingual in eloquent Modern Standard Arabic where the destination requires it.',
    accent: '#7a2e3b',
    features: [
      { icon: 'scale', title: 'Contracts & corporate documents', body: 'Contracts, NDAs, employment agreements, powers of attorney, MOAs/SHAs and resolutions — full clauses, schedules and signature blocks, ready for counsel to sign off.' },
      { icon: 'file-text', title: 'Notices, opinions & memos', body: 'Letters before action, legal opinions and memos that cite the article and law (e.g. Federal Decree-Laws) — never fabricated, formal British-English register.' },
      { icon: 'circle-check', title: 'Bilingual by destination', body: 'Government, court and notary submissions come in eloquent English + native Modern Standard Arabic (not a literal translation); internal docs stay in your language.' },
      { icon: 'search', title: 'Review & compliance', body: 'Contract review, compliance audits, dispute briefs and a legal calendar — the everyday work of an in-house team, with a mandatory lawyer sign-off footer.' },
    ],
  },
];

export function FeaturesPage({ onSignIn }: { onSignIn: () => void }) {
  return (
    <div className="landing features">
      <header className="lnd-nav">
        <button className="lp-mark" onClick={go('/')} style={{ background: 'none', border: 0, cursor: 'pointer' }}>
          <span className="logo-mark sm" /> ARKSAI · STUDIO
        </button>
        <div className="lnd-nav-actions">
          <button className="lnd-link" onClick={go('/research')}>
            Research
          </button>
          <button className="lnd-link" onClick={go('/#get-access')}>
            Request access
          </button>
          <button className="lnd-signin" onClick={onSignIn}>
            Sign in
          </button>
        </div>
      </header>

      <section className="lnd-hero">
        <div className="lp-kicker">What ArksAI can do</div>
        <h1 className="lnd-h1">
          One studio. <em>Every deliverable your company needs.</em>
        </h1>
        <p className="lnd-lede">
          ArksAI isn’t a chatbot that gives you answers — it does the work and hands back a finished, verified thing.
          Apps and dashboards, designed reports and decks, on-brand creatives, real spreadsheets and documents,
          autonomous email agents, and the exact UAE-compliant filings. Here’s the whole surface.
        </p>
        <div className="lnd-cta">
          <button className="lnd-primary" onClick={go('/#get-access')}>
            Apply for founding access →
          </button>
          <button className="lnd-secondary" onClick={go('/research')}>
            Read the research
          </button>
        </div>
      </section>

      {GROUPS.map((g) => (
        <section key={g.kicker} className="lnd-section feat-group" style={g.accent ? ({ ['--dept' as any]: g.accent }) : undefined}>
          <div className="lp-kicker" style={g.accent ? { color: g.accent } : undefined}>
            {g.kicker}
          </div>
          <h2 className="lnd-h2">{g.heading}</h2>
          <p className="lnd-lede">{g.lede}</p>
          <div className="lnd-caps feat-caps">
            {g.features.map((f) => (
              <div key={f.title} className="lnd-cap">
                <span className="lnd-cap-ico">
                  <Icon name={f.icon} size={20} />
                </span>
                <span className="lnd-cap-title">{f.title}</span>
                <span className="lnd-cap-body">{f.body}</span>
              </div>
            ))}
          </div>
        </section>
      ))}

      <section className="lnd-section feat-quality">
        <div className="lp-kicker">Why the quality is reliable</div>
        <h2 className="lnd-h2">The system does the iterating, so you don’t.</h2>
        <p className="lnd-lede">
          Quality doesn’t come from your prompting — it comes from an opinionated design engine and a gating
          internal review loop. Every visual deliverable is rendered to an image and judged by a senior-design
          rubric (legibility, WCAG contrast, mobile, composition), every app is booted and exercised, and anything
          short of the bar is revised automatically before it reaches you.
        </p>
      </section>

      <section className="lnd-section">
        <div className="lp-kicker">Every team, every day</div>
        <h2 className="lnd-h2">One studio that speaks each function’s language.</h2>
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

      <section className="lnd-section lnd-getaccess feat-cta">
        <div className="lnd-form-copy" style={{ textAlign: 'center', margin: '0 auto' }}>
          <div className="lp-kicker">Founding access</div>
          <h2 className="lnd-h2">Give every team this, today.</h2>
          <p className="lnd-lede">
            ArksAI Studio is in alpha. Founding members get full access for a flat 39 AED/month and help shape what
            gets built next.
          </p>
          <button className="lnd-primary" onClick={go('/#get-access')} style={{ marginTop: 6 }}>
            Apply for founding access →
          </button>
        </div>
      </section>

      <footer className="lnd-footer">
        <button className="lp-mark" onClick={go('/')} style={{ background: 'none', border: 0, cursor: 'pointer' }}>
          <span className="logo-mark sm" /> ARKSAI · STUDIO
        </button>
        <span className="lnd-foot-tag">AI, working across your business.</span>
        <div style={{ display: 'flex', gap: 16 }}>
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
