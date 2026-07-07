import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';

/**
 * Server-side per-route META injection for the public marketing pages.
 *
 * The app is a client-rendered SPA, but crawlers and social/link-preview bots
 * (Reddit, X, LinkedIn, WhatsApp, Slack, Google, answer-engines) do NOT run JS —
 * they read the HTML <head> as served. So for the marketing routes we inject the
 * right <title>/description/canonical/OpenGraph per path into the built index.html
 * before sending it, so a shared /for/finance link previews as the Finance page,
 * not the generic homepage. App routes (/s/<id>, /operator, …) get the plain SPA.
 */

const BASE = 'https://arksai.studio';
const OG_IMAGE = `${BASE}/og-cover.png`;

export interface RouteMeta {
  title: string;
  description: string;
  /** og:/twitter: title; falls back to `title` (minus the brand suffix) if unset. */
  ogTitle?: string;
}

// The per-vertical marketing pages. Keyword-rich, UAE-positioned, distinct per team.
export const MARKETING_ROUTES: Record<string, RouteMeta> = {
  '/': {
    title: 'ArksAI — Hire an AI Employee for Your UAE Business | Apps, Reports & Compliance',
    description:
      'ArksAI is an AI workforce for UAE businesses. Hire a worker to run the back office — describe the task and it does the work, checks its own output, and hands you a finished, verified result: live apps, dashboards, reports, decks, on-brand creatives, and UAE-compliant filings (VAT 201, Corporate Tax, WPS, PINT AE e-invoicing). Manage it by message. Alpha — invite-only.',
    ogTitle: 'Hire an AI employee that checks its own work',
  },
  '/for/marketing': {
    title: 'AI for Marketing Teams in the UAE — Landing Pages, Ad Creatives & Campaigns | ArksAI',
    description:
      'ArksAI gives UAE marketing teams an AI builder: conversion-focused landing pages built live, on-brand ad & social creatives with crisp real text and your logo, campaign briefs, content calendars, and competitor research — no design or technical skills needed.',
    ogTitle: 'AI for UAE marketing teams — pages, creatives & campaigns',
  },
  '/for/sales': {
    title: 'AI for Sales Teams in the UAE — Decks, Proposals & Battlecards | ArksAI',
    description:
      'ArksAI gives UAE sales teams pitch decks, pricing and proposals, case studies, battlecards, ROI models and account plans — finished and on-brand, the same day, with no technical skills required.',
    ogTitle: 'AI for UAE sales teams — decks, proposals & account work',
  },
  '/for/finance': {
    title: 'AI for Finance & Strategy Teams in the UAE — Models, Dashboards & Board Decks | ArksAI',
    description:
      'ArksAI gives UAE finance teams formula-driven financial models (DCF, ratios, variance, forecasts), KPI dashboards, board decks and investor updates — computed and verified, not hand-typed. No AI skills needed.',
    ogTitle: 'AI for UAE finance teams — models, dashboards & board decks',
  },
  '/for/hr': {
    title: 'AI for HR & People Teams in the UAE — JDs, Policies & Onboarding | ArksAI',
    description:
      'ArksAI gives UAE HR teams job descriptions, offer letters, policies and handbooks, onboarding portals and checklists, surveys and people dashboards — inclusive, compliant and ready to use, with no technical skills required.',
    ogTitle: 'AI for UAE HR teams — hiring, policies & onboarding',
  },
  '/for/tax': {
    title: 'AI for UAE Tax & Compliance — VAT 201, Corporate Tax, WPS & PINT AE e-Invoicing | ArksAI',
    description:
      'ArksAI produces the exact UAE-compliant documents each obligation requires: VAT 201 working papers + FAF, Corporate Tax (CT 300) computations, monthly WPS salary files (SIF), PINT AE e-invoicing XML and Excise returns. You review and submit via EmaraTax, your e-invoicing provider, or your WPS agent bank.',
    ogTitle: 'AI for UAE tax & compliance — VAT, Corporate Tax, WPS, e-invoicing',
  },
  '/for/legal': {
    title: 'AI for UAE Legal Teams — Contracts, Notices & Opinions (Bilingual) | ArksAI',
    description:
      'ArksAI drafts UAE legal documents to sign: contracts, NDAs, employment agreements, powers of attorney, corporate documents, notices and legal opinions — bilingual in eloquent English and Modern Standard Arabic where the destination requires it, citing the relevant law.',
    ogTitle: 'AI for UAE legal teams — contracts, notices & opinions',
  },
  '/features': {
    title: 'ArksAI Features — Apps, Reports, Email Robots & UAE Compliance | AI for UAE Business',
    description:
      'Everything ArksAI can do for a UAE company: live apps & dashboards, designed reports and decks, formula-driven finance models, on-brand creatives, autonomous email robots, scheduled deliveries, and exact UAE-compliant filings (VAT 201, Corporate Tax, WPS, PINT AE e-invoicing) plus bilingual UAE legal drafting.',
    ogTitle: 'ArksAI features — every deliverable your company needs',
  },
  '/research': {
    title: 'ArksAI Research — AI, Energy & the Frontier, Read for Operators',
    description:
      'Sourced, cited essays on where AI, energy and economics meet — written plainly for the people who run businesses. Energy as the next currency, the East and the AI frontier, and how to read AI benchmarks.',
    ogTitle: 'ArksAI Research — the frontier, read for operators',
  },
};

