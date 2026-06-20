/**
 * Per-department, per-task EXPERT STANDARDS — injected into the system prompt when
 * a session is started from a department "play" (SessionMeta.task). This is the
 * domain-rigor layer: the agent doesn't just get a brief + generic design rules,
 * it gets the professional standards that make THAT specific deliverable genuinely
 * good. Researched from professional best-practice sources. Aesthetics + quality
 * always take priority.
 *
 * Keys are "<departmentId>.<task>". The canonical key set + department list live in
 * `shared/expertiseKeys.ts` (the single source of truth) — both this file and the
 * client play catalog derive from it. The sync test (server/test/expertiseRegistry.test.ts)
 * fails the build if any registered key is missing a TASK standard or TASK_TRIGGERS here,
 * or if either map carries a key that isn't registered. See EXPERTISE_AUTHORING.md to add one.
 */

import { TAX_PERSONA, TAX_TASKS } from './compliance/uae';
import { LEGAL_PERSONA, LEGAL_TASKS } from './legal/uae';
import { DEPARTMENT_IDS } from '../../../shared/expertiseKeys';

// ---- Department persona / cross-cutting rigor ----
const DEPARTMENT: Record<string, string> = {
  marketing:
    'Work as a senior brand & growth marketer. Lead with the audience and the benefit (not features), keep the message consistent and on-brand, and make every asset clear, scannable, and conversion-minded. ' +
    'VISUALS: marketing lives on imagery. For any finished graphic that carries words — an ad, social post, hero/banner, or OG image — use the `generate_creative` tool: it makes an on-brand AI background with reserved space and lays the headline/subhead/feature-list/button on as PIXEL-CRISP type (never trust an image model to render text). BRAND FIRST: before generating, ASK the user to upload their LOGO and confirm their brand accent colour (one quick step) — then pass the logo path; if they don\'t have one yet, set logo_placeholder so there\'s a clean spot for it. Write a vivid imagery prompt (subject, style, mood, brand palette) with NO text in it, pass the copy + the right aspect ratio (1:1 / 4:5 / 9:16 / 16:9 / 1.91:1) and the brand accent, and make one per channel size. Use plain `generate_image` only for a wordless illustration/texture. Output is always a ready-to-post PNG/JPEG. If a generation call returns an ERROR, that does NOT mean the tool is unavailable — FIX THE ARGUMENTS (imagery scene in `prompt`; the wording in headline/subhead/bullets/cta) and call it AGAIN; NEVER tell the user image generation is unavailable, NEVER switch to code mode, and NEVER substitute an HTML/CSS/SVG graphic for the image. The imagery is GENERATED — NEVER web-search for, download, or composite a stock/Unsplash photo.',
  sales:
    'Work as a sharp sales-enablement / RevOps partner. Be specific and persuasive WITHOUT hype — concrete claims and metrics beat adjectives, always framed around the buyer’s outcome. Everything skimmable and on-brand.',
  finance:
    'Work as a senior FP&A analyst / finance partner. Be precise and conservative: figures must tie out, NEVER fabricate or "plug" a number (clearly mark anything missing as "data not provided"), label units and periods, and make the work auditable and easy to flex.',
  people:
    'Work as an experienced People/HR partner. Write in plain, inclusive, legally-careful language; be specific; mark placeholders for company specifics; and flag where professional/legal review is advisable — you do not give legal advice.',
  engineering:
    'Work as a senior engineer / PM. Be precise and pragmatic: start from the problem and the outcome, make it testable and unambiguous, and keep tools and docs clean and maintainable.',
  bi:
    'Work as a senior BI / analytics lead (analytics engineer + analyst). Lead with the DECISION the work serves; define every metric precisely and consistently (one agreed definition, with grain/units/period); surface the "so what", not just charts; cite data sources and NEVER fabricate or plug a number — mark anything missing as "data not provided". Insight-first, trustworthy, scannable.',
  tax: TAX_PERSONA,
  legal: LEGAL_PERSONA,
  personal:
    'Work as a friendly, practical, trustworthy generalist helping an everyday person with real life — money, writing, big purchases, plans. Use PLAIN language, no business jargon, no corporate framing; be warm, clear, and genuinely useful, like a sharp friend who happens to be an expert. Be honest: give the real answer (including the downside), never over-promise, and where a fact matters (a price, a rule, a figure) use REAL sources and CITE them — NEVER make a number up; if you can\'t find it, say so. Ask only the one or two things you truly need, then do the work. Aesthetics + correctness still matter: the result should look clean and be right.',
  learning:
    'Work as a patient, clear teacher who makes things genuinely click. Explain accurately, pitched to the reader\'s stated level (a 10-year-old, a beginner, an expert — ask if unsure), leading with a plain-language intuition, then a concrete example, then the precise detail. Build from what they already know; define every term you introduce; use analogies that are honest (and flag where the analogy breaks). NEVER fabricate facts, dates, formulas, or quotes — if you\'re unsure, say so. Scannable structure, no padding.',
};

// Single-source-of-truth guard: every registered department MUST have a persona here.
// A registered department with no persona would silently leave the auto-router with no
// fallback voice — this throws loudly at module load (and the sync test asserts it too).
for (const dept of DEPARTMENT_IDS) {
  if (!DEPARTMENT[dept]) {
    throw new Error(`expertise.ts: registered department "${dept}" has no persona in DEPARTMENT`);
  }
}

// ---- Reusable archetype standards (research-backed) ----
const FIN_SHEET =
  'Financial-spreadsheet rigor: separate inputs/assumptions from calculations from outputs; put every assumption in its OWN labelled cell (never bury a number inside a formula) so a single change flows through. EVERY derived number MUST be a LIVE formula in generate_spreadsheet (pass {"f":"C5*(1+Assumptions!B5)","v":<result>} — formula + cached result — or a "=B2*C2" string; totals via =SUM(...)); a model that hard-codes its totals/balances/growth is rejected by the automated review. Compute every derived figure with compute_financials (operation dcf / ratios / variance / forecast) — never hand-type or guess a derived number; pass the computed result as the cached value. BUILD GRANULAR / multi-year monthly models IN STAGES via generate_spreadsheet: first the "Assumptions" sheet (every driver — rents, salaries, unit costs, escalation %), then call again with append:true to add ONE schedule sheet at a time (CAPEX, OPEX, Personnel, Summary/P&L), each referencing Assumptions with cross-sheet formulas — this keeps it fast and reliable instead of one giant payload, and is how you deliver real month-by-month granularity. RESEARCH the real drivers first (comparable commercial rents, equipment prices, market salary bands) and cite them on the Assumptions sheet; never fabricate the numbers. Clean number formats (currency symbol, thousands separators, % where due); bold/shade the header row and totals, freeze the header; include a summary/totals; add light sanity checks. Never invent figures.';
