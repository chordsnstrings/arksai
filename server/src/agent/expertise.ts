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
  'Financial-spreadsheet rigor: separate inputs/assumptions from calculations from outputs; put every assumption in its OWN labelled cell (never bury a number inside a formula) so a single change flows through. EVERY derived number MUST be a LIVE formula in generate_spreadsheet (pass {"f":"C5*(1+Assumptions!B5)","v":<result>} — formula + cached result — or a "=B2*C2" string; totals via =SUM(...)); a model that hard-codes its totals/balances/growth is rejected by the automated review. Clean number formats (currency symbol, thousands separators, % where due); bold/shade the header row and totals, freeze the header; include a summary/totals; add light sanity checks. Never invent figures.';
const TRACKER =
  'Tracker spreadsheet: a clean, frozen header row, one record per row, sensible column types, dropdown/validation on status fields, subtotals where useful, and light banding so it scans. Usable and editable, not over-engineered.';
const DECK =
  'Deck craft: lead EACH slide with a takeaway headline (the point, not a label); one idea per slide; strong primary-vs-secondary hierarchy and generous spacing; visualise data simply (a chart that clarifies, never decorates) with the insight called out; move the reader problem → evidence → ask; keep it tight (~10–14 slides). Never fabricate numbers.';
const DASHBOARD =
  'Dashboard craft: lead with the decision it serves. Most important KPI top-left, largest + highest contrast (people scan in an F-pattern); above the fold = status + 5–7 key KPIs (never ~12+), middle = trends/comparisons, bottom = detail + filters. Right chart for the job (bars=compare, lines=trend, donut=composition). The key insight must land in ~5 seconds. Flat, restrained, values labelled directly.';
const REPORT =
  'Report craft: open with the bottom line, then the evidence; restrained, editorial, scannable; cite any external figure and never fabricate — mark gaps instead.';
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
    'High-converting landing page: one focused goal; eye-path headline → subhead → one strong visual → social proof → CTA; the CTA is the single most prominent element; minimum form fields; bullets over paragraphs; benefit-led copy; flawless and fast on mobile.',
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
  'finance.budget': ['budget', 'monthly budget', 'track expenses', 'spending plan', 'household budget', 'family budget', 'annual budget'],
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
