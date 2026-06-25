import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../../config';
import { resolveInWorkspace, type ToolDef } from './common';

const WC_DIR = path.join(repoRoot, 'server', 'assets', 'web-components');

function copyTree(src: string, dest: string) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    const s = path.join(src, f);
    const d = path.join(dest, f);
    if (fs.statSync(s).isDirectory()) copyTree(s, d);
    else fs.copyFileSync(s, d);
  }
}

/**
 * add_web_components — self-host a lean Web Awesome / Shoelace (MIT) runtime so the agent
 * can drop in REAL interactive components (dialog, tab-group, carousel, tooltip, dropdown,
 * details/accordion, select, switch…) in plain HTML, themed to the site's tokens. Gated:
 * only copied when the build genuinely needs interactivity it'd otherwise hand-roll (and
 * hand-debug). The whole point is to KEEP the minimal·polished·responsive bar — these are
 * framework-agnostic web components, not a new framework.
 */
export const addWebComponentsTool: ToolDef = {
  name: 'add_web_components',
  description:
    'Self-host a lean Web Awesome / Shoelace (MIT) component runtime into the site so you can use ' +
    'REAL interactive components in plain HTML instead of hand-rolling (and then debugging) them: ' +
    '<sl-dialog> (modal), <sl-tab-group>/<sl-tab>/<sl-tab-panel>, <sl-carousel>, <sl-tooltip>, ' +
    '<sl-dropdown>/<sl-menu>, <sl-details> (accordion), <sl-select>, <sl-switch>, <sl-input>, ' +
    '<sl-rating>, <sl-badge>, <sl-button>, etc. They lazy-load (only what you use is fetched), work ' +
    'with no build step, and are PRE-THEMED to your site tokens (--accent/--font/--radius) so they ' +
    'stay minimal + on-brand. USE THIS only when the page genuinely needs interactivity (a real modal, ' +
    'tabs, a carousel, a tooltip, an accordion) — for static layout keep using the kit + craft.css. ' +
    'Components must still pass the responsive + contrast gate; theme them, never ship Shoelace-default blue.',
  parameters: {
    type: 'object',
    properties: {
      dest: { type: 'string', description: 'Workspace subfolder the site is served from (default "." → installs to ui-kit/wa/). If you serve public/, pass "public".' },
    },
  },
  modes: ['code'],
  summarize: () => 'add interactive web components',
  async run(args, ctx) {
    if (!fs.existsSync(WC_DIR)) return 'Error: the bundled web-component runtime is missing from this build.';
    const baseRel = String(args.dest ?? '.').replace(/[^a-zA-Z0-9._/-]/g, '-') || '.';
    const installRel = path.posix.join(baseRel === '.' ? '' : baseRel, 'ui-kit', 'wa');
    let destAbs: string;
    try {
      destAbs = resolveInWorkspace(ctx.repoDir, installRel);
    } catch (e: any) {
      return `Error: ${e?.message ?? e}`;
    }
    try {
      copyTree(WC_DIR, destAbs);
    } catch (e: any) {
      return `Error: could not install the web components — ${e?.message ?? e}`;
    }
    const rel = installRel; // e.g. "ui-kit/wa" or "public/ui-kit/wa"
    return (
      `Installed the interactive web-component runtime into ${rel}/ (self-hosted, MIT, no CDN). ` +
      `In <head>, link the theme + bridge RELATIVE to your HTML, IN ORDER (the bridge AFTER the theme):\n` +
      `  <link rel="stylesheet" href="${rel}/themes/light.css">\n` +
      `  <link rel="stylesheet" href="${rel}/wa-theme.css">  (maps components to YOUR --accent/--font/--radius)\n` +
      `…and the autoloader as a MODULE before </body> — it MUST carry data-shoelace="." (this is ` +
      `REQUIRED: it sets the lazy-load base path relative to the autoloader itself, so components ` +
      `load correctly even when the site is served from a subfolder like /apps/<slug>/. WITHOUT it ` +
      `the components silently never upgrade):\n` +
      `  <script type="module" src="${rel}/shoelace-autoloader.js" data-shoelace="."></script>\n` +
      `Then use components in HTML, e.g.:\n` +
      `  <sl-dialog label="Title" class="my-dialog"><p>…</p><sl-button slot="footer" variant="primary">Close</sl-button></sl-dialog>\n` +
      `  <sl-tab-group><sl-tab slot="nav" panel="a">A</sl-tab><sl-tab-panel name="a">…</sl-tab-panel></sl-tab-group>\n` +
      `  <sl-tooltip content="Hi"><sl-button>Hover</sl-button></sl-tooltip> · <sl-details summary="More">…</sl-details>\n` +
      `NOTES: (1) keep ${rel}/ inside the directory you actually serve, never root-absolute. (2) These are ` +
      `pre-themed to your tokens — do NOT reintroduce Shoelace-default blue; the look must stay minimal·polished. ` +
      `(3) For ICONS use the kit's Lucide set inside slots, NOT <sl-icon name> (the icon asset bundle is intentionally ` +
      `omitted to stay lean — component chrome like the dialog close-X works via an inline system set). (4) Wrap a tiny ` +
      `inline script to open a dialog: document.querySelector('.my-dialog').show(). (5) It must still be fully responsive ` +
      `+ pass the contrast gate — verify after adding.`
    );
  },
};
