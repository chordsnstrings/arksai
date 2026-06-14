import type { SessionMode } from '@shared/types';
import { AUTO_MODEL } from '@shared/types';

/**
 * The department-aware catalog. ArksAI for companies: each corporate function
 * gets its own language, curated "plays" (ready-to-run briefs), and a restrained
 * accent. This is the differentiator — not a generic one-box maker, but a studio
 * organized around the teams that use it. Pure data so adding functions
 * (Product, Support, Legal…) later — or promoting them to per-org templates — is
 * trivial.
 */

export interface Play {
  title: string;
  blurb: string;
  /** A real, ready-to-run brief sent as the first message. */
  prompt: string;
  /** Routes to the right engine. 'report' → PDFs/decks; 'code' → apps, sheets, docs. */
  mode: SessionMode;
  model?: string;
  icon: IconName;
}

export interface Department {
  id: string;
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
  | 'circle-check';

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
};

export const DEPARTMENTS: Department[] = [
  {
    id: 'marketing',
    name: 'Marketing',
    blurb: 'Pages, campaigns, and reports that ship.',
    accent: '#c0502f',
    icon: 'megaphone',
    plays: [
      {
        title: 'Landing page',
        blurb: 'Conversion-focused, on-brand, live.',
        mode: 'code',
        model: AUTO_MODEL,
        icon: 'layout',
        prompt:
          'Build a modern, conversion-focused landing page: a strong hero, a clear value proposition, three benefit sections, social-proof, an FAQ, and a working sign-up / contact form. Clean, responsive, on-brand. Ask me a couple of quick questions first (what we sell, the audience, a colour preference), then build and publish it.',
      },
      {
        title: 'Campaign one-pager',
        blurb: 'A polished brief, in PDF.',
        mode: 'report',
        icon: 'file-text',
        prompt:
          'Create a polished one-page campaign brief as a PDF: objective, target audience, key message, channels, timeline, and the success metrics. Minimal, editorial, presentation-grade.',
      },
      {
        title: 'Launch / performance report',
        blurb: 'Data into a clean report.',
        mode: 'report',
        icon: 'bar-chart-3',
        prompt:
          'Turn campaign performance data into a clean, presentation-grade report (PDF) with charts and the key takeaways. I will paste or upload the numbers; design it beautifully and flag anything missing rather than inventing figures.',
      },
      {
        title: 'Email + social kit',
        blurb: 'On-brand assets, ready to send.',
        mode: 'code',
        model: AUTO_MODEL,
        icon: 'megaphone',
        prompt:
          'Design a small launch kit: a responsive HTML marketing email and three on-brand social post graphics for a product launch. Ask me for the product, the headline, and a colour, then build them.',
      },
    ],
  },
  {
    id: 'sales',
    name: 'Sales',
    blurb: 'Decks and one-pagers that close.',
    accent: '#2f7d5b',
    icon: 'briefcase',
    plays: [
      {
        title: 'Pitch deck',
        blurb: 'A 16:9 deck, board-ready.',
        mode: 'report',
        icon: 'presentation',
        prompt:
          'Create a 16:9 pitch deck (slides): problem, solution, product, market, traction, pricing, and the ask. Clean, modern, typography-first. Ask me for the company, the offer, and any numbers, then design it.',
      },
      {
        title: 'Pricing one-pager',
        blurb: 'Tiers and the value story.',
        mode: 'report',
        icon: 'dollar-sign',
        prompt:
          'Design a clean pricing one-pager (PDF): the tiers, what is included in each, and a short value story. Minimal and persuasive. Ask me for the tiers and prices, then build it.',
      },
      {
        title: 'Account brief',
        blurb: 'A prospect, summarized.',
        mode: 'report',
        icon: 'briefcase',
        prompt:
          'Produce a concise account brief (PDF) for a prospect: company overview, key stakeholders, likely pain points, and our angle. I will give you the prospect; research public info and cite sources, never invent facts.',
      },
      {
        title: 'ROI calculator',
        blurb: 'An interactive value tool.',
        mode: 'code',
        model: AUTO_MODEL,
        icon: 'trending-up',
        prompt:
          'Build a simple, interactive ROI calculator web app: inputs for the customer’s current costs and our impact, and it outputs the savings and payback period with a clean chart. Ask me for the inputs and the formula, then build and publish it.',
      },
    ],
  },
  {
    id: 'finance',
    name: 'Finance / Strategy',
    blurb: 'Dashboards, models, and board decks.',
    accent: '#2a5a8c',
    icon: 'chart-pie',
    plays: [
      {
        title: 'KPI dashboard',
        blurb: 'Metrics, interactive.',
        mode: 'code',
        model: AUTO_MODEL,
        icon: 'bar-chart-3',
        prompt:
          'Build an interactive KPI dashboard web app from my metrics — revenue, growth, burn, runway — with charts and filters. I will paste the data; design it cleanly, verify it works, and publish it.',
      },
      {
        title: 'Board deck',
        blurb: 'Performance vs plan, in 16:9.',
        mode: 'report',
        icon: 'presentation',
        prompt:
          'Create a 16:9 board deck (slides): performance vs plan, the KPIs, financials, risks, and asks. Restrained and serious. Ask me for the figures, then design it; never fabricate numbers.',
      },
      {
        title: 'Budget model',
        blurb: 'A formatted, validated spreadsheet.',
        mode: 'code',
        model: AUTO_MODEL,
        icon: 'wallet',
        prompt:
          'Create a budgeting spreadsheet (.xlsx): monthly income, categorized expenses, and a summary of what is left — properly formatted (currency, totals) and validated. Ask me for the categories and figures, then build it.',
      },
      {
        title: 'Investor update',
        blurb: 'The monthly note, polished.',
        mode: 'report',
        icon: 'trending-up',
        prompt:
          'Write a polished monthly investor update (PDF): highlights, the key metrics, lowlights, asks, and runway. Clear and honest. I will give you the inputs; design it beautifully.',
      },
    ],
  },
  {
    id: 'people',
    name: 'HR / People & Ops',
    blurb: 'Handbooks, portals, and trackers.',
    accent: '#7a4f93',
    icon: 'users',
    plays: [
      {
        title: 'Employee handbook',
        blurb: 'An editable, on-brand doc.',
        mode: 'code',
        model: AUTO_MODEL,
        icon: 'file-text',
        prompt:
          'Create a clean, editable employee handbook (.docx): values, the core policies, benefits, and ways of working — well-structured with clear headings. Ask me for our specifics, then build it.',
      },
      {
        title: 'Onboarding portal',
        blurb: 'A new-hire home, live.',
        mode: 'code',
        model: AUTO_MODEL,
        icon: 'graduation-cap',
        prompt:
          'Build a simple new-hire onboarding portal web app: a first-week checklist, key links, team intros, and the schedule. Friendly and clear. Ask me for the content, then build, verify, and publish it.',
      },
      {
        title: 'Team tracker',
        blurb: 'People and dates, organized.',
        mode: 'code',
        model: AUTO_MODEL,
        icon: 'users',
        prompt:
          'Create a team tracker spreadsheet (.xlsx): people, roles, status, and the key dates — formatted, with a clean header and validated. Ask me what to track, then build it.',
      },
      {
        title: 'Process runbook',
        blurb: 'A clear, shareable procedure.',
        mode: 'report',
        icon: 'circle-check',
        prompt:
          'Turn a process into a clear runbook (PDF): purpose, the steps in order, the owners, and the escalation path. Ask me for the process, then design it cleanly.',
      },
    ],
  },
];

export function departmentById(id: string | null | undefined): Department | undefined {
  return DEPARTMENTS.find((d) => d.id === id);
}
