import { fetchPublic, htmlToText, assertPublicUrl } from '../../lib/web';
import { addMemory } from '../../sessions/store';
import { getOrgProfile, orgScope, setOrgProfile } from '../../orgs/store';
import { pickPalette } from './palette';
import type { ToolDef } from './common';

/**
 * Onboarding tools — used ONLY by the agent-driven org-onboarding session (the
 * runner injects them when session.task === 'org.onboarding'). They are NOT in
 * ALL_TOOLS, so they never appear in ordinary chats.
 *
 * `save_org_profile` writes strictly to the SESSION'S OWN org (ctx.session.orgId),
 * which is stamped from the creator's authenticated identity — so onboarding can
 * never write another org's profile/memory.
 */

function parseRgb(s: string): { r: number; g: number; b: number; a: number } | null {
  const m = String(s).match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?/i);
  if (!m) return null;
  return { r: +m[1], g: +m[2], b: +m[3], a: m[4] != null ? +m[4] : 1 };
}

/** Sample a live site's computed colours via headless Chromium → palette. Best-effort. */
async function siteColors(url: string): Promise<{ accent: string; palette: string[] } | null> {
  let pw: any;
  try {
    pw = await import('playwright');
  } catch {
    return null;
  }
  let browser: any;
  try {
    browser = await pw.chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    const counts: Record<string, number> = await page.evaluate(() => {
      const g: any = globalThis as any;
      const doc = g.document;
      const win = g;
      const out: Record<string, number> = {};
      const add = (c: string, w: number) => {
        if (c) out[c] = (out[c] || 0) + w;
      };
      const sel = 'a,button,h1,h2,h3,header,nav,[class*="btn"],[class*="button"],[class*="cta"],[class*="primary"]';
      const els = Array.from(doc.querySelectorAll(sel)).slice(0, 500) as any[];
      for (const el of els) {
        const s = win.getComputedStyle(el);
        add(s.color, 1);
        add(s.backgroundColor, 2); // backgrounds weigh a bit more
        add(s.borderColor, 1);
      }
      const body = win.getComputedStyle(doc.body);
      add(body.backgroundColor, 3);
      return out;
    });
    const buckets = Object.entries(counts)
      .map(([c, count]) => ({ rgb: parseRgb(c), count }))
      .filter((x) => x.rgb && x.rgb.a >= 0.5)
      .map((x) => ({ r: x.rgb!.r, g: x.rgb!.g, b: x.rgb!.b, count: x.count }));
    if (!buckets.length) return null;
    return pickPalette(buckets);
  } catch {
    return null;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

export const crawlSiteTool: ToolDef = {
  name: 'crawl_site',
  description:
    "Crawl the organization's website to learn about them and read their brand colours. Returns the page's readable " +
    'text (use it to draft a short "about the organization") and the detected brand accent + palette (confirm/adjust ' +
    'these with the admin). Use during onboarding only; then call save_org_profile.',
  parameters: {
    type: 'object',
    properties: { url: { type: 'string', description: "The organization's website URL." } },
    required: ['url'],
  },
  modes: ['chat'],
  summarize: (a) => `crawl ${String(a.url ?? '')}`,
  async run(args, ctx) {
    let url = String(args.url ?? '').trim();
    if (!url) return 'Error: provide the website URL.';
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    try {
      await assertPublicUrl(url);
    } catch (e: any) {
      return `Error: ${e?.message ?? 'that URL is not reachable'}.`;
    }
    let text = '';
    try {
      const res = await fetchPublic(url, ctx.signal);
      if (res.status < 400) text = htmlToText(res.body).slice(0, 6000);
    } catch {
      /* text fetch best-effort */
    }
    const colors = await siteColors(url);
    const parts: string[] = [`Crawled ${url}.`];
    if (colors) parts.push(`Detected brand accent ${colors.accent}; palette ${colors.palette.join(', ')}.`);
    else parts.push('Could not read brand colours automatically — propose a tasteful palette and confirm with the admin.');
    parts.push(text ? `\nWebsite text (use to draft a short "about"):\n${text}` : '\nNo readable text was extracted.');
    parts.push('\nNext: confirm the accent + a one-paragraph "about" with the admin, then call save_org_profile.');
    return parts.join('\n');
  },
};

export const saveOrgProfileTool: ToolDef = {
  name: 'save_org_profile',
  description:
    "Save the organization's shared profile — its brand accent/palette and a short 'about the organization' — plus any " +
    'onboarding answers. This becomes the org\'s shared memory, applied across every future session. Call with complete:true ' +
    'on the FINAL step to finish onboarding and unlock the studio. Confirm the details with the admin before saving.',
  parameters: {
    type: 'object',
    properties: {
      accent: { type: 'string', description: 'Brand accent colour hex (e.g. "#0a7d55").' },
      palette: { type: 'array', items: { type: 'string' }, description: 'A few brand colours as hex.' },
      about: { type: 'string', description: 'One short paragraph: what the organization does, who it serves.' },
      websiteUrl: { type: 'string', description: "The organization's website." },
      answers: { type: 'object', description: 'Onboarding answers as key→value (industry, tone, priorities, teams…).', additionalProperties: { type: 'string' } },
      complete: { type: 'boolean', description: 'Set true on the final save to finish onboarding.' },
    },
  },
  modes: ['chat'],
  summarize: (a) => (a.complete ? 'finish onboarding' : 'save org profile'),
  async run(args, ctx) {
    const orgId = ctx.session.orgId;
    if (!orgId) return 'Error: this session is not attached to an organization, so there is nothing to onboard.';

    const branding: { accent?: string; palette?: string[] } = {};
    if (typeof args.accent === 'string' && args.accent.trim()) branding.accent = args.accent.trim();
    if (Array.isArray(args.palette)) branding.palette = args.palette.filter((c: any) => typeof c === 'string').slice(0, 6);

    const about = typeof args.about === 'string' ? args.about.trim() : undefined;
    const answers =
      args.answers && typeof args.answers === 'object'
        ? Object.fromEntries(Object.entries(args.answers).map(([k, v]) => [String(k), String(v)]).slice(0, 20))
        : undefined;

    await setOrgProfile(orgId, {
      branding: Object.keys(branding).length ? branding : undefined,
      about,
      websiteUrl: typeof args.websiteUrl === 'string' ? args.websiteUrl.trim() || undefined : undefined,
      answers,
      onboardingComplete: !!args.complete,
    });

    // Seed the org's shared memory so it's usable immediately (this org only).
    const scope = orgScope(orgId);
    if (about) await addMemory(scope, `About the organization: ${about}`).catch(() => {});
    for (const [k, v] of Object.entries(answers ?? {})) {
      if (v) await addMemory(scope, `${k}: ${v}`).catch(() => {});
    }

    const prof = await getOrgProfile(orgId);
    return args.complete
      ? `Onboarding complete — the organization's brand and profile are saved and now apply across every workspace. Welcome them in and invite them to start.`
      : `Saved (brand${prof.branding?.accent ? ` accent ${prof.branding.accent}` : ''}${prof.about ? ', about set' : ''}). Continue the onboarding, then call save_org_profile with complete:true to finish.`;
  },
};