const HOME_SHEET =
  'Personal-money spreadsheet (friendly, NOT corporate FP&A): simple, warm, and obvious to a non-accountant. A clear income block, plain everyday expense CATEGORIES (rent/housing, groceries, transport, bills/utilities, subscriptions, eating out, savings, fun), and a big "what\'s left this month" number. Every total/remaining figure MUST be a LIVE formula in generate_spreadsheet (a "=SUM(...)" or a {"f":...,"v":...} cell — never hard-code a total, or the automated review rejects it) so when they change one number everything updates. Currency formatted to the user\'s locale (AED by default in the UAE), thousands separators, a frozen header, light colour. No jargon, no scenario tabs unless asked. Never invent the user\'s numbers — ask or mark as an estimate.';
const TRACKER =
  'Tracker spreadsheet: a clean, frozen header row, one record per row, sensible column types, dropdown/validation on status fields, subtotals where useful, and light banding so it scans. Usable and editable, not over-engineered.';
const DECK =
  'Deck craft: lead EACH slide with a takeaway headline (the point, not a label); one idea per slide; strong primary-vs-secondary hierarchy and generous spacing; visualise data simply (a chart that clarifies, never decorates) with the insight called out; move the reader problem → evidence → ask; keep it tight (~10–14 slides). Never fabricate numbers.';
const DASHBOARD =
  'Dashboard craft: lead with the decision it serves. Most important KPI top-left, largest + highest contrast (people scan in an F-pattern); above the fold = status + 5–7 key KPIs (never ~12+), middle = trends/comparisons, bottom = detail + filters. Right chart for the job (bars=compare, lines=trend, donut=composition). The key insight must land in ~5 seconds. Flat, restrained, values labelled directly. Validate the brand palette with validate_palette before building — body text and links must pass WCAG AA contrast (4.5:1 normal text, 3:1 large/UI); apply the corrected colour it returns for any failing pair. Compute every derived metric/ratio/variance with compute_financials — never hand-type a derived number.';
const REPORT =
  'Report craft: open with the bottom line, then the evidence; restrained, editorial, scannable; cite any external figure and never fabricate — mark gaps instead. Compute every derived figure (DCF, ratios, variance, forecasts) with compute_financials rather than hand-typing it.';
const RESEARCH =
  'Research rigor: use REAL public sources and CITE them; never fabricate facts or figures; separate fact from inference; lead with the so-what; keep it structured and skimmable.';
const SOCIAL =
  'High-converting social creative — make the thumb stop and the next action obvious: ' +
  '(1) HOOK — a benefit/outcome-led headline whose value lands in the first ~3 words (what they GET, not the process), on a high-contrast, emotive image (a real human face / eye-contact lifts response). ' +
  '(2) ONE idea, ONE offer, ONE call-to-action — a verb-first CTA ("Apply now", "Book a call", "Get started"); ALWAYS include a CTA on a social ad even if the brief omits one. ' +
  '(3) PROOF + specifics — concrete numbers, timeframes, guarantees or social proof that build trust, ONLY where true (never fabricate; keep claims accurate + compliant, especially for regulated services like visas/finance/legal). ' +
  '(4) Light urgency/scarcity only when honest. ' +
  '(5) Eye-path = logo → hook → 2–4 benefit bullets → CTA; generous contrast and large type so it still reads at thumbnail size on a phone. ' +
  '(6) For 9:16 stories/reels keep the key text in the central safe area, clear of the top/bottom platform UI.';
const HR_DOC =
  'HR-document standards: plain, jargon-free language; clear definitions; logical headings + bullets; realistic examples; explicit placeholders for company specifics; note where legal review is advisable (this is not legal advice).';
const TECH_DOC =
  'Doc standards: start from the problem and the outcome (not the implementation); crisp, testable, unambiguous; clear headings so each section stands alone; include examples; scannable.';