// Research article slugs (keep in sync with client/src/lib/research.ts and the JSON files
// in client/public/research/). Article pages are dynamic marketing routes.
export const RESEARCH_SLUGS = ['energy-the-next-currency', 'east-ai-frontier', 'reading-ai-benchmarks'];

interface ArticleJson {
  slug: string;
  title: string;
  dek: string;
  date: string;
  readingTimeMin?: number;
  tags?: string[];
  keyTakeaways?: string[];
  sections?: { heading?: string; body?: string[]; list?: string[]; pull?: string }[];
  sources?: { title: string; publisher?: string; url: string }[];
  seo?: { title?: string; description?: string; keywords?: string[] };
}

const articleCache = new Map<string, ArticleJson | null>();
function loadArticle(slug: string): ArticleJson | null {
  if (articleCache.has(slug)) return articleCache.get(slug)!;
  let parsed: ArticleJson | null = null;
  try {
    const raw = fs.readFileSync(path.join(config.clientDist, 'research', `${slug}.json`), 'utf8');
    parsed = JSON.parse(raw) as ArticleJson;
  } catch {
    parsed = null;
  }
  articleCache.set(slug, parsed);
  return parsed;
}

/** Match /research/<slug> for a known article. */
function researchSlug(pathName: string): string | null {
  const m = pathName.match(/^\/research\/([a-z0-9-]+)$/);
  if (m && RESEARCH_SLUGS.includes(m[1])) return m[1];
  return null;
}

