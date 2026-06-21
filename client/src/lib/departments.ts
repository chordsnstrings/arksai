import type { SessionMode } from '@shared/types';
import { AUTO_MODEL } from '@shared/types';
import type { DepartmentId, ExpertiseKey } from '@shared/expertiseKeys';

/**
 * The department-aware catalog. ArksAI for companies: each corporate function
 * gets its own language and a comprehensive set of ready-to-run "plays" mapped to
 * its real day-to-day work, grouped by the kind of work — Create / Analyze /
 * Operate. Pure data so adding tasks/departments — or promoting them to per-org
 * templates later — is trivial.
 *
 * The set of play keys + department ids is the single source of truth in
 * `shared/expertiseKeys.ts` — `Play.key` and `Department.id` are typed against it,
 * so the COMPILER rejects a play key that isn't registered, and a server-side sync
 * test fails the build if a registered key has no play here (or no server standard /
 * triggers). Adding an expertise: register the key in shared/expertiseKeys.ts, then
 * add the play, the standard, and the triggers. See EXPERTISE_AUTHORING.md.
 */

export type Category = 'create' | 'analyze' | 'operate';

export const CATEGORIES: { id: Category; label: string; blurb: string }[] = [
  { id: 'create', label: 'Create', blurb: 'Make a new thing' },
  { id: 'analyze', label: 'Analyze', blurb: 'Turn data into insight' },
  { id: 'operate', label: 'Operate', blurb: 'Run a recurring process' },
];

export interface Play {
  /**
   * Stable "<deptId>.<task>" key → server injects expert standards for it.
   * Typed against the shared registry, so an unregistered key is a compile error.
   */
  key: ExpertiseKey;
  title: string;
  blurb: string;
  /** A real, ready-to-run brief sent as the first message. */
  prompt: string;
  /** Routes to the right engine. 'report' → PDFs/decks; 'code' → apps, sheets, docs. */
  mode: SessionMode;
  category: Category;
  model?: string;
  icon: IconName;
}

export interface Department {
  /** Department id from the shared registry — an unregistered id is a compile error. */
  id: DepartmentId;
  name: string;
  /** One-line value statement shown on the tile. */
  blurb: string;
  /** Restrained, per-department accent (hex) for coding + wayfinding. */
  accent: string;
  icon: IconName;
  plays: Play[];
}

export type IconName =
  | 'megaphone'
  | 'briefcase'
  | 'chart-pie'
  | 'users'
  | 'layout'
  | 'file-text'
  | 'bar-chart-3'
  | 'trending-up'
  | 'presentation'
  | 'dollar-sign'
  | 'target'
  | 'wallet'
  | 'graduation-cap'
  | 'circle-check'
  | 'code'
  | 'terminal'
  | 'rocket'
  | 'git-branch'
  | 'calendar'
  | 'lightbulb'
  | 'mail'
  | 'clipboard'
  | 'search'
  | 'image'
  | 'landmark'
  | 'scale';

/** Inner SVG markup for each line icon (Lucide-style, matches our report icon set). */
export const ICONS: Record<IconName, string> = {
  megaphone: '<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
  briefcase: '<path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/><rect width="20" height="14" x="2" y="6" rx="2"/>',
  'chart-pie':
    '<path d="M21 12c.552 0 1.005-.449.95-.998a10 10 0 0 0-8.953-8.951c-.55-.055-.998.398-.998.95v8a1 1 0 0 0 1 1z"/><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/>',
  users:
    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><path d="M16 3.128a4 4 0 0 1 0 7.744"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><circle cx="9" cy="7" r="4"/>',
  layout: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/>',
  'file-text':
    '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  'bar-chart-3': '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
  'trending-up': '<path d="M16 7h6v6"/><path d="m22 7-8.5 8.5-5-5L2 17"/>',
  presentation:
    '<path d="M2 3h20"/><path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3"/><path d="m7 21 5-5 5 5"/><path d="M12 16v5"/>',
  'dollar-sign': '<line x1="12" x2="12" y1="2" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  wallet:
    '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
  'graduation-cap':
    '<path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z"/><path d="M22 10v6"/><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"/>',
  'circle-check': '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  code: '<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>',
  terminal: '<path d="m4 17 6-6-6-6"/><path d="M12 19h8"/>',
  rocket:
    '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>',
  'git-branch': '<line x1="6" x2="6" y1="3" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
  calendar: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
  lightbulb:
    '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>',
  mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
  clipboard:
    '<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  image:
    '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  landmark:
    '<path d="M10 18v-7"/><path d="M11.12 2.198a2 2 0 0 1 1.76.006l7.866 3.847c.476.233.31.949-.22.949H3.474c-.53 0-.695-.716-.22-.949z"/><path d="M14 18v-7"/><path d="M18 18v-7"/><path d="M3 22h18"/><path d="M6 18v-7"/>',
  scale:
    '<path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="M7 21h10"/><path d="M12 3v18"/><path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2"/>',
};

const A = AUTO_MODEL;
const M3 = 'arksai-max'; // Legal defaults to MiniMax M3 — bake-off winner on legal register + posh Arabic