// ---- Per-task standards ----
const TASK: Record<string, string> = {
  // Marketing
  'marketing.landing':
    'High-converting landing page: one focused goal; eye-path headline → subhead → one strong visual → social proof → CTA; the CTA is the single most prominent element; minimum form fields; bullets over paragraphs; benefit-led copy; flawless and fast on mobile. Validate the brand palette with validate_palette before building (body text + links must pass WCAG AA contrast — 4.5:1 normal, 3:1 large/UI; apply the corrected colour for any failing pair).',
  'marketing.emailkit':
    'Marketing email — optimize for the INBOX (a different medium from social, with its own rules): a specific, curiosity/benefit subject line + preheader (the open-rate levers), mobile-first (≥14px text, ~44px tap targets, generous whitespace), ONE clear CTA, 50–200 words, benefit-led and personal, never spammy, with a plain-text-friendly fallback. Build any accompanying social graphics SEPARATELY with generate_creative (optimized for social, not styled like the email). Keep the two optimized for their own channel.',
  'marketing.creative':
    `Ad & social creative: use generate_creative for each piece — a hero/ad plus channel-sized social graphics (1:1, 4:5, 9:16, 16:9). SPLIT THE BRIEF: the \`prompt\` is ONLY the imagery (subject, composition, style, mood, brand colour) with NO text/words in it; put the wording in the SEPARATE fields headline + subhead + bullets + cta (never cram the copy into the prompt — that's what makes image text garble). BRAND FIRST: ask the user to upload their logo + confirm the brand accent before building (pass the logo path, or set logo_placeholder if they have none). One idea per image, on-brand, high-contrast; expose every file as a download. ${SOCIAL}`,
  'marketing.blog':
    'Article craft: a specific, promise-keeping headline; a hook that states the value up front; scannable sections with subheads and bullets; concrete examples; a clear takeaway/CTA. Research facts and cite them; never pad.',
  'marketing.brief': `${REPORT} Campaign brief specifics: a single measurable objective, the precise audience, the one key message, channels, timeline, and the success metrics — one tight page.`,
  'marketing.eventsite':
    'Event/waitlist page: the what/when/where above the fold, a compelling reason to attend, and a frictionless sign-up (minimum fields). Clear, fast, on-brand, great on mobile.',
  'marketing.perfreport': `${REPORT} Performance reporting: show the result vs the goal, trend the key metrics, and call out the 2–3 takeaways + the recommended next action — don’t just dump charts.`,
  'marketing.competitor': `${RESEARCH} Competitor teardown: positioning, messaging, pricing (where public), and strengths/gaps in a side-by-side layout, ending with where WE can win.`,
  'marketing.audience': `${RESEARCH} Audience/market brief: who they are, what they care about, where they are, and the messaging angles that will land — lead with the implications.`,
  'marketing.calendar': `${TRACKER} Content calendar: columns for date, channel, format, topic/hook, owner, and status; a realistic cadence; easy to filter by channel/week.`,
  'marketing.tracker': `${TRACKER} Campaign tracker: campaign, channel, budget, status, and key results with subtotals so performance is obvious.`,

  // Sales
  'sales.pitchdeck': `${DECK} Pitch-deck arc: problem → solution → product → market → traction → pricing → the ask; lead with a specific insight/proof; include credible unit economics; ~10–14 slides.`,
  'sales.pricing':
    'Pricing one-pager: clear tiers in a scannable comparison, what’s included in each, and a short value story; make the recommended tier obvious; minimal and persuasive.',
  'sales.proposal':
    'Winning proposal: open with the PROSPECT’s problem (not us); map our solution to their goals; clear scope, transparent pricing, timeline, and a single next step; specific and credible; tasteful and on-brand.',
  'sales.casestudy':
    'Case study: Challenge → what we did → measurable Results (a metric or two); credible, specific, quote-ready; never invent figures.',
  'sales.outreach':
    'Cold outreach sequence: short, personalised, value-first emails (subject + one idea + one CTA each); no fluff or hype; a clear escalation across 4–5 touches; respect the reader’s time.',
  'sales.accountbrief': `${RESEARCH} Account brief: company overview, the buying committee/stakeholders, likely pain points, recent news, and our angle — lead with the angle.`,
  'sales.battlecard': `${RESEARCH} Battlecard: ONE page, skimmable (bullets + a side-by-side comparison table); frame the competitor’s strengths/weaknesses around OUR value (not a feature list); use concrete metrics ("50% faster", not "better"); a "why we win" callout, objection-handling, and what to ask / say / avoid.`,
  'sales.roi':
    'ROI calculator: clean inputs for the customer’s current state and our impact; transparent formula; outputs the savings + payback with a clear chart; verify the maths and the live app before publishing.',
  'sales.accountplan': `${TRACKER} Account plan: the account’s goals, the buying committee and their priorities, our solution map, risks, and a DATED action plan with owners.`,
  'sales.pipeline': `${TRACKER} Pipeline tracker: deal, stage, value, close date, owner, and next step; totals by stage; weighted value if useful.`,

  // Finance
  'finance.boarddeck': `${DECK} Board-deck specifics: performance vs plan, the KPIs, financials, risks, and asks — restrained and serious; every number ties out; never fabricate.`,
  'finance.investorupdate': `${REPORT} Investor update: highlights, the key metrics (with vs-plan), lowlights (honest), asks, and runway — concise and candid.`,
  'finance.strategymemo': `${REPORT} ${RESEARCH} Strategy memo: the question, the analysis, cited benchmarks, the options, and a CLEAR recommendation with the reasoning.`,
  'finance.kpidashboard': DASHBOARD,
  'finance.variance': `${REPORT} Variance report: budget vs actual by line, the variances (absolute + %), charts, and a short narrative on what moved and why; flag gaps, never plug.`,
  'finance.model': `${FIN_SHEET} Model structure: a clear assumptions block driving the projection with monthly columns and totals; built so a single assumption flows through; scenario-ready.`,
  'finance.cashflow': `${FIN_SHEET} Cash-flow forecast: opening cash → inflows → outflows → net → closing cash by month, with runway highlighted; formula-driven.`,
  'finance.scenario': `${FIN_SHEET} Scenario/sensitivity model: best/base/worst driven by a few key assumptions, outputs compared side by side; make switching scenarios trivial.`,
  'finance.budget': `${FIN_SHEET} Budget: monthly income, categorized expenses, and what’s left — category subtotals, a clean summary, currency formats.`,
  'finance.expenses': `${TRACKER} Expense tracker: date, category, vendor, amount, notes; category subtotals; currency formatting.`,

  // HR / People & Ops
  'people.jd': `${HR_DOC} Job description: INCLUSIVE language (all genders, neutral pronouns); avoid gender-coded words (e.g. "aggressive", "rockstar", "ninja"); define acronyms; TASK-based requirements (not ableist physical demands); include the work environment, location/remote, and what you offer; keep must-haves short to widen the funnel.`,
  'people.offer': `${HR_DOC} Offer letter: be SPECIFIC — never vague ("competitive salary" is banned); state title, start date, hours, location, exact compensation and benefits; clearly mark every placeholder; include a response window; note it should be reviewed by counsel.`,
  'people.policy': `${HR_DOC} HR policy: purpose, scope, the policy itself, and how it is applied + the escalation path; realistic examples; flag jurisdiction/legal-review needs.`,
  'people.handbook': `${HR_DOC} Handbook: values, the core policies, benefits, and ways of working — well-structured with clear headings and a table of contents; warm but precise.`,
  'people.training': `${REPORT} Training guide / SOP: purpose, prerequisites, the steps in order (numbered), tips/pitfalls, and a quick-reference summary; anyone should be able to follow it.`,
  'people.survey':
    'Engagement survey: SHORT, neutral, unbiased questions (no leading wording); a consistent scale (e.g. 1–5); an anonymity note; capture responses cleanly into a results view; verify the form works before publishing.',
  'people.peopledash': DASHBOARD,
  'people.onboardingportal':
    'Onboarding portal: a first-week checklist, the key links, team intros, and the schedule — friendly, clear, welcoming; verify and publish it.',
  'people.onboardingchecklist': `${TRACKER} Onboarding checklist: task, owner, due day, and status across pre-start and the first week.`,
  'people.teamtracker': `${TRACKER} Team tracker: people, roles, status, and key dates.`,
  'people.runbook': `${REPORT} Runbook: purpose, the steps in order, the owners, and the escalation path — clear enough to follow under pressure.`,

  // Engineering
  'engineering.internaltool':
    'Internal tool: solve the actual workflow; clean, fast UI; wire real data; verify the full flow end-to-end (seed + exercise) before publishing.',
  'engineering.prototype':
    'Prototype: fast and functional over polished, but it must actually WORK and be deployed so it can be tried; make the core interaction real, not faked.',
  'engineering.admin':
    'Admin/CRUD: list / create / edit / delete for the entities, a clean table UI, a working backend, and validation; verify the whole flow before publishing.',
  'engineering.docssite':
    'Docs/landing site: a clear hero, the key sections, and obvious navigation; clean, fast, and easy to scan.',
  'engineering.engmetrics': `${DASHBOARD} Engineering metrics: throughput, cycle time, deploys, and incidents — trend them and surface the bottleneck.`,
  'engineering.datadash': DASHBOARD,
  'engineering.api':
    'API/automation: clear endpoints/inputs/outputs, sensible errors; EXERCISE it with real requests and show the request/response; hand back something runnable.',
  'engineering.techdoc': TECH_DOC,
  'engineering.runbook': `${REPORT} Ops runbook: purpose, preconditions, numbered unambiguous steps, verification after each major step, rollback, and owners/escalation.`,
  'engineering.designdoc': `${TECH_DOC} Design doc / PRD: open with the user problem + business outcome; then goals AND non-goals, the approach, alternatives, risks, and a rollout plan — not UI/DB details first.`,
  'engineering.statusreport': `${REPORT} Status report: what shipped, what’s in progress, risks/blockers, and what’s next — with a chart or two; honest, not rosy.`,

  // Engineering — developer tier (canon harvested from the claude-skills library)
  'engineering.schema':
    'Database schema design: derive ENTITIES from the requirements, then their RELATIONSHIPS (1–1 / 1–many / many–many via an explicit junction table). NORMALISE to 3NF (no repeating groups, no partial/transitive dependencies) unless a denormalisation is justified and noted. Every table gets a PRIMARY KEY; FOREIGN KEYS with explicit ON DELETE/UPDATE behaviour; UNIQUE + NOT NULL + CHECK constraints where the domain demands. Add the right INDEXES (FK columns, frequent filter/sort columns, composite/partial/covering where the query pattern warrants — but do not over-index writes). Apply cross-cutting concerns deliberately: multi-tenancy (org/tenant id on scoped tables), soft deletes (deleted_at), audit columns (created_at/updated_at/created_by), optimistic-lock version. Consistent NAMING (snake_case tables/columns, singular vs plural chosen and kept). Deliver: a Mermaid ERD, the DDL (CREATE TABLE … with constraints + indexes), and a forward+rollback MIGRATION plan. ' +
    'Present it as a DESIGNED schema DOCUMENT via generate_doc — minimalistic yet genuinely beautiful and typography-first: self-host Inter / Source Serif 4 / Space Grotesk (add_fonts or @font-face), a clear modular type scale, ~1.5 line-height, real hierarchy, generous whitespace, a restrained palette with ONE accent, and code/DDL in a clean monospace block. Never a raw markdown or SQL dump.',
  'engineering.apidesign':
    'API design & review (REST): model RESOURCES as nouns, kebab-case collection paths (/api/v1/user-profiles, never /getUsers), camelCase fields; correct HTTP verbs (GET safe+idempotent, POST create, PUT replace, PATCH partial, DELETE) and STATUS CODES (2xx/4xx/5xx used correctly, not 200-with-an-error-body). Mandate explicit VERSIONING (URL /v1 recommended), consistent PAGINATION (cursor or limit/offset, documented), IDEMPOTENCY for unsafe retries (idempotency keys), a SINGLE consistent ERROR SHAPE ({error:{code,message,details}}), and AUTH/authorisation per endpoint. Review against those conventions, flag breaking changes (removed endpoints/fields, type changes, new required fields) and require a version bump for them, and SCORE the design (consistency, docs, security, usability, performance). ' +
    'Deliver a DESIGNED API REFERENCE document (generate_doc) — or a review report (render_report) for a pure audit — minimalistic yet genuinely beautiful, typography-first: self-host Inter / Source Serif 4 / Space Grotesk, a clear modular type scale, ~1.5 line-height, real hierarchy, generous whitespace, restrained palette + ONE accent, endpoints/JSON examples in a clean monospace block with a tidy method/path/description table. Never a raw dump.',
  'engineering.apitests':
    'API test suite: from the described/inspected endpoints, generate COMPREHENSIVE, ready-to-run tests covering — HAPPY PATH (valid request → expected 2xx + response shape); INPUT VALIDATION (missing fields, wrong types, boundary/oversized values, injection-style strings → 400/422); AUTH MATRIX per protected route (no token, malformed token, expired token, valid-but-wrong-role → 401/403, valid+correct → 2xx); ERROR CODES (404 missing, 409 conflict, 429 rate-limit where applicable); CONTRACT checks (response matches the documented schema); and PAGINATION edges (first/last/empty/oversized page) where relevant. One clear assertion per case, descriptive test names, isolated/repeatable (seed + teardown), no flaky sleeps. Use the project’s existing runner if present; otherwise a sensible default. EXERCISE it and report pass/fail before handing back. ' +
    'Any accompanying coverage/summary write-up is a DESIGNED document (generate_doc) — minimalistic yet beautiful, typography-first (self-hosted Inter / Source Serif 4 / Space Grotesk, modular scale, ~1.5 line-height, hierarchy, whitespace, ONE accent, monospace code blocks) — never a raw dump.',
  'engineering.codereview':
    'Code review: structured and systematic, not style nits. Assess CORRECTNESS (logic bugs, edge cases, error handling, race conditions), SECURITY (injection, XSS, auth/authorisation bypass, secret exposure, unsafe deserialisation, dependency risk), READABILITY/maintainability (naming, structure, dead code, duplication), and PERFORMANCE (N+1 queries, needless allocations, blocking I/O, bundle/regression). Trace the BLAST RADIUS (who imports the changed code, crossed service boundaries, shared contracts/DB schema) and flag BREAKING CHANGES (API contracts, schema migrations, config keys). Tag EVERY finding with a severity (Critical / High / Medium / Low / Nit) and a CONCRETE FIX (the exact change or a code snippet), not vague advice. Acknowledge what is done well. Never invent a vulnerability — if unsure, say so. ' +
    'Deliver a DESIGNED review REPORT (render_report) or document (generate_doc) — minimalistic yet genuinely beautiful, typography-first: self-host Inter / Source Serif 4 / Space Grotesk, a clear modular type scale, ~1.5 line-height, real hierarchy, generous whitespace, restrained palette + ONE accent, a severity-coded findings table, and code/diff in a clean monospace block. Never a raw markdown dump.',
  'engineering.depaudit':
    'Dependency audit: run the deterministic `dependency_auditor` tool on the package.json / requirements.txt (path or pasted) and build the report on its structured output — flag floating/unpinned ranges (non-reproducible installs), duplicate/conflicting declarations, pre-1.0 pins, and a missing lockfile, then lay out a risk-ordered UPGRADE PLAN (security patches first, then bug fixes, then features, then major/breaking — each with the change type and a rollback note). BE HONEST about the offline limit: the tool CANNOT see live CVEs, so NEVER fabricate a CVE; explicitly recommend pairing it with `npm audit` / `pip-audit` (or the registry advisory feed) for current vulnerabilities, and mark anything unverified as such. ' +
    'Deliver a DESIGNED audit REPORT (generate_doc or render_report) — minimalistic yet genuinely beautiful, typography-first: self-host Inter / Source Serif 4 / Space Grotesk, a clear modular type scale, ~1.5 line-height, real hierarchy, generous whitespace, restrained palette + ONE accent, a clean dependency/findings table, and any versions/commands in a monospace block. Never a raw dump.',

  // BI & Analytics
  'bi.dashboard': `${DASHBOARD} BI specifics: a clear title + as-of date, a period-over-period delta on each KPI, consistent colour semantics (a colour means the same thing everywhere), and a one-line headline takeaway; wire to the data provided and verify the live app.`,
  'bi.explorer': `${DASHBOARD} Self-serve explorer: usable by a non-analyst — filters for date/segment/region update BOTH a chart and a data table, sensible defaults, clear empty states, and an export; fast and obvious.`,
  'bi.reviewdeck': `${DECK} Business review (MBR/QBR): a curated point-in-time STORY (not an explorable dashboard) — performance vs plan, the KPIs, what moved and why, risks, and the asks/next steps; data appendix behind.`,
  'bi.datadict': `Metric dictionary: one entry per metric — name, plain definition, the EXACT formula/logic (numerator, denominator, filters, time grain), source system, owner, and refresh cadence; call out where conflicting definitions exist and propose the single agreed one. The goal is to end "whose number is right". Clear headings; mark placeholders for company specifics.`,
  'bi.adhoc': `${REPORT} Ad-hoc analysis: lead with the question, the method, and the answer; show only the cuts that matter (funnel/segment/cohort) with clean charts; separate correlation from causation; end with the recommended action. Use the data given; flag gaps, never plug.`,
  'bi.cohort': `${REPORT} Cohort/retention: define the cohort and the event precisely; group by start period; show retention/behaviour over time (curve or triangle); call out WHERE and WHY it drops and the implication.`,
  'bi.insight': `${REPORT} Insight narrative (data storytelling): auto-surface what CHANGED — biggest movers, trends, outliers, likely drivers — each explained in plain language with the number and the "so what", ranked by impact; no chart without a sentence; never assert beyond the data.`,
  'bi.forecast': `${FIN_SHEET} Forecast / what-if: a driver-based projection of the metric — assumptions block → monthly projection → outputs, with a high/base/low view; state the method and assumptions; fully formula-driven so a driver change flows through (hard-coded projections are rejected).`,
  'bi.scorecard': `${DASHBOARD} KPI scorecard: each KPI with current value, target, period-over-period delta, and an explicit on/off-track status; grouped by objective/OKR; readable in ~5 seconds; consistent definitions.`,
  'bi.digest': `${REPORT} Recurring digest: tight and scannable, built to be sent on a schedule — headline number(s), the key movers vs last period, ONE chart, and the single thing to act on; identical structure each run so it’s comparable across periods.`,
  'bi.alert': `KPI monitor/alert: pull the latest data, evaluate the threshold/condition, and signal ONLY when it’s actionable — a clear message with the metric, value, threshold, and the change/direction; route to the Slack/webhook provided. Avoid alert fatigue: no noise, no alert on normal variation; say plainly when nothing breached.`,

  // Personal / everyday life
  'personal.budget': `${HOME_SHEET} Personal/household monthly budget: income at the top, everyday categories, category subtotals, and a clear "money left over" line — built so changing one number flows through. Plain and reassuring; suggest sensible category splits if they\'re unsure but never invent their actual figures.`,
  'personal.savings':
    'Savings / debt-payoff plan: start from the goal (target amount or "be debt-free") and a realistic timeline; lay out a simple month-by-month plan of how much to set aside or pay down, the order to tackle debts (highest-interest first — explain why), and the date they\'ll get there. Be honest about whether the timeline is realistic on their numbers and suggest a tweak if not. Use a clean sheet or doc; formula-driven if a spreadsheet so they can flex it. Never invent their balances or rates — ask.',
  'personal.valuation': `${RESEARCH} Big-purchase valuation & price comparison (the "should I buy / sell" call — car, home, phone, any product): RESEARCH real, current public listings/prices for the exact item (make/model/year/condition/mileage/region) and CITE each source with its price; give a fair BUY range and a realistic RESALE/sell range, the key factors that move the price (condition, mileage/age, spec, market timing, location), and a plain-English verdict (good deal / overpriced / hold) with the reasoning. If you build any valuation MODEL (e.g. depreciation, a discounted-cashflow / NPV on an income property, ratios), compute it with compute_financials — never hand-type a derived number. NEVER fabricate a price or a listing — if you can\'t find comparables, say so and explain how to value it. Note prices are indicative and move with the market.`,
  'personal.resume':
    'Résumé / CV (an editable, ATS-friendly document): clean single-column, standard parseable headings (Experience, Education, Skills), no tables/columns/graphics that break ATS parsing; strong action-verb bullets that are QUANTIFIED (impact + number, not duties); reverse-chronological; tailored to the target role with its keywords; one page for <10 yrs experience; clearly marked [placeholders] for anything not provided. Never invent jobs, dates, or achievements — ask or mark to fill in.',
  'personal.coverletter':
    'Cover letter (an editable, one-page document): open with a specific hook (why THIS role/company, not a generic intro); 2–3 short paragraphs mapping the candidate\'s real, relevant achievements to the job\'s needs (quantified where possible); a confident, warm close with a clear call to action; tailored, never templated-sounding. Marked [placeholders] for specifics; never fabricate experience.',
  'personal.complaintletter':
    'Complaint / dispute letter (an editable document): firm but polite and professional; lead with the facts (dates, order/reference/booking numbers, amounts); state the specific failure clearly, then the exact remedy you want (refund/replacement/compensation) and a reasonable deadline; add a calm escalation line (next step if unresolved — regulator, ombudsman, chargeback). Keep it to one page. Never invent facts — ask for the details.',
  'personal.letter':
    'Formal letter (an editable document): the correct register and structure for its purpose (sender/recipient blocks, date, clear subject line, a concise body that states the purpose in the first line, and a proper sign-off); polite, unambiguous, and appropriately formal. Marked [placeholders] for specifics; never invent facts.',
  'personal.emailrewrite':
    'Rewrite / polish a message or email: keep the original MEANING and intent exactly, but improve tone, clarity, and brevity for the goal the user states (more professional, warmer, firmer, shorter, clearer). Fix grammar and awkward phrasing; cut filler; make the ask obvious. Offer the rewritten version plainly (and a short note on what you changed if helpful). Never add facts or commitments the user didn\'t make.',
  'personal.trip':
    'Trip itinerary: a realistic day-by-day plan for the destination, dates, party, and budget given — grouped sensibly by area so the days flow (no zig-zagging across the city), with a mix of must-sees and downtime, rough timings, and getting-around notes. FLAG costs as indicative estimates (entry fees, transport, meals) — never present invented prices as exact, and cite where a figure or an opening time matters. Note anything seasonal/booking-ahead. Clean, scannable document.',
  'personal.event':
    'Event / party plan: a clear checklist + timeline working back from the date (what to do this week, the day before, the day of), a simple budget with category estimates (flagged as estimates), guest/headcount considerations, and a shopping/supplies list. Practical and realistic for the size and budget given; never invent vendor prices — mark them to confirm.',
  'personal.checklist': `${TRACKER} Personal checklist / plan: a clear, ordered list of the steps or items for the task, grouped logically with sensible due-dates/owners where it helps, in a clean editable format (a sheet or a simple doc). Practical and complete — think through what they\'d forget — without over-engineering it.`,

  // Learning & explainers
  'learning.explainer':
    'Concept explainer at a chosen level: ASK (or infer) the reader\'s level, then lead with a one-line plain intuition, give a concrete relatable example/analogy, then the precise mechanics, and end with a quick check ("so, in short…"). Accurate above all — define each term as you use it, flag where an analogy breaks down, and NEVER fabricate facts, formulas, or history; cite if it\'s a real-world figure. Scannable, no padding.',
  'learning.studyguide':
    'Study guide / revision notes (an editable, scannable document): organised by topic with clear headings; the key points distilled (bold the must-knows), worked examples, simple mnemonics/memory aids where they help, and a short set of practice questions WITH answers at the end. Faithful to the source material; accurate; never invent facts or formulas. Built to revise from, not to read once.',
  'learning.summarize':
    'Summarize a document/text the user pastes: be FAITHFUL — only what the source actually says, no added claims, no invented detail; lead with a 1–2 line TL;DR, then the key points as scannable bullets (grouped by theme/section), preserve any critical numbers/dates/terms verbatim, and flag explicitly where the text is ambiguous or where something important seems missing. State the level of detail you kept. Never editorialise beyond what\'s there.',

  // Tax & Compliance (UAE) — researched per-obligation specs live in compliance/uae.ts
  ...TAX_TASKS,
  // Legal (UAE) — persona + per-play standards live in legal/uae.ts
  ...LEGAL_TASKS,
};