/** Build the Article JSON-LD (with full articleBody) for an article page. */
function articleJsonLd(a: ArticleJson, canonical: string): string {
  const body = (a.sections ?? [])
    .map((s) => [s.heading, ...(s.body ?? []), ...(s.list ?? [])].filter(Boolean).join(' '))
    .join('\n\n');
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: a.title,
    description: a.seo?.description || a.dek,
    datePublished: a.date,
    dateModified: a.date,
    author: { '@type': 'Organization', name: 'ArksAI', url: BASE },
    publisher: {
      '@type': 'Organization',
      name: 'ArksAI',
      url: BASE,
      logo: { '@type': 'ImageObject', url: `${BASE}/icon-512.png` },
    },
    mainEntityOfPage: { '@type': 'WebPage', '@id': canonical },
    image: OG_IMAGE,
    keywords: (a.seo?.keywords || a.tags || []).join(', '),
    articleBody: body,
    wordCount: body.split(/\s+/).filter(Boolean).length,
  };
  return `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

let cachedBase: string | null = null;
function baseHtml(): string | null {
  if (cachedBase != null) return cachedBase;
  const file = path.join(config.clientDist, 'index.html');
  try {
    cachedBase = fs.readFileSync(file, 'utf8');
  } catch {
    cachedBase = null;
  }
  return cachedBase;
}

/** Normalise a request URL to a bare pathname without a trailing slash (except root). */
export function normalizePath(url: string): string {
  let p = (url.split('?')[0] || '/').split('#')[0];
  if (p.length > 1 && p.endsWith('/')) p = p.replace(/\/+$/, '');
  return p || '/';
}

export function isMarketingRoute(url: string): boolean {
  const p = normalizePath(url);
  return Object.prototype.hasOwnProperty.call(MARKETING_ROUTES, p) || researchSlug(p) != null;
}

/**
 * Return the index.html with this marketing route's title/description/canonical/OG
 * swapped in (plus JSON-LD for research articles). Returns null if the build or route
 * is unavailable (caller falls back to the plain SPA index.html). Pure string transform
 * → unit-testable via renderMetaInto.
 */
export function renderMarketingHtml(url: string): string | null {
  const html = baseHtml();
  if (html == null) return null;
  const p = normalizePath(url);

  // Dynamic research article pages: derive meta from the article JSON + inject JSON-LD
  // (with the full articleBody) so non-JS crawlers and answer engines get the content.
  const slug = researchSlug(p);
  if (slug) {
    const a = loadArticle(slug);
    if (!a) return null;
    const baseTitle = a.seo?.title || a.title;
    const route: RouteMeta = {
      title: /arksai/i.test(baseTitle) ? baseTitle : `${baseTitle} | ArksAI Research`,
      description: a.seo?.description || a.dek,
      ogTitle: a.title,
    };
    const canonical = `${BASE}${p}`;
    return renderMetaInto(html, p, route, articleJsonLd(a, canonical));
  }

  const route = MARKETING_ROUTES[p];
  if (!route) return null;
  return renderMetaInto(html, p, route);
}

/** The pure core: inject a route's meta (and optional JSON-LD) into a base HTML document. */
export function renderMetaInto(html: string, pathName: string, route: RouteMeta, jsonLd?: string): string {
  const canonical = pathName === '/' ? `${BASE}/` : `${BASE}${pathName}`;
  const ogTitle = esc(route.ogTitle || route.title.split('—')[0].trim() || route.title);
  const title = esc(route.title);
  const desc = esc(route.description);
  let out = html;
  out = out.replace(/<title>[\s\S]*?<\/title>/, `<title>${title}</title>`);
  out = out.replace(
    /(<meta\s+name="description"\s+content=")[\s\S]*?("\s*\/?>)/,
    `$1${desc}$2`,
  );
  out = out.replace(
    /(<link\s+rel="canonical"\s+href=")[\s\S]*?("\s*\/?>)/,
    `$1${canonical}$2`,
  );
  out = out.replace(/(<meta\s+property="og:title"\s+content=")[\s\S]*?("\s*\/?>)/, `$1${ogTitle}$2`);
  out = out.replace(/(<meta\s+property="og:description"\s+content=")[\s\S]*?("\s*\/?>)/, `$1${desc}$2`);
  out = out.replace(/(<meta\s+property="og:url"\s+content=")[\s\S]*?("\s*\/?>)/, `$1${canonical}$2`);
  out = out.replace(/(<meta\s+name="twitter:title"\s+content=")[\s\S]*?("\s*\/?>)/, `$1${ogTitle}$2`);
  out = out.replace(/(<meta\s+name="twitter:description"\s+content=")[\s\S]*?("\s*\/?>)/, `$1${desc}$2`);
  // Keep og:image absolute (already set in the base) — one shared cover for all routes.
  void OG_IMAGE;
  // Article structured data (research pages): insert before </head> so crawlers and
  // answer engines can read the headline, body and sources without running the SPA.
  if (jsonLd) out = out.replace('</head>', `${jsonLd}</head>`);
  return out;
}
