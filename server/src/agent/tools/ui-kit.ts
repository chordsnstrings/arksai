import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../../config';
import { resolveInWorkspace, type ToolDef } from './common';
import { ICON_NAMES } from './icons';

const UI_KIT_DIR = path.join(repoRoot, 'server', 'assets', 'ui-kit');
const FONTS_DIR = path.join(repoRoot, 'server', 'assets', 'report-fonts');

function copyDirInto(src: string, dest: string) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    const s = path.join(src, f);
    if (fs.statSync(s).isFile()) fs.copyFileSync(s, path.join(dest, f));
  }
}

/**
 * Install the opinionated UI design system (tokens + components + named themes +
 * embedded fonts/icons) into the workspace so any UI build starts from
 * excellence and looks designed by default — the agent composes from it instead
 * of hand-rolling mediocre CSS.
 */
export const addUiKitTool: ToolDef = {
  name: 'add_ui_kit',
  description:
    'Install the ArksAI UI design system into the workspace: design-tokens.css (CSS-variable color/type/space/' +
    'radius/shadow/motion scales, light+dark), components.css (buttons/cards/inputs/nav/tables with hover/focus/' +
    'empty/loading/error states), themes.css (curated named looks), plus embedded fonts + an icon sprite. ALWAYS ' +
    'use this for any UI build, then compose from the tokens/components — never hand-roll default-looking CSS.',
  parameters: {
    type: 'object',
    properties: {
      dest: { type: 'string', description: 'Workspace subfolder to install into (default "ui-kit").' },
    },
  },
  modes: ['code'],
  summarize: () => 'install UI kit',
  async run(args, ctx) {
    if (!fs.existsSync(UI_KIT_DIR)) return 'Error: the bundled UI kit is missing from this build.';
    const destRel = String(args.dest ?? 'ui-kit').replace(/[^a-zA-Z0-9._/-]/g, '-') || 'ui-kit';
    let destAbs: string;
    try {
      destAbs = resolveInWorkspace(ctx.repoDir, destRel);
    } catch (e: any) {
      return `Error: ${e?.message ?? e}`;
    }
    try {
      copyDirInto(UI_KIT_DIR, destAbs);
      copyDirInto(FONTS_DIR, destAbs); // fonts.css + woff2 + icons.svg, self-hosted
    } catch (e: any) {
      return `Error: could not install the UI kit — ${e?.message ?? e}`;
    }
    return (
      `Installed the UI kit into ${destRel}/. In <head>, link these RELATIVE to your HTML (NOT root-absolute ` +
      `"/${destRel}/..."), IN ORDER:\n` +
      `  <link rel="stylesheet" href="${destRel}/fonts.css">\n` +
      `  <link rel="stylesheet" href="${destRel}/design-tokens.css">\n` +
      `  <link rel="stylesheet" href="${destRel}/components.css">\n` +
      `  <link rel="stylesheet" href="${destRel}/patterns.css">\n` +
      `  <link rel="stylesheet" href="${destRel}/themes.css">\n` +
      `…and before </body>:  <script src="${destRel}/ui-kit.js" defer></script>\n` +
      `CRITICAL: keep the kit in (or under) the directory your app serves — if you serve a subfolder like public/, ` +
      `install it there (dest "public/ui-kit"). Root-absolute "/${destRel}/..." 404s when served from a subdir — ` +
      `the #1 cause of an unstyled, failed deploy.\n` +
      `House style is MINIMAL · MODERN · MUTED — soft desaturated accents, light layouts, type-first. ` +
      `DESIGN KIT (fastest — a complete vetted look in one token): <html data-kit="minimal"> — pick ONE of 5: ` +
      `minimal (clean modern SaaS) · paper (refined serif) · linen (warm editorial) · calm (quiet wellness) · ` +
      `harbor (corporate clean). Each bundles a muted palette+radius+shadow+fonts; still override --accent for a brand colour.\n` +
      `OR mix-and-match — THEME (muted colour, 10): <html data-theme="slate"> from slate·ink·indigo·ocean·sage·teal·` +
      `clay·stone·plum·olive (add " dark" for dark mode); + TYPE (font pairing, 8): <html data-type="editorial"> from ` +
      `geometric·editorial·clean·startup·tech·journal·warm·humanist. ` +
      `Offer the user ONE quick curated look (a kit, or a colour+pairing) with a strong default matched to the brand/audience. ` +
      `Keep it restrained — one quiet accent used ~5–10%, never a loud/saturated fill.\n` +
      `BUILD WITH the tokens (--accent/--ink/--surface/--s-*/--t-*/--r-*/--shadow-*/--ease*; the type scale is ` +
      `already fluid/responsive); COMPONENTS (.btn .card .field .input .switch .segmented .tabs .table .badge ` +
      `.alert .avatar .progress .kpi .price .quote .menu dialog .accordion .toast — all with states); and SECTION ` +
      `PATTERNS (.hero/.hero-split/.hero-center .features .bento .stat-band .pricing .testimonials .cta[.is-accent] ` +
      `.logos .split .footer). COMPOSE these blocks into a bespoke page — never output a generic centered-hero ` +
      `template. MOTION: add [data-reveal] (scroll-in) and .animate-in (entrance); use ONE signature moment per page ` +
      `(a gradient .cta.is-accent, a .bento, or a hero visual), restraint elsewhere.\n` +
      `ICONS (${ICON_NAMES.length} curated Lucide line icons in ${destRel}/icons.svg — use these, don't hand-roll SVGs): ` +
      `in a browser reference one with <svg class="ico" width="24" height="24"><use href="${destRel}/icons.svg#NAME"/></svg> ` +
      `— symbols stroke with currentColor so set the icon's CSS \`color\` to recolour it. Available: ${ICON_NAMES.join(', ')}.`
    );
  },
};