/**
 * The set of task keys that carry an expert-standards block (TASK + the spread
 * TAX/LEGAL keys). Exported so the registry sync test can assert it matches the
 * shared registry exactly — no standard without a registered key, no registered
 * key without a standard.
 */
export const TASK_KEYS: string[] = Object.keys(TASK);

/** The set of department ids that carry a persona. */
export const DEPARTMENT_KEYS: string[] = Object.keys(DEPARTMENT);

/**
 * The expert-standards block for a task key (e.g. "finance.cashflow"), or for a bare
 * DEPARTMENT id (e.g. "finance") which returns the persona only — the persona-level
 * fallback used by the auto-router when it can identify the department but not the
 * exact task. Returns null if unknown / no task.
 */
export function expertiseFor(taskKey: string | null | undefined): string | null {
  if (!taskKey) return null;
  // Bare department id (no dot, or a "<dept>" that's a known persona) → persona only.
  const dept = taskKey.includes('.') ? taskKey.split('.')[0] : taskKey;
  const persona = DEPARTMENT[dept];
  const task = taskKey.includes('.') ? TASK[taskKey] : undefined;
  if (!persona && !task) return null;
  return (
    `## Expert standards for this task — follow these for an optimum result\n` +
    [persona, task].filter(Boolean).join('\n') +
    `\nAesthetics AND correctness take priority: the result must look genuinely professional and be right.`
  );
}