export const DEPARTMENTS: Department[] = [
  {
    id: 'marketing',
    name: 'Marketing',
    blurb: 'Pages, campaigns, content, and reports.',
    accent: '#c0502f',
    icon: 'megaphone',
    plays: [
      { key: 'marketing.landing', title: 'Landing page', blurb: 'Conversion-focused, live.', mode: 'code', model: A, category: 'create', icon: 'layout',
        prompt: 'Build a modern, conversion-focused landing page: a strong hero (with an on-brand hero image generated by AI), a clear value proposition, three benefit sections, social proof, an FAQ, and a working sign-up/contact form. Clean, responsive, on-brand. Ask me a couple of quick questions (what we sell, the audience, a colour), then build, verify, and publish it.' },
      { key: 'marketing.emailkit', title: 'Email + social kit', blurb: 'On-brand assets to send.', mode: 'code', model: A, category: 'create', icon: 'mail',
        prompt: 'Design a small launch kit: a responsive HTML marketing email and three on-brand social post graphics — generate the visuals as real finished images (AI background + crisp headline/CTA text composited on top, not grey placeholders). Ask me for the product, the headline, and a colour, and you can upload your logo to drop onto them; then build them.' },
      { key: 'marketing.creative', title: 'Ad & social creative', blurb: 'AI images with crisp text.', mode: 'code', model: A, category: 'create', icon: 'image',
        prompt: 'Create a set of finished, ready-to-post, high-converting marketing creatives: an AI-generated on-brand background with a scroll-stopping benefit headline, a short check-marked benefit list, and one clear call-to-action laid on as crisp, perfectly-legible text — sized per channel (square 1:1, portrait 4:5, story 9:16, wide 16:9). First ask me to upload my logo and confirm my brand colour (I’ll leave a clean logo spot if I don’t have one), and ask the product/audience/offer; then generate the images and hand me the downloadable files.' },
      { key: 'marketing.blog', title: 'Blog post / article', blurb: 'An editable, structured draft.', mode: 'code', model: A, category: 'create', icon: 'file-text',
        prompt: 'Write a structured, on-brand blog post / article (an editable .docx): a strong headline, intro, well-organised sections, and a closing CTA. Tell me the topic and audience; research anything factual and cite it, never invent.' },
      { key: 'marketing.brief', title: 'Campaign brief', blurb: 'A one-page plan, in PDF.', mode: 'report', category: 'create', icon: 'clipboard',
        prompt: 'Create a polished one-page campaign brief (PDF): objective, target audience, key message, channels, timeline, and success metrics. Minimal, editorial, presentation-grade.' },
      { key: 'marketing.eventsite', title: 'Event / waitlist site', blurb: 'A microsite that captures leads.', mode: 'code', model: A, category: 'create', icon: 'calendar',
        prompt: 'Build a small event / waitlist microsite: hero with the date and details, an agenda or highlights, and a working sign-up form. Clean and on-brand. Ask me the essentials, then build and publish it.' },
      { key: 'marketing.perfreport', title: 'Performance report', blurb: 'Campaign data into a report.', mode: 'report', category: 'analyze', icon: 'bar-chart-3',
        prompt: 'Turn campaign performance data into a clean, presentation-grade report (PDF) with charts and the key takeaways. I will paste or upload the numbers; design it beautifully and flag anything missing rather than inventing figures.' },
      { key: 'marketing.competitor', title: 'Competitor teardown', blurb: 'Rivals, compared.', mode: 'report', category: 'analyze', icon: 'target',
        prompt: 'Research our competitors and produce a competitor teardown (PDF): positioning, messaging, pricing where public, strengths/gaps, and where we can win — in a clean comparison layout. Cite sources; never fabricate facts. Tell me the competitors and our product.' },
      { key: 'marketing.audience', title: 'Audience / market brief', blurb: 'Researched, cited.', mode: 'report', category: 'analyze', icon: 'search',
        prompt: 'Research a target audience or market and produce a concise brief (PDF): who they are, what they care about, where they are, and the messaging angles that land — with cited sources. Tell me the audience/market.' },
      { key: 'marketing.calendar', title: 'Content calendar', blurb: 'A month, organized.', mode: 'code', model: A, category: 'operate', icon: 'calendar',
        prompt: 'Create a monthly content/social calendar spreadsheet (.xlsx): date, channel, format, topic/headline, owner, and status — formatted with a clean header and validated. Ask me the channels and cadence, then build it.' },
      { key: 'marketing.tracker', title: 'Campaign tracker', blurb: 'Channels and results.', mode: 'code', model: A, category: 'operate', icon: 'circle-check',
        prompt: 'Create a campaign tracker spreadsheet (.xlsx): campaign, channel, budget, status, and key results — formatted and validated. Ask me what to track, then build it.' },
    ],
  },
  {
    id: 'sales',
    name: 'Sales',
    blurb: 'Decks, proposals, and account work.',
    accent: '#2f7d5b',
    icon: 'briefcase',
    plays: [
      { key: 'sales.pitchdeck', title: 'Pitch deck', blurb: 'A 16:9 deck, board-ready.', mode: 'report', category: 'create', icon: 'presentation',
        prompt: 'Create a 16:9 pitch deck (slides): problem, solution, product, market, traction, pricing, and the ask. Clean, modern, typography-first. Ask me for the company, the offer, and any numbers, then design it.' },
      { key: 'sales.pricing', title: 'Pricing one-pager', blurb: 'Tiers and the value story.', mode: 'report', category: 'create', icon: 'dollar-sign',
        prompt: 'Design a clean pricing one-pager (PDF): the tiers, what is included in each, and a short value story. Minimal and persuasive. Ask me for the tiers and prices, then build it.' },
      { key: 'sales.proposal', title: 'Proposal', blurb: 'Tailored to the deal.', mode: 'report', category: 'create', icon: 'file-text',
        prompt: 'Produce a tailored sales proposal (PDF): the prospect’s problem, our solution and scope, pricing, timeline, and next steps. Persuasive and clean. Ask me about the prospect and the offer, then design it.' },
      { key: 'sales.casestudy', title: 'Case study', blurb: 'A customer win, designed.', mode: 'report', category: 'create', icon: 'briefcase',
        prompt: 'Create a one-page customer case study (PDF): the customer, the challenge, what we did, and the results (with a metric or two). Clean and credible. Give me the details; never invent figures.' },
      { key: 'sales.outreach', title: 'Cold outreach sequence', blurb: 'A multi-touch draft.', mode: 'code', model: A, category: 'create', icon: 'mail',
        prompt: 'Write a multi-touch cold outreach sequence (an editable .docx): 4–5 short, personalised emails with subject lines and clear CTAs, plus a couple of LinkedIn notes. Tell me who we sell to and the value prop.' },
      { key: 'sales.accountbrief', title: 'Account brief', blurb: 'A prospect, researched.', mode: 'report', category: 'analyze', icon: 'search',
        prompt: 'Produce a concise account brief (PDF) for a prospect: company overview, key stakeholders, likely pain points, recent news, and our angle. Research public info and cite it; never invent facts. Give me the company.' },
      { key: 'sales.battlecard', title: 'Battlecard', blurb: 'Win the competitive deal.', mode: 'report', category: 'analyze', icon: 'target',
        prompt: 'Build a one-page sales battlecard (PDF) for a competitor: how to position against them, their strengths/weaknesses, objection handling, and our key differentiators — scannable. Research public info, cite it. Name the competitor.' },
      { key: 'sales.roi', title: 'ROI calculator', blurb: 'An interactive value tool.', mode: 'code', model: A, category: 'analyze', icon: 'trending-up',
        prompt: 'Build a simple, interactive ROI calculator web app: inputs for the customer’s current costs and our impact, outputting the savings and payback with a clean chart. Ask me for the inputs and the formula, then build and publish it.' },
      { key: 'sales.accountplan', title: 'Account plan', blurb: 'Stakeholders and actions.', mode: 'code', model: A, category: 'operate', icon: 'clipboard',
        prompt: 'Create a strategic account plan spreadsheet (.xlsx): the account’s goals, the buying committee/stakeholders, our solution map, risks, and the action plan with owners and dates — formatted and validated. Ask me about the account.' },
      { key: 'sales.pipeline', title: 'Pipeline tracker', blurb: 'Deals and next steps.', mode: 'code', model: A, category: 'operate', icon: 'bar-chart-3',
        prompt: 'Create a sales pipeline tracker spreadsheet (.xlsx): deal, stage, value, close date, owner, and next step — with a clean header, totals, and validation. Ask me what to track, then build it.' },
    ],
  },
  {
    id: 'finance',
    name: 'Finance / Strategy',
    blurb: 'Dashboards, models, and board decks.',
    accent: '#2a5a8c',
    icon: 'chart-pie',
    plays: [
      { key: 'finance.boarddeck', title: 'Board deck', blurb: 'Performance vs plan, 16:9.', mode: 'report', category: 'create', icon: 'presentation',
        prompt: 'Create a 16:9 board deck (slides): performance vs plan, the KPIs, financials, risks, and asks. Restrained and serious. Ask me for the figures, then design it; never fabricate numbers.' },
      { key: 'finance.investorupdate', title: 'Investor update', blurb: 'The monthly note, polished.', mode: 'report', category: 'create', icon: 'trending-up',
        prompt: 'Write a polished monthly investor update (PDF): highlights, key metrics, lowlights, asks, and runway. Clear and honest. I will give you the inputs; design it beautifully.' },
      { key: 'finance.strategymemo', title: 'Strategy memo', blurb: 'A researched point of view.', mode: 'report', category: 'create', icon: 'lightbulb',
        prompt: 'Write a strategy / market memo (PDF): the question, the analysis, cited benchmarks, options, and a clear recommendation. Crisp and well-structured. Tell me the topic; research and cite, never fabricate.' },
      { key: 'finance.kpidashboard', title: 'KPI dashboard', blurb: 'Metrics, interactive.', mode: 'code', model: A, category: 'analyze', icon: 'bar-chart-3',
        prompt: 'Build an interactive KPI dashboard web app from my metrics — revenue, growth, burn, runway — with charts and filters. I will paste the data (or give a CSV/Sheet link to fetch); design it cleanly, verify it works, and publish it.' },
      { key: 'finance.variance', title: 'Variance report', blurb: 'Budget vs actual.', mode: 'report', category: 'analyze', icon: 'chart-pie',
        prompt: 'Turn budget-vs-actual data into a clean variance report (PDF): the variances by line, charts, and a short narrative on what moved and why. I will provide the numbers; flag gaps rather than inventing.' },
      { key: 'finance.model', title: 'Financial model', blurb: 'Assumptions to outputs.', mode: 'code', model: A, category: 'analyze', icon: 'trending-up',
        prompt: 'Build a financial model spreadsheet (.xlsx): an assumptions block driving a simple revenue/P&L projection with monthly columns and totals — formatted, with formulas, and validated. Ask me for the drivers, then build it.' },
      { key: 'finance.cashflow', title: 'Cash-flow forecast', blurb: 'Runway, projected.', mode: 'code', model: A, category: 'analyze', icon: 'wallet',
        prompt: 'Build a cash-flow forecast spreadsheet (.xlsx): opening cash, inflows, outflows, net, and closing cash by month, with runway highlighted — formatted with formulas and validated. Ask me for the inputs, then build it.' },
      { key: 'finance.scenario', title: 'Scenario model', blurb: 'Best / base / worst.', mode: 'code', model: A, category: 'analyze', icon: 'chart-pie',
        prompt: 'Build a scenario / sensitivity model spreadsheet (.xlsx): best/base/worst cases driven by a few key assumptions, with the outputs compared side by side — formatted with formulas and validated. Ask me the drivers, then build it.' },
      { key: 'finance.budget', title: 'Budget model', blurb: 'A validated spreadsheet.', mode: 'code', model: A, category: 'operate', icon: 'wallet',
        prompt: 'Create a budgeting spreadsheet (.xlsx): monthly income, categorized expenses, and a summary of what is left — properly formatted (currency, totals) and validated. Ask me for the categories and figures, then build it.' },
      { key: 'finance.expenses', title: 'Expense tracker', blurb: 'Spend, categorized.', mode: 'code', model: A, category: 'operate', icon: 'dollar-sign',
        prompt: 'Create an expense tracker spreadsheet (.xlsx): date, category, vendor, amount, and notes, with category subtotals and a clean header — formatted and validated. Ask me the categories, then build it.' },
    ],
  },
  {
    id: 'people',
    name: 'HR / People & Ops',
    blurb: 'Hiring, onboarding, policies, and people data.',
    accent: '#7a4f93',
    icon: 'users',
    plays: [
      { key: 'people.jd', title: 'Job description', blurb: 'A clear, structured JD.', mode: 'code', model: A, category: 'create', icon: 'file-text',
        prompt: 'Write a clear, inclusive job description (an editable .docx): the role summary, responsibilities, requirements, nice-to-haves, and what we offer — well-structured. Tell me the role and level.' },
      { key: 'people.offer', title: 'Offer letter', blurb: 'A clean, editable letter.', mode: 'code', model: A, category: 'create', icon: 'mail',
        prompt: 'Draft a professional offer letter (an editable .docx): role, start date, compensation, key terms, and a warm welcome — with clearly marked placeholders for the specifics. Ask me what to fill in.' },
      { key: 'people.policy', title: 'Policy document', blurb: 'A specific HR policy.', mode: 'code', model: A, category: 'create', icon: 'clipboard',
        prompt: 'Write a clear HR policy document (an editable .docx) for the topic I give you (e.g. PTO, remote work, expenses): purpose, scope, the policy itself, and how it’s applied — well-structured and plain-language.' },
      { key: 'people.handbook', title: 'Employee handbook', blurb: 'The whole thing, editable.', mode: 'code', model: A, category: 'create', icon: 'file-text',
        prompt: 'Create a clean, editable employee handbook (.docx): values, the core policies, benefits, and ways of working — well-structured with clear headings. Ask me for our specifics, then build it.' },
      { key: 'people.training', title: 'Training guide / SOP', blurb: 'A how-to people can follow.', mode: 'report', category: 'create', icon: 'graduation-cap',
        prompt: 'Turn a process into a clear training guide / SOP (PDF): purpose, prerequisites, the steps in order with screenshots-as-placeholders, and tips/pitfalls. Tell me the process; design it cleanly.' },
      { key: 'people.survey', title: 'Engagement survey', blurb: 'A form + a results sheet.', mode: 'code', model: A, category: 'analyze', icon: 'clipboard',
        prompt: 'Build a simple employee engagement survey: a clean web form with the standard questions plus any I add, that records responses, and a results view/sheet. Ask me the questions, then build, verify, and publish it.' },
      { key: 'people.peopledash', title: 'People dashboard', blurb: 'Headcount and trends.', mode: 'code', model: A, category: 'analyze', icon: 'bar-chart-3',
        prompt: 'Build a people dashboard web app from my HR data — headcount, by team, attrition, and leave — with charts and filters. I will paste the data (or a CSV/Sheet link); design it cleanly, verify, and publish it.' },
      { key: 'people.onboardingportal', title: 'Onboarding portal', blurb: 'A new-hire home, live.', mode: 'code', model: A, category: 'operate', icon: 'graduation-cap',
        prompt: 'Build a simple new-hire onboarding portal web app: a first-week checklist, key links, team intros, and the schedule. Friendly and clear. Ask me for the content, then build, verify, and publish it.' },
      { key: 'people.onboardingchecklist', title: 'Onboarding checklist', blurb: 'A first-week plan.', mode: 'code', model: A, category: 'operate', icon: 'circle-check',
        prompt: 'Create a new-hire onboarding checklist spreadsheet (.xlsx): task, owner, due day, and status across pre-start and the first week — formatted and validated. Ask me our steps, then build it.' },
      { key: 'people.teamtracker', title: 'Team tracker', blurb: 'People and dates.', mode: 'code', model: A, category: 'operate', icon: 'users',
        prompt: 'Create a team tracker spreadsheet (.xlsx): people, roles, status, and key dates — formatted, with a clean header and validated. Ask me what to track, then build it.' },
      { key: 'people.runbook', title: 'Process runbook', blurb: 'A shareable procedure.', mode: 'report', category: 'operate', icon: 'circle-check',
        prompt: 'Turn a process into a clear runbook (PDF): purpose, the steps in order, the owners, and the escalation path. Ask me for the process, then design it cleanly.' },
    ],
  },
  {
    id: 'engineering',
    name: 'Engineering',
    blurb: 'Tools, prototypes, dashboards, and docs.',
    accent: '#1f7a8c',
    icon: 'code',
    plays: [
      { key: 'engineering.internaltool', title: 'Internal tool', blurb: 'A web app for your team.', mode: 'code', model: A, category: 'create', icon: 'code',
        prompt: 'Build an internal tool / app for the team. Tell me what it should do; I’ll design it cleanly, wire up the data, verify it works end-to-end, and publish it.' },
      { key: 'engineering.prototype', title: 'Working prototype', blurb: 'An idea, made real fast.', mode: 'code', model: A, category: 'create', icon: 'rocket',
        prompt: 'Prototype an idea as a working web app so we can try it — fast, functional, and deployed. Describe the concept and I’ll build a clickable version, verified and live.' },
      { key: 'engineering.admin', title: 'Admin panel / CRUD', blurb: 'Manage your data.', mode: 'code', model: A, category: 'create', icon: 'layout',
        prompt: 'Build an internal admin panel: list/create/edit/delete for the entities I describe, with a clean table UI and a working backend. Verify the full flow end-to-end and publish it. Tell me the entities and fields.' },
      { key: 'engineering.docssite', title: 'Docs / landing site', blurb: 'A site for a project.', mode: 'code', model: A, category: 'create', icon: 'file-text',
        prompt: 'Build a clean docs or marketing site for a project/tool: a clear hero, the key sections, and navigation. Tell me the project; I’ll design, verify, and publish it.' },
      { key: 'engineering.engmetrics', title: 'Eng-metrics dashboard', blurb: 'Delivery, visualized.', mode: 'code', model: A, category: 'analyze', icon: 'bar-chart-3',
        prompt: 'Build an engineering-metrics dashboard web app: throughput, cycle time, deploys, and incidents from the data I give you (paste or a CSV link). Clean charts and filters; verify and publish it.' },
      { key: 'engineering.datadash', title: 'Data dashboard', blurb: 'Any dataset, charted.', mode: 'code', model: A, category: 'analyze', icon: 'chart-pie',
        prompt: 'Build a data dashboard web app from a dataset — I’ll paste it or give a CSV/JSON/Sheet link to fetch. Pick the right charts, add filters, surface the key insights, verify it works, and publish it.' },
      { key: 'engineering.api', title: 'API or automation', blurb: 'A service or script that runs.', mode: 'code', model: A, category: 'analyze', icon: 'terminal',
        prompt: 'Build a small API/service or an automation script. Tell me the endpoints (or the task) and the inputs/outputs; I’ll implement it, exercise it with real requests, and hand back a runnable result.' },
      { key: 'engineering.techdoc', title: 'Technical doc', blurb: 'A README or design doc.', mode: 'code', model: A, category: 'operate', icon: 'file-text',
        prompt: 'Write clear technical documentation — a README, an architecture overview, or a how-to — well-structured with sections and examples (an editable document). Tell me the topic.' },
      { key: 'engineering.runbook', title: 'Runbook / SOP', blurb: 'Incident or ops procedure.', mode: 'report', category: 'operate', icon: 'circle-check',
        prompt: 'Turn an operational process into a clear runbook (PDF): purpose, preconditions, the steps in order, rollback, and escalation/owners. Tell me the process; design it cleanly.' },
      { key: 'engineering.designdoc', title: 'Design doc / PRD', blurb: 'Align before building.', mode: 'code', model: A, category: 'operate', icon: 'clipboard',
        prompt: 'Write a design doc / PRD (an editable document): the problem, goals and non-goals, the proposed approach, alternatives, risks, and a rollout plan — well-structured. Tell me the feature/project.' },
      { key: 'engineering.statusreport', title: 'Sprint / status report', blurb: 'What shipped, summarized.', mode: 'report', category: 'operate', icon: 'bar-chart-3',
        prompt: 'Turn sprint/status data into a clean status report (PDF): what shipped, what’s in progress, risks/blockers, and what’s next — with a chart or two. I’ll give you the inputs; flag gaps rather than inventing.' },
      { key: 'engineering.schema', title: 'Database schema', blurb: 'Tables, keys, migrations.', mode: 'code', model: A, category: 'create', icon: 'git-branch',
        prompt: 'Design a normalized database schema from my requirements: entities, relationships, keys, constraints, and the right indexes — plus a Mermaid ERD, the DDL, and a migration plan, delivered as a clean, typography-first design document. Tell me what the system needs to store.' },
      { key: 'engineering.apidesign', title: 'API design & review', blurb: 'A clean REST contract.', mode: 'code', model: A, category: 'create', icon: 'terminal',
        prompt: 'Design (or review) a REST API: resources, versioning, pagination, idempotency, a consistent error shape, status codes, and auth — to clean conventions. Deliver it as a designed API reference document. Describe the API or paste the spec/endpoints.' },
      { key: 'engineering.apitests', title: 'API test suite', blurb: 'Happy-path, edge, auth.', mode: 'code', model: A, category: 'analyze', icon: 'circle-check',
        prompt: 'Build a comprehensive, ready-to-run API test suite — happy path, input validation, the auth matrix (no/invalid/expired token, wrong role), error codes, and contract checks — then exercise it and report the results. Describe the API or point me at the routes.' },
      { key: 'engineering.codereview', title: 'Code review', blurb: 'Bugs, security, fixes.', mode: 'code', model: A, category: 'analyze', icon: 'search',
        prompt: 'Do a structured code review — correctness, security, readability, and performance — with severity-tagged findings and a concrete fix for each, delivered as a clean, typography-first review report. Paste the code/diff or point me at the files (or a PR).' },
      { key: 'engineering.depaudit', title: 'Dependency audit', blurb: 'Risky & outdated deps.', mode: 'code', model: A, category: 'operate', icon: 'file-text',
        prompt: 'Audit my project’s dependencies: flag floating/unpinned ranges, duplicates, pre-1.0 pins, and a missing lockfile, then give a risk-ordered upgrade plan — delivered as a designed audit report. (I’ll be honest that an offline pass can’t see live CVEs and tell you to pair it with npm audit / pip-audit.) Paste your package.json or requirements.txt, or point me at the file.' },
    ],
  },
  {
    id: 'bi',
    name: 'BI & Analytics',
    blurb: 'Dashboards, analyses, and automated reporting.',
    accent: '#9d3a63',
    icon: 'bar-chart-3',
    plays: [
      { key: 'bi.dashboard', title: 'BI dashboard', blurb: 'Live KPIs, F-pattern.', mode: 'code', model: A, category: 'create', icon: 'bar-chart-3',
        prompt: 'Build an interactive BI dashboard web app from my metrics: the headline KPIs up top (with period-over-period change), trend charts, and a couple of filters. I’ll paste the data or give a CSV/JSON/published-Sheet link to fetch — never invent numbers. Ask me what to track and a colour, then design it cleanly (5–7 key KPIs, F-pattern), verify it works, and publish it.' },
      { key: 'bi.explorer', title: 'Self-serve explorer', blurb: 'Slice it yourself.', mode: 'code', model: A, category: 'create', icon: 'layout',
        prompt: 'Build a self-serve data explorer web app a non-analyst can use: filters for date/segment/region that update a chart and a data table, sensible defaults, and an export. I’ll paste the dataset or give a CSV/Sheet link. Ask me the dimensions to slice by, then build, verify, and publish it.' },
      { key: 'bi.reviewdeck', title: 'Business review deck', blurb: 'MBR/QBR, 16:9.', mode: 'report', category: 'create', icon: 'presentation',
        prompt: 'Create a monthly/quarterly business review deck (16:9 slides): performance vs plan, the key KPIs, what moved and why, risks, and the asks — each slide led by its takeaway. I’ll give you the numbers; design it cleanly and never fabricate figures.' },
      { key: 'bi.datadict', title: 'Metric dictionary', blurb: 'One agreed definition.', mode: 'code', model: A, category: 'create', icon: 'file-text',
        prompt: 'Create a metric dictionary (an editable .docx): one entry per KPI with its plain-language definition, exact formula/logic (numerator, denominator, filters), grain, source, owner, and refresh cadence — so everyone uses one agreed definition. Ask me the metrics (or paste a list), then build it.' },
      { key: 'bi.adhoc', title: 'Ad-hoc analysis', blurb: 'Answer one question.', mode: 'report', category: 'analyze', icon: 'search',
        prompt: 'Answer a specific business question with an analysis (PDF): state the question, the method, and the answer up front, then the cuts that matter (funnel / segment / breakdown) with charts, and end with the recommended action. I’ll paste the data or give a link; flag gaps rather than inventing. Tell me the question.' },
      { key: 'bi.cohort', title: 'Cohort / retention analysis', blurb: 'Retention over time.', mode: 'report', category: 'analyze', icon: 'trending-up',
        prompt: 'Run a cohort / retention analysis (PDF): build cohorts by start period, show retention or behaviour over time, call out where and why it drops, and the implication. I’ll provide the data (paste or a link); define the cohort and the event with me first, then analyse — never fabricate.' },
      { key: 'bi.insight', title: 'Insight narrative', blurb: 'What changed, and why.', mode: 'report', category: 'analyze', icon: 'lightbulb',
        prompt: 'Turn a dataset into an insight narrative (PDF): surface what actually changed — the biggest movers, trends, and outliers — and explain each in plain language with the number and the “so what”, ranked by impact. I’ll paste the data or give a link; no claim without the data behind it.' },
      { key: 'bi.forecast', title: 'Forecast / what-if model', blurb: 'Drivers to projection.', mode: 'code', model: A, category: 'analyze', icon: 'chart-pie',
        prompt: 'Build a driver-based forecast / what-if model (.xlsx): an assumptions block driving a monthly projection of the metric (e.g. demand, traffic, revenue), with a high/base/low view — fully formula-driven so changing a driver flows through. Ask me the drivers and history, then build it; never hard-code the projected numbers.' },
      { key: 'bi.scorecard', title: 'KPI scorecard', blurb: 'KPIs vs targets.', mode: 'code', model: A, category: 'operate', icon: 'target',
        prompt: 'Build a KPI scorecard web app: each KPI with its current value, target, period-over-period change, and a clear on/off-track status, grouped by objective — scannable at a glance. I’ll paste the data or give a link. Ask me the KPIs and targets, then build, verify, and publish it (and you can put it on a schedule to refresh).' },
      { key: 'bi.digest', title: 'Recurring metrics digest', blurb: 'A scheduled summary.', mode: 'report', category: 'operate', icon: 'calendar',
        prompt: 'Create a recurring metrics digest (PDF) built to be sent on a schedule: the headline numbers, the key movers vs last period, one clear chart, and the one thing to act on — the same tight structure each run so it’s comparable. I’ll give you the data source. Set it up so it can run on the Scheduled feature.' },
      { key: 'bi.alert', title: 'KPI alert / monitor', blurb: 'Flag what matters.', mode: 'code', model: A, category: 'operate', icon: 'circle-check',
        prompt: 'Set up a KPI monitor: pull the latest data, check the threshold/condition I set, and raise a clear signal only when it matters — post to a Slack/webhook URL I provide (or surface it) with the metric, the value, the threshold, and the change. Ask me the metric, the source, and the threshold, then build it (schedulable for recurring checks). Avoid noise — alert only on what’s actionable.' },
    ],
  },
  {
    id: 'tax',
    name: 'Tax & Compliance (UAE)',
    blurb: 'VAT, e-invoicing, Corporate Tax, Excise & WPS — done right.',
    accent: '#9a6a24',
    icon: 'landmark',
    plays: [
      { key: 'tax.guided', title: 'Guided filing (step by step)', blurb: 'Walk me through a filing.', mode: 'code', model: A, category: 'operate', icon: 'circle-check',
        prompt: 'Walk me through a UAE filing step by step. Ask me which one — VAT 201, an e-invoice (PINT AE), Corporate Tax, Excise, or a WPS salary file — then take it one step at a time: my entity details (legal name, 15-digit TRN, mainland or free zone), the tax period and its deadline, then collect and validate my data (I’ll paste it, upload it, or give a link — never invent a number, flag anything missing), build each required document and validate it, and finish with a review checklist and the filing pack plus exactly where to submit it. This is a draft for professional review — I’ll submit via EmaraTax / my accredited service provider / my WPS agent bank.' },
      { key: 'tax.tax_invoice', title: 'Tax invoice', blurb: 'A compliant FTA invoice.', mode: 'code', model: A, category: 'create', icon: 'file-text',
        prompt: 'Create a UAE-compliant tax invoice (an editable document I can reuse): the words “Tax Invoice”, a unique number and date, my company name/address/15-digit TRN, the customer’s name/address/TRN, line items with unit price, quantity, VAT rate and VAT amount, and the net / VAT / gross totals in AED. Ask me the details — never invent figures. Offer to also produce the structured PINT AE e-invoice XML.' },
      { key: 'tax.einvoice', title: 'E-invoice (PINT AE)', blurb: 'UBL XML + a readable copy.', mode: 'code', model: A, category: 'create', icon: 'code',
        prompt: 'Create a UAE e-invoice in the PINT AE format: the structured UBL 2.1 XML (seller and buyer with 15-digit TRNs, lines, VAT category codes, and totals that reconcile — validated for me) PLUS a human-readable copy of the same invoice. Ask me for the invoice details; never fabricate. Remind me this is validated by my accredited service provider (ASP) before live submission.' },
      { key: 'tax.vat_return', title: 'VAT return (VAT 201)', blurb: 'Working papers + FAF.', mode: 'code', model: A, category: 'analyze', icon: 'clipboard',
        prompt: 'Build my UAE VAT 201 return as a formula-driven spreadsheet that mirrors the official boxes exactly (standard-rated supplies split by Emirate, zero-rated, exempt, imports, the output and input totals, and the net VAT payable), and offer to also produce the FAF audit file. I’ll give you the figures or a data link — reconcile the totals and flag any gaps; never plug a number.' },
      { key: 'tax.ct_return', title: 'Corporate Tax (CT)', blurb: 'The 9% computation.', mode: 'code', model: A, category: 'analyze', icon: 'chart-pie',
        prompt: 'Build my UAE Corporate Tax computation as a formula-driven spreadsheet: accounting profit → add-backs and exempt-income adjustments → taxable income → 0% on the first AED 375,000 and 9% above, with Small Business Relief and the free-zone (QFZP) 0% shown as switchable lines, plus a related-party / transfer-pricing disclosure if my related-party transactions exceed the threshold. I’ll provide the financials — never fabricate adjustments.' },
      { key: 'tax.readiness', title: 'Compliance readiness', blurb: 'Obligations, gaps, deadlines.', mode: 'report', category: 'analyze', icon: 'search',
        prompt: 'Assess my UAE tax & compliance readiness (a clean PDF): profile my entity (legal form, mainland vs free zone, TRNs held, revenue tier, headcount), map every obligation and its deadline — VAT, e-invoicing (which PINT AE phase + the ASP-onboarding steps), Corporate Tax, Excise, WPS — and give me a gap analysis and a dated action plan. Tell me about the company; cite the obligation, never guess.' },
      { key: 'tax.wps', title: 'WPS salary file', blurb: 'A validated .sif + recon.', mode: 'code', model: A, category: 'operate', icon: 'users',
        prompt: 'Create my MOHRE WPS salary file (.sif): build the header and one record per employee, compute and reconcile the control total to the fils, and validate the employer ID, routing codes, 23-char IBANs and amounts for me — then pair it with a payroll reconciliation spreadsheet. I’ll give you the payroll (paste, upload, or a link); never invent an amount. (DIFC/ADGM use their own systems — I’ll flag that.)' },
      { key: 'tax.excise_return', title: 'Excise tax return', blurb: 'Quantities × price × rate.', mode: 'code', model: A, category: 'operate', icon: 'wallet',
        prompt: 'Build my UAE Excise tax return working paper as a formula-driven spreadsheet: one row per excise good with quantity, the excise price and the rate (50% on carbonated/sweetened drinks, 100% on tobacco, energy drinks and e-cigarettes), the per-category subtotals and the total excise payable. I’ll give you the figures — never invent quantities or prices.' },
      { key: 'tax.faf', title: 'FAF audit file', blurb: 'The FTA VAT audit file.', mode: 'code', model: A, category: 'operate', icon: 'file-text',
        prompt: 'Create my FTA VAT Audit File (FAF): the company block, my supplies and purchases, and the totals — reconciled to my VAT 201 output and input VAT and validated for me. I’ll paste the transactions or give a data link; never fabricate a row. I’ll validate it against the current FTA FAF spec before submitting.' },
    ],
  },
  {
    id: 'legal',
    name: 'Legal (UAE)',
    blurb: 'Contracts, notices, opinions & filings — drafted to sign.',
    accent: '#7a2e3b',
    icon: 'scale',
    plays: [
      { key: 'legal.contract', title: 'Commercial contract', blurb: 'Execution-ready, bilingual.', mode: 'code', model: M3, category: 'create', icon: 'file-text',
        prompt: 'Draft a UAE commercial contract (in formal British English by default — tell me if it must be bilingual for notarisation or filing). Ask me the essentials first: the parties, the jurisdiction (mainland, a free zone, DIFC or ADGM), the subject and scope, the consideration and payment terms, and how disputes should be resolved — then give me an execution-ready agreement with full clauses, boilerplate, schedules and signature blocks, and bracketed placeholders for anything I haven’t provided. Cite the governing law; never invent facts or figures; a licensed UAE lawyer must review and sign.' },
      { key: 'legal.nda', title: 'NDA / confidentiality', blurb: 'Mutual or one-way.', mode: 'code', model: M3, category: 'create', icon: 'file-text',
        prompt: 'Draft a UAE non-disclosure agreement (in English by default). Ask whether it is mutual or one-way, the parties and the jurisdiction, then produce an execution-ready NDA — definition of Confidential Information, permitted use, exclusions, term and survival, return/destruction, and remedies including injunctive relief. Bracketed placeholders for specifics; a licensed UAE lawyer must review and sign.' },
      { key: 'legal.employment', title: 'Employment contract', blurb: 'MOHRE / DIFC / ADGM / free zone.', mode: 'code', model: M3, category: 'create', icon: 'users',
        prompt: 'Draft a UAE employment contract and offer letter (bilingual if it is an onshore MOHRE contract, otherwise English). Ask the regime (MOHRE onshore / DIFC / ADGM / free zone), the role, salary, probation, notice and any non-compete, then produce an execution-ready contract compliant with the governing employment law (cite it), with end-of-service gratuity and a non-compete within the legal limits. Placeholders for specifics; a licensed UAE lawyer must review and sign.' },
      { key: 'legal.poa', title: 'Power of Attorney', blurb: 'Notary-ready, bilingual.', mode: 'code', model: M3, category: 'create', icon: 'file-text',
        prompt: 'Draft a Power of Attorney (bilingual, notary-ready). Ask the type (corporate / litigation / property / banking), the grantor and attorney, and the powers to be granted — then produce a scoped POA with clearly enumerated powers, duration and revocation, formatted for notarisation. Flag that it must be notarised (Notary Public / UAE Pass) and attested via MOFAIC if used abroad; a licensed UAE lawyer must review and sign.' },
      { key: 'legal.corporate', title: 'MOA + Shareholders’ Agreement', blurb: 'Per the 2025 amendments.', mode: 'code', model: M3, category: 'create', icon: 'landmark',
        prompt: 'Draft an LLC Memorandum & Articles of Association plus a Shareholders’ Agreement (the notarised MOA bilingual; the shareholders’ agreement in English), reflecting the 2025 Companies-Law amendments (Federal Decree-Law 32/2021 as amended by 20/2025): multiple share classes, drag-along/tag-along, pre-emption, reserved matters, deadlock and exit. Ask me the shareholders, the shareholding and the key terms; placeholders for the rest. Flag the MOA notarisation requirement; a licensed UAE lawyer must review and sign.' },
      { key: 'legal.resolution', title: 'Resolutions & minutes', blurb: 'Board / shareholder.', mode: 'code', model: M3, category: 'create', icon: 'clipboard',
        prompt: 'Draft board / shareholder resolutions and minutes (in English by default). Ask what is being resolved (appointments, banking mandate, approvals, capital, dividends) and the company details, then produce a clean resolution and minutes record with quorum and signature blocks. A licensed UAE lawyer must review and sign.' },
      { key: 'legal.notice', title: 'Legal notice / demand', blurb: 'Letter before action.', mode: 'report', model: M3, category: 'create', icon: 'scale',
        prompt: 'Draft a formal legal notice — a letter before action / demand / cease-and-desist (a designed document — bilingual only if it will be served via the Notary or filed in court). Ask me the parties, the facts, the grounds and the demand and deadline, then produce an authoritative notice citing the contractual or statutory basis (by article), with a reservation of rights ("without prejudice") and a notary-ready format. Never invent facts or figures; a licensed UAE lawyer must review and sign before service.' },
      { key: 'legal.policereport', title: 'Police report / complaint', blurb: 'Criminal complaint, bilingual.', mode: 'report', model: M3, category: 'create', icon: 'file-text',
        prompt: 'Help me draft a police report / criminal complaint for filing in the UAE (a designed, bilingual document). Ask me the complainant and respondent, what happened (with dates), and the evidence — then produce a precise, chronological statement of facts, identify the offence and its legal basis (the Penal Code, Federal Decree-Law 31/2021, or the Cybercrime Law 34/2021, by article), and state the relief sought. Note it is lodged via the police (station / smart-police app / the relevant Public Prosecution) and should be settled with a lawyer; never invent facts.' },
      { key: 'legal.opinion', title: 'Legal opinion / memo', blurb: 'Advice with conviction.', mode: 'report', model: M3, category: 'create', icon: 'scale',
        prompt: 'Write a formal legal opinion / memorandum of advice on a UAE-law question (a designed document, in English by default). Ask me the question and the material facts, then give the applicable law (cited by article), a reasoned analysis weighing it both ways, a clear conclusion stated with appropriate conviction, and the caveats and assumptions. Authoritative, but a draft for the supervising lawyer; never fabricate law or facts.' },
      { key: 'legal.review', title: 'Contract review & risk', blurb: 'Clause-by-clause redlines.', mode: 'report', model: M3, category: 'analyze', icon: 'clipboard',
        prompt: 'Review a contract against UAE law and give me a risk report (a designed document, in English by default). I’ll paste or upload the contract — analyse it clause by clause: missing protections, one-sided or unenforceable terms, the governing-law/forum clause, and a ranked risk register with concrete redline wording for each issue (the problem and the suggested fix). Cite the law; flag where a lawyer must decide.' },
      { key: 'legal.forensic', title: 'Legal forensic audit', blurb: 'Findings, evidence, exposure.', mode: 'report', model: M3, category: 'analyze', icon: 'search',
        prompt: 'Produce a legal forensic audit report (a designed, exhibit-referenced PDF). Tell me the matter (suspected fraud, financial irregularity, breach, compliance failure) and give me the documents or data — I’ll set out the scope and methodology, a documented chronology and the evidence, the legal analysis against UAE law (by article), findings stated with conviction, quantified exposure, and prioritised recommendations (remediation, recovery, referral). Never invent evidence or figures; a licensed UAE lawyer must review.' },
      { key: 'legal.compliance', title: 'Compliance audit', blurb: 'UBO, AML, data, licensing.', mode: 'report', model: M3, category: 'analyze', icon: 'search',
        prompt: 'Run a corporate legal compliance audit (a designed PDF). Tell me about the entity — I’ll assess UBO (Federal Decree-Law 10/2025 + Cabinet Resolution 134/2025), AML/goAML (if a DNFBP), data protection (PDPL / DIFC / ADGM), licensing and ESR-legacy, then give a gap analysis and a dated remediation plan, cross-referring Tax for Corporate Tax/VAT. Cite each obligation; never guess.' },
      { key: 'legal.dispute', title: 'Dispute position brief', blurb: 'Merits, limitation, forum.', mode: 'report', model: M3, category: 'analyze', icon: 'scale',
        prompt: 'Give me a dispute position brief (a designed document). Tell me the dispute — I’ll lay out the merits, the limitation position (15 years onshore vs 6 years in the DIFC), the forum options (onshore courts / DIFC / ADGM / DIAC arbitration), and an indicative cost/time view — clearly framed as information to brief a lawyer, not as advice.' },
      { key: 'legal.licensing', title: 'Licensing & jurisdiction', blurb: 'Mainland vs free zone vs DIFC/ADGM.', mode: 'report', model: M3, category: 'analyze', icon: 'landmark',
        prompt: 'Advise on licensing and the right jurisdiction (a designed document). Tell me the activity — I’ll map the required licences and approvals and recommend mainland vs free zone vs DIFC/ADGM with the trade-offs (ownership, tax, courts, cost, substance), citing the regulator for each step.' },
      { key: 'legal.calendar', title: 'Legal calendar & tracker', blurb: 'Renewals, UBO, AGM, filings.', mode: 'code', model: M3, category: 'operate', icon: 'calendar',
        prompt: 'Build me a corporate legal calendar and filing tracker (a formula-driven spreadsheet): licence renewals, UBO updates (within 15 days of any change), AGM/board cadence, trademark renewals, and contract expiry/notice windows — with owner, due date, status and lead time per item. I’ll give you the dates; never invent one, and mark anything missing.' },
    ],
  },
  {
    id: 'personal',
    name: 'Personal',
    blurb: 'Money, writing, big purchases, and plans — for everyday life.',
    accent: '#3a7d6b',
    icon: 'wallet',
    plays: [
      { key: 'personal.budget', title: 'My monthly budget', blurb: 'See what’s left each month.', mode: 'code', model: A, category: 'create', icon: 'wallet',
        prompt: 'Help me make a simple personal/household monthly budget (a spreadsheet): my income at the top, everyday categories (rent, groceries, transport, bills, subscriptions, fun, savings), and a clear “what’s left this month” — built with live formulas so changing one number updates everything. Ask me my income and the main things I spend on, then build it; never invent my numbers.' },
      { key: 'personal.savings', title: 'Savings / debt plan', blurb: 'A realistic plan to your goal.', mode: 'code', model: A, category: 'create', icon: 'trending-up',
        prompt: 'Help me build a realistic savings or debt-payoff plan: ask me my goal (an amount to save, or being debt-free), my timeline, and what I can set aside each month, then lay out a month-by-month plan, the smart order to pay things off, and the date I’ll get there — and tell me honestly if the timeline is realistic. Never invent my balances; ask.' },
      { key: 'personal.valuation', title: 'Should I buy / sell?', blurb: 'Real prices, a clear verdict.', mode: 'report', model: A, category: 'analyze', icon: 'search',
        prompt: 'Help me decide whether to buy or sell something (a car, phone, home, or any product) — research real current listings/prices for the exact item (tell me the make/model/year/condition/mileage and my region), cite each source, and give me a fair buy range, a realistic resale range, the key things that move the price, and a plain verdict (good deal / overpriced / hold) with your reasoning. Never make a price up; if you can’t find comparables, say so.' },
      { key: 'personal.resume', title: 'Résumé / CV', blurb: 'Clean, ATS-friendly, strong.', mode: 'code', model: A, category: 'create', icon: 'file-text',
        prompt: 'Help me build a clean, ATS-friendly résumé / CV (an editable document): strong, quantified action-verb bullets, the right sections, and tailored to the role I’m going for. Ask me about my experience and the job, then draft it with clearly marked placeholders for anything I haven’t given you; never invent jobs or dates.' },
      { key: 'personal.coverletter', title: 'Cover letter', blurb: 'Tailored and specific.', mode: 'code', model: A, category: 'create', icon: 'mail',
        prompt: 'Write me a tailored, one-page cover letter (an editable document): a specific hook for why this role and company, my relevant achievements mapped to what they need, and a confident close. Ask me the role, the company, and a couple of my wins; mark placeholders for the rest and never invent experience.' },
      { key: 'personal.complaintletter', title: 'Complaint / dispute letter', blurb: 'Firm, polite, effective.', mode: 'code', model: A, category: 'create', icon: 'mail',
        prompt: 'Write me a firm but polite complaint / dispute letter (an editable document): the facts (with dates and reference numbers), the specific problem, exactly what I want done and by when, and a calm escalation line. Tell me what happened and what you want fixed; I’ll draft it — never invent facts.' },
      { key: 'personal.letter', title: 'Formal letter', blurb: 'The right register, done.', mode: 'code', model: A, category: 'create', icon: 'file-text',
        prompt: 'Write me a formal letter (an editable document) in the right register and structure for its purpose — sender/recipient, date, a clear subject and a concise body, and a proper sign-off. Tell me who it’s to and what it needs to say; mark placeholders for specifics and never invent facts.' },
      { key: 'personal.emailrewrite', title: 'Rewrite my email', blurb: 'Clearer, better tone.', mode: 'chat', model: A, category: 'create', icon: 'mail',
        prompt: 'Help me rewrite and polish a message or email — paste it in and tell me the goal (more professional, warmer, firmer, shorter, clearer). I’ll keep your meaning exactly but fix the tone, clarity, grammar, and brevity, and make the ask obvious — without adding anything you didn’t say.' },
      { key: 'personal.trip', title: 'Trip itinerary', blurb: 'A realistic day-by-day plan.', mode: 'report', model: A, category: 'create', icon: 'calendar',
        prompt: 'Plan me a realistic day-by-day trip itinerary: tell me the destination, dates, who’s going, and a rough budget, and I’ll group the days sensibly by area, mix must-sees with downtime, add rough timings and getting-around notes, and flag costs as estimates (never invented). I’ll note anything seasonal or worth booking ahead.' },
      { key: 'personal.event', title: 'Event / party plan', blurb: 'Checklist, timeline, budget.', mode: 'code', model: A, category: 'operate', icon: 'circle-check',
        prompt: 'Help me plan an event or party: tell me the occasion, the date, the headcount, and a budget, and I’ll give you a clear checklist and timeline working back from the day, a simple budget with estimates, and a supplies/shopping list. Practical and realistic; I’ll mark any prices to confirm rather than invent them.' },
      { key: 'personal.checklist', title: 'Personal checklist', blurb: 'A plan you won’t forget.', mode: 'code', model: A, category: 'operate', icon: 'clipboard',
        prompt: 'Make me a clear personal checklist / plan for the thing I’m doing (moving house, a big trip, a project) — the steps and items in a sensible order, grouped logically, with due-dates or owners where it helps. Tell me the task; I’ll think through what’s easy to forget and build it as a clean, editable list.' },
    ],
  },
  {
    id: 'learning',
    name: 'Learning',
    blurb: 'Explain it, study it, summarize it — pitched to your level.',
    accent: '#4a6fa5',
    icon: 'graduation-cap',
    plays: [
      { key: 'learning.explainer', title: 'Explain a concept', blurb: 'At exactly your level.', mode: 'chat', model: A, category: 'create', icon: 'lightbulb',
        prompt: 'Explain a concept to me clearly — tell me the topic and your level (a 10-year-old, a beginner, an expert), and I’ll lead with a plain-language intuition, give a concrete example or analogy, then the precise detail, and finish with a quick recap. Accurate above all; I’ll define terms as I go and never make facts up.' },
      { key: 'learning.studyguide', title: 'Study guide / notes', blurb: 'Structured, scannable, with practice.', mode: 'code', model: A, category: 'create', icon: 'graduation-cap',
        prompt: 'Make me a study guide / revision notes (an editable document): organised by topic with clear headings, the key points distilled (must-knows in bold), worked examples, handy memory aids, and a short set of practice questions with answers. Tell me the subject and what to cover (or paste the material); I’ll keep it faithful and never invent facts.' },
      { key: 'learning.summarize', title: 'Summarize this', blurb: 'Faithful, structured, honest.', mode: 'chat', model: A, category: 'analyze', icon: 'file-text',
        prompt: 'Summarize a document or text for me — paste it in and tell me how short you want it. I’ll give you a one-line TL;DR, then the key points as scannable bullets grouped by theme, keep the critical numbers and dates exact, and flag anything ambiguous or missing — only what the text actually says, never invented.' },
    ],
  },
];

export function departmentById(id: string | null | undefined): Department | undefined {
  return DEPARTMENTS.find((d) => d.id === id);
}
