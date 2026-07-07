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
    accent: '#1c6b64',
    features: [
      { icon: 'layout', title: 'Live web apps & sites', body: 'Booking pages, internal tools, microsites, portals — built responsive and on-brand, booted in a real browser and checked at phone and desktop widths before you ever see them.' },
      { icon: 'code', title: 'Full-stack apps + a real database', body: 'One deployable service with a wired API and SQLite (or an isolated Postgres) — CRUD, multi-tenant orgs, public forms, uploads, realtime and background jobs from proven modules.' },
      { icon: 'dollar-sign', title: 'Payments, keys pasted in-app', body: 'Stripe, PayPal and four UAE rails (Ziina, Telr, N-Genius, Binance Pay crypto) with Apple & Google Pay free — server-verified so a client can never mark itself paid.' },
      { icon: 'rocket', title: 'Android apps + installable PWAs', body: 'Native APKs built on our own infra, or make any site installable and offline — published to a public link and smoke-tested on the live URL before it reaches you.' },
    ],
  },
  {
    kicker: 'Design & document',
    heading: 'Magazine-grade documents and a design studio.',
    lede: 'Every visual deliverable is rendered to an image, design-reviewed by a senior-director rubric, and revised until it looks right — automatically.',
    accent: '#6b4a9e',
    features: [
      { icon: 'presentation', title: 'Reports, decks & PDFs', body: 'Board-ready PDFs and 16:9 decks with real charts (dual-axis, heatmaps), embedded fonts and editorial covers — page-perfect, never bleeding.' },
      { icon: 'file-text', title: 'Editable .docx / .xlsx / .pptx', body: 'Typographic Word docs (bilingual Arabic set right-to-left), formula-driven Excel models with live cross-sheet formulas, and real editable PowerPoint.' },
      { icon: 'pen-tool', title: 'A design studio', body: 'Websites, landing pages, clickable prototypes, lo-fi wireframes, one-pagers and animations — art-directed from a bespoke concept grounded in your brand, never a template.' },
      { icon: 'chart-pie', title: 'Real charts from real data', body: 'Server-rendered, editorial, flat 2D charts with direct value labels — built from your figures, design-checked for contrast and legibility.' },
    ],
  },
  {
    kicker: 'Data & business intelligence',
    heading: 'Numbers that tie out.',
    lede: 'A full BI toolkit where the model only picks the files and columns — every row is handled by a deterministic engine, and the proof ships inside the workbook.',
    accent: '#2f5aa8',
    features: [
      { icon: 'bar-chart-3', title: 'Live dashboards & analyses', body: 'KPI dashboards, cohort, variance and ad-hoc analysis from your own numbers (pull a public CSV/JSON/Sheet) — computed and reconciled, never invented.' },
      { icon: 'circle-check', title: 'Combine & reconcile files', body: 'Merge many bank/expense exports into one clean workbook, or reconcile two exports row-by-row (matched, mismatched with the delta, only-in-one) with a live audit proof.' },
      { icon: 'trending-up', title: 'Variance & recurring memory', body: '"Why did revenue drop?" decomposed by dimension with driver commentary; recurring reports remember last period and surface restatements instead of overwriting them.' },
      { icon: 'search', title: 'Query huge workbooks with SQL', body: 'Load every tab into a database and run SQL across them (joins, pivots, reconciliation) returning only the answer — it scales to many-tab files without paging cells into the chat.' },
    ],
  },
  {
    kicker: 'Video & motion',
    heading: 'From a sentence to a finished film.',
    lede: 'Cinematic AI video, narrated motion-graphic explainers, and multi-scene story films — with music, all delivered as playable clips.',
    accent: '#b23a2b',
    features: [
      { icon: 'megaphone', title: 'AI video (draft → final)', body: 'A cheap draft you approve before the final renders; real people animate and lip-sync a line, product photos become commercials, up to 4K with synced audio.' },
      { icon: 'presentation', title: 'Narrated explainers', body: 'Motion-graphic videos built from vector scenes in five signature styles — script, narration, animation, QC and a music bed, at pennies per video and any length.' },
      { icon: 'image', title: 'Multi-scene story films', body: 'Describe a sequence once; ArksAI keeps continuity across shots, holds one look with a style anchor, and stitches a single film — retake any scene.' },
      { icon: 'pen-tool', title: 'Original music', body: 'Tracks via Suno — auto from a description, or custom with a rich style field and structured lyrics, mixed under a video as a ducked bed.' },
    ],
  },
  {
    kicker: 'Marketing & brand',
    heading: 'Finished creative, on brand.',
    lede: 'Ready-to-post ad and social creative with crisp composited text, complete logo identities, and live ad-platform data — all grounded in the real brand.',
    accent: '#b45a24',
    features: [
      { icon: 'image', title: 'Finished ad & social creatives', body: 'On-brand AI imagery with pixel-crisp headline, sub, bullets, CTA and your logo composited on top — never garbled AI lettering — at every channel size.' },
      { icon: 'target', title: 'A/B hook variants in one call', body: 'Alternate headlines composited on the same background for one image cost — each written from a proven hook archetype to test against each other.' },
      { icon: 'pen-tool', title: 'Logo & brand identity', body: 'A complete brand mark (letters real type, symbols built from geometric primitives), light & dark variants, app-icon / favicon / navbar placements and a zipped asset kit.' },
      { icon: 'bar-chart-3', title: 'Live ad-platform data', body: 'Connect Meta, Google Ads and TikTok; pull live spend, clicks and conversions straight into dashboards and reports — tokens encrypted, never shown to the model.' },
    ],
  },
  {
    kicker: 'Robots & automation',
    heading: 'Work that runs without you.',
    lede: 'Standing agents that answer customers across channels, build and deliver on command, and run on a schedule — checking in only when they need a decision.',
    accent: '#2c7a4f',
    features: [
      { icon: 'mail', title: 'Multichannel robots', body: 'The same brain answers on email, Telegram, WhatsApp and SMS — grounded in its knowledge, escalating rather than guessing, always locked to the person who wrote in. It reads photos and files and listens to voice notes.' },
      { icon: 'rocket', title: 'Text it → it builds → it delivers', body: 'From your own address, ask a robot to build something and send it to a named recipient — it spawns a full build session and delivers the result on the channel.' },
      { icon: 'calendar', title: 'Routines & live lookups', body: 'Scheduled digests and recurring builds; real iCal meeting-invite replies; gated HTTPS actions (an order-status API) answered mid-reply — admin-defined and audit-logged.' },
      { icon: 'target', title: 'Scheduled deliveries + webhooks', body: 'Recurring tasks run on a durable server scheduler and land finished; results post to a Slack, Discord or Zapier webhook where your team already works.' },
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
  {
    kicker: 'Your workspace',
    heading: 'Multi-tenant, private, accountable.',
    lede: 'Isolated company workspaces, per-user connections to your own tools, a prepaid wallet with an invoice ledger, and metadata-only analytics — everyone sees only their own data.',
    accent: '#3f5566',
    features: [
      { icon: 'users', title: 'Isolated team workspaces', body: 'Every session, project and published app is scoped to your org; roles, invite-only onboarding, and everyone — including us — sees only their own workspace’s data.' },
      { icon: 'git-branch', title: 'Connect your own tools', body: 'Per-user GitHub (push generated code to your repo, or open a pull request) and Google (Gmail, Calendar, Drive/Sheets, Ads) — tokens encrypted, never shown to the model.' },
      { icon: 'wallet', title: 'Wallet & invoicing', body: 'A prepaid balance debited per run into an append-only ledger that doubles as your statement — shown in your currency, exportable to CSV, with no drift.' },
      { icon: 'bar-chart-3', title: 'Analytics, metadata only', body: 'Engagement, adoption, retention and cost dashboards for your team — they never touch your message or document content.' },
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
        <div className="lp-kicker">What the workers do</div>
        <h1 className="lnd-h1">
          One workforce. <em>Every deliverable your business needs.</em>
        </h1>
        <p className="lnd-lede">
          Your AI workers don’t just answer — they do the work and hand back a finished, verified thing.
          Apps and dashboards, designed reports and decks, videos and on-brand creatives, real spreadsheets and BI,
          autonomous replies across every channel, and the exact UAE-compliant filings. Here’s the whole surface.
        </p>
        <div className="lnd-cta">
          <button className="lnd-primary" onClick={go('/#get-access')}>
            Join the waitlist →
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
        <h2 className="lnd-h2">One workforce, with a role for each function.</h2>
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
          <div className="lp-kicker">Early access</div>
          <h2 className="lnd-h2">Give every team this.</h2>
          <p className="lnd-lede">
            ArksAI Studio is in a private, invitation-only alpha. Join the waitlist with your work email and we
            review every request personally — if it’s a fit, we send an invite link.
          </p>
          <button className="lnd-primary" onClick={go('/#get-access')} style={{ marginTop: 6 }}>
            Join the waitlist →
          </button>
        </div>
      </section>

      <footer className="lnd-footer">
        <button className="lp-mark" onClick={go('/')} style={{ background: 'none', border: 0, cursor: 'pointer' }}>
          <span className="logo-mark sm" /> ARKSAI · STUDIO
        </button>
        <span className="lnd-foot-tag">An AI workforce, working across your business.</span>
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