// ---------------------------------------------------------------------------
// Trigger phrases for the DETERMINISTIC auto-expertise router (Phase 1).
//
// A free-form message (no department "play" picked → session.task is null) is matched
// against these to silently select the right expertise. Picked plays always win — this
// only fills the null case. Keep phrases lowercase; multi-word phrases are stronger
// signals than single keywords (the router length-weights them).
// ---------------------------------------------------------------------------

/** Broad department-level words → a persona-only fallback when no task is confident. */
export const DEPARTMENT_TRIGGERS: Record<string, string[]> = {
  marketing: ['marketing', 'campaign', 'brand', 'advert', 'advertising', 'social media', 'audience', 'copywriting', 'go to market'],
  sales: ['sales', 'sell', 'prospect', 'lead gen', 'close the deal', 'buyer', 'revenue', 'crm', 'quota'],
  finance: ['finance', 'financial', 'accounting', 'money', 'profit', 'revenue forecast', 'p&l', 'fp&a', 'investor'],
  people: ['hr', 'human resources', 'people team', 'employee', 'hiring', 'recruiting', 'onboarding', 'workplace'],
  engineering: ['engineering', 'software', 'developer', 'codebase', 'technical', 'backend', 'frontend', 'devops', 'architecture'],
  bi: ['analytics', 'data analysis', 'business intelligence', 'metrics', 'reporting dashboard', 'kpi', 'data viz'],
  tax: ['tax', 'vat', 'corporate tax', 'fta', 'emaratax', 'excise', 'wps', 'e-invoice', 'compliance filing'],
  legal: ['legal', 'lawyer', 'attorney', 'contract law', 'lawsuit', 'litigation', 'court', 'statute', 'clause'],
  personal: ['for myself', 'for my family', 'personal', 'everyday', 'at home', 'my own', 'help me with my'],
  learning: ['learn', 'understand', 'teach me', 'explain', 'studying', 'revision', 'homework', 'how does it work'],
};

/**
 * Per-task trigger phrases. Keys map 1:1 to the TASK map (every department task +
 * the spread TAX/LEGAL task keys). ~3–8 strong, natural phrasings each.
 */
export const TASK_TRIGGERS: Record<string, string[]> = {
  // ---- Marketing ----
  'marketing.landing': ['landing page', 'landing site', 'lead capture page', 'signup page', 'conversion page', 'sales page'],
  'marketing.emailkit': ['marketing email', 'email campaign', 'newsletter', 'email blast', 'drip email', 'email template'],
  'marketing.creative': ['ad creative', 'social post', 'instagram ad', 'social graphic', 'banner ad', 'ad image', 'social media creative', 'facebook ad'],
  'marketing.blog': ['blog post', 'article', 'write a blog', 'seo article', 'content piece'],
  'marketing.brief': ['campaign brief', 'creative brief', 'marketing brief'],
  'marketing.eventsite': ['event page', 'waitlist page', 'rsvp page', 'event landing'],
  'marketing.perfreport': ['marketing report', 'campaign performance', 'performance report', 'channel performance'],
  'marketing.competitor': ['competitor', 'vs us', 'teardown', 'competitive analysis', 'competitor analysis', 'compare with competitors'],
  'marketing.audience': ['audience research', 'target audience', 'market research', 'buyer persona', 'audience brief', 'customer persona'],
  'marketing.calendar': ['content calendar', 'social calendar', 'posting schedule', 'editorial calendar'],
  'marketing.tracker': ['campaign tracker', 'track campaigns', 'marketing tracker'],

  // ---- Sales ----
  'sales.pitchdeck': ['pitch deck', 'investor deck', 'raise money', 'fundraising deck', 'startup deck', 'pitch presentation'],
  'sales.pricing': ['pricing page', 'pricing one-pager', 'pricing tiers', 'price sheet', 'pricing sheet'],
  'sales.proposal': ['sales proposal', 'business proposal', 'client proposal', 'write a proposal'],
  'sales.casestudy': ['case study', 'customer success story', 'success story'],
  'sales.outreach': ['cold outreach', 'cold email', 'outreach sequence', 'sales email', 'prospecting email', 'cold emails'],
  'sales.accountbrief': ['account brief', 'account research', 'prospect research', 'company brief'],
  'sales.battlecard': ['battlecard', 'sales battlecard', 'competitive battlecard', 'objection handling card'],
  'sales.roi': ['roi calculator', 'roi tool', 'savings calculator', 'value calculator'],
  'sales.accountplan': ['account plan', 'strategic account plan', 'key account plan'],
  'sales.pipeline': ['sales pipeline', 'pipeline tracker', 'deal tracker', 'track deals'],

  // ---- Finance ----
  'finance.boarddeck': ['board deck', 'board presentation', 'board meeting deck'],
  'finance.investorupdate': ['investor update', 'monthly investor update', 'update to investors'],
  'finance.strategymemo': ['strategy memo', 'strategic memo', 'business memo', 'should we', 'go no go'],
  'finance.kpidashboard': ['kpi dashboard', 'finance dashboard', 'financial dashboard', 'metrics dashboard'],
  'finance.variance': ['variance report', 'budget vs actual', 'budget versus actual', 'variance analysis'],
  'finance.model': ['financial model', 'projection model', 'revenue model', '3 statement model', 'build a model'],
  'finance.cashflow': ['cash flow', 'cashflow', 'runway', 'cash forecast', 'cash flow forecast', 'cash flow projection'],
  'finance.scenario': ['scenario model', 'sensitivity analysis', 'best worst case', 'what-if model', 'scenario analysis'],
  'finance.budget': ['company budget', 'department budget', 'business budget', 'annual budget', 'operating budget', 'budget plan'],
  'finance.expenses': ['expense tracker', 'track spending', 'expense log', 'expense sheet'],

  // ---- People / HR ----
  'people.jd': ['job description', 'jd', 'hiring for', 'job posting', 'job ad', 'role description'],
  'people.offer': ['offer letter', 'job offer', 'employment offer', 'offer of employment'],
  'people.policy': ['hr policy', 'company policy', 'workplace policy', 'leave policy', 'remote work policy', 'resignation policy', 'write a policy', 'attendance policy', 'staff policy', 'policy document'],
  'people.handbook': ['employee handbook', 'staff handbook', 'company handbook'],
  'people.training': ['training guide', 'sop', 'standard operating procedure', 'how-to guide', 'training manual'],
  'people.survey': ['engagement survey', 'employee survey', 'pulse survey', 'staff survey'],
  'people.peopledash': ['hr dashboard', 'people dashboard', 'headcount dashboard', 'people analytics'],
  'people.onboardingportal': ['onboarding portal', 'new hire portal', 'welcome portal'],
  'people.onboardingchecklist': ['onboarding checklist', 'new hire checklist', 'new employee checklist'],
  'people.teamtracker': ['team tracker', 'staff tracker', 'team roster'],
  'people.runbook': ['hr runbook', 'people ops runbook', 'process runbook'],

  // ---- Engineering ----
  'engineering.internaltool': ['internal tool', 'internal app', 'admin tool', 'ops tool', 'workflow tool'],
  'engineering.prototype': ['prototype', 'mvp', 'proof of concept', 'quick prototype', 'working demo'],
  'engineering.admin': ['admin panel', 'crud app', 'admin dashboard', 'management interface', 'back office'],
  'engineering.docssite': ['docs site', 'documentation site', 'developer docs', 'product docs site'],
  'engineering.engmetrics': ['engineering metrics', 'dev metrics', 'cycle time', 'deployment metrics'],
  'engineering.datadash': ['data dashboard', 'metrics app', 'live dashboard'],
  'engineering.api': ['build an api', 'rest api', 'api endpoint', 'automation script', 'webhook handler'],
  'engineering.techdoc': ['technical documentation', 'tech doc', 'api docs', 'technical spec'],
  'engineering.runbook': ['ops runbook', 'incident runbook', 'deployment runbook'],
  'engineering.designdoc': ['design doc', 'prd', 'product requirements', 'technical design document', 'rfc'],
  'engineering.statusreport': ['status report', 'engineering update', 'sprint report', 'project status'],
  'engineering.schema': ['database schema', 'schema design', 'design a database', 'data model', 'erd', 'normalize the schema', 'table relationships', 'db schema'],
  'engineering.apidesign': ['api design', 'design an api', 'rest api design', 'api review', 'review my api', 'api contract', 'openapi spec review'],
  'engineering.apitests': ['api tests', 'api test suite', 'test my api', 'integration tests for the api', 'contract tests', 'endpoint tests'],
  'engineering.codereview': ['code review', 'review my code', 'review this pr', 'pull request review', 'review the diff', 'review this code'],
  'engineering.depaudit': ['dependency audit', 'audit dependencies', 'audit my packages', 'outdated dependencies', 'dependency check', 'package audit', 'audit package.json'],

  // ---- BI & Analytics ----
  'bi.dashboard': ['dashboard', 'bi dashboard', 'build a dashboard', 'analytics dashboard', 'sales dashboard'],
  'bi.explorer': ['data explorer', 'self serve analytics', 'interactive report', 'explore the data'],
  'bi.reviewdeck': ['business review', 'qbr', 'mbr', 'quarterly review deck', 'monthly business review'],
  'bi.datadict': ['metric dictionary', 'data dictionary', 'metric definitions', 'metrics glossary'],
  'bi.adhoc': ['ad hoc analysis', 'analyze this data', 'data analysis', 'analyse these numbers', 'one-off analysis'],
  'bi.cohort': ['cohort analysis', 'retention analysis', 'cohort retention', 'retention curve'],
  'bi.insight': ['insight narrative', 'what changed', 'data story', 'key insights', 'data storytelling'],
  'bi.forecast': ['forecast', 'predict', 'projection', 'what-if forecast', 'demand forecast'],
  'bi.scorecard': ['scorecard', 'kpi scorecard', 'okr scorecard', 'metrics scorecard'],
  'bi.digest': ['weekly digest', 'metrics digest', 'recurring report', 'scheduled report'],
  'bi.alert': ['kpi alert', 'metric alert', 'threshold alert', 'monitor a metric', 'alert when'],

  // ---- Personal / everyday life ----
  'personal.budget': ['my budget', 'household budget', 'family budget', 'personal budget', 'budget for myself', 'home budget', 'budget for my family', 'budget for a family', 'monthly budget for'],
  'personal.savings': ['savings plan', 'save money', 'pay off debt', 'debt payoff', 'debt payoff plan', 'how to save for', 'sinking fund', 'get out of debt'],
  'personal.valuation': ['should i buy', 'should i sell', 'whats it worth', 'what is it worth', 'value my', 'resale value', 'sell my', 'is it a good deal', 'how much is my', 'price comparison for', 'buy or not'],
  'personal.resume': ['resume', 'cv', 'curriculum vitae', 'build a resume', 'write my cv', 'update my resume'],
  'personal.coverletter': ['cover letter', 'covering letter', 'letter for a job application', 'application letter'],
  'personal.complaintletter': ['complaint letter', 'dispute letter', 'letter of complaint', 'write a complaint', 'refund letter'],
  'personal.letter': ['formal letter', 'write a letter', 'official letter', 'letter to', 'request letter'],
  'personal.emailrewrite': ['rewrite this email', 'rewrite my email', 'polish this message', 'make this email sound', 'reword this', 'fix the tone', 'improve this email'],
  'personal.trip': ['trip itinerary', 'plan a trip', 'travel itinerary', 'plan my holiday', 'plan a vacation', 'days in', 'travel plan', 'trip for', 'trip to', 'day trip'],
  'personal.event': ['plan a party', 'party plan', 'event plan', 'plan an event', 'birthday party', 'plan a wedding', 'party checklist'],
  'personal.checklist': ['checklist', 'a checklist for', 'to do list', 'make a checklist', 'packing list', 'moving checklist'],

  // ---- Learning & explainers ----
  'learning.explainer': ['explain', 'explain to me', 'explain like im 5', 'eli5', 'help me understand', 'in simple terms', 'break it down for me', 'teach me about', 'how does it work'],
  'learning.studyguide': ['study guide', 'study notes', 'revision notes', 'exam notes', 'help me study', 'revision guide'],
  'learning.summarize': ['summarize', 'summarise', 'summary of', 'tldr', 'sum up', 'give me the gist', 'shorten this'],

  // ---- Tax & Compliance (UAE) ----
  'tax.tax_invoice': ['tax invoice', 'uae tax invoice', 'vat invoice', 'compliant invoice'],
  'tax.einvoice': ['e-invoice', 'einvoice', 'pint ae', 'peppol invoice', 'electronic invoice', 'e invoicing'],
  'tax.vat_return': ['vat return', 'vat 201', 'file vat', 'vat filing'],
  'tax.ct_return': ['corporate tax', 'corporate tax return', 'ct return', 'corp tax computation', '9% tax'],
  'tax.readiness': ['compliance readiness', 'tax readiness', 'compliance assessment', 'compliance gap'],
  'tax.guided': ['guided filing', 'filing wizard', 'walk me through filing', 'help me file my taxes', 'guide me through the filing'],
  'tax.wps': ['wps', 'wages protection system', 'salary file', 'sif file', 'payroll file'],
  'tax.excise_return': ['excise return', 'excise tax', 'excise filing'],
  'tax.faf': ['faf', 'fta audit file', 'vat audit file'],

  // ---- Legal (UAE) ----
  'legal.contract': ['contract', 'commercial contract', 'service agreement', 'draft a contract', 'agreement'],
  'legal.nda': ['nda', 'non-disclosure', 'confidentiality agreement', 'non disclosure agreement', 'draft an nda', 'draft nda', 'create an nda', 'need an nda', 'nda agreement'],
  'legal.employment': ['employment contract', 'employment agreement', 'staff contract', 'labour contract'],
  'legal.poa': ['power of attorney', 'poa', 'authorise someone', 'proxy authority'],
  'legal.corporate': ['moa', 'shareholders agreement', 'articles of association', 'memorandum of association', 'shareholder agreement'],
  'legal.resolution': ['board resolution', 'shareholder resolution', 'company resolution', 'board minutes'],
  'legal.notice': ['legal notice', 'letter before action', 'demand letter', 'cease and desist', 'notice letter'],
  'legal.policereport': ['police report', 'criminal complaint', 'file a complaint', 'report to police', 'file a police case'],
  'legal.opinion': ['legal opinion', 'legal memo', 'memorandum of advice', 'legal advice memo', 'is it legal'],
  'legal.review': ['contract review', 'review this contract', 'review a contract', 'redline', 'review agreement'],
  'legal.forensic': ['legal forensic audit', 'forensic legal', 'fraud investigation report'],
  'legal.compliance': ['legal compliance audit', 'ubo compliance', 'aml compliance', 'compliance audit'],
  'legal.dispute': ['dispute brief', 'litigation strategy', 'legal dispute', 'lawsuit strategy'],
  'legal.licensing': ['business licence', 'licensing advisory', 'free zone vs mainland', 'which jurisdiction', 'trade licence'],
  'legal.calendar': ['legal calendar', 'compliance calendar', 'filing tracker', 'legal deadlines tracker'],
};
