import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../../config';
import { resolveInWorkspace, type ToolDef } from './common';

const TEMPLATE_DIR = path.join(repoRoot, 'server', 'assets', 'web-app-template');
const UI_KIT_DIR = path.join(repoRoot, 'server', 'assets', 'ui-kit');

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

/** Replace ALL occurrences of each literal token in a file (the site name appears many times). */
function patchAll(file: string, edits: Array<[string, string]>) {
  if (!fs.existsSync(file)) return;
  let s = fs.readFileSync(file, 'utf8');
  for (const [find, repl] of edits) s = s.split(find).join(repl);
  fs.writeFileSync(file, s);
}

const cleanHex = (v: unknown): string => {
  const t = typeof v === 'string' ? v.trim() : '';
  return /^#?[0-9a-fA-F]{6}$/.test(t) ? (t.startsWith('#') ? t : `#${t}`) : '';
};

/**
 * Scaffold a complete, responsive, multi-page static website that is correct BY CONSTRUCTION:
 * an overflow-proof reset (box-sizing, max-width media, overflow-x guards), a working mobile
 * hamburger nav (wired in site.js), <meta viewport>, fluid type + grids, and Home/About/Contact
 * pages built from the baseline. The agent fills in real content + theme — never the fragile
 * layout/nav. The web counterpart of create_expo_app.
 */
export const createWebAppTool: ToolDef = {
  name: 'create_web_app',
  description:
    'Scaffold a complete, responsive, multi-page STATIC WEBSITE that cannot overflow horizontally ' +
    'or ship a broken mobile menu: an overflow-proof CSS reset, a working hamburger nav (wired in ' +
    'site.js), a <meta viewport>, fluid type + auto-fit grids, and Home/About/Contact pages — plus ' +
    'the ArksAI UI kit copied into ui-kit/ for richer components. ALWAYS start a website/marketing ' +
    'site/multi-page site with this (never hand-roll the page shell or nav). Then replace the ' +
    'placeholder copy with REAL content, add pages by duplicating an existing .html (keep the same ' +
    '<header> nav + site.js), theme by editing --accent and the tokens in site.css, and add imagery ' +
    'with generate_image. Keep the reset + the .nav-links/.nav-toggle markup intact.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Site / brand name shown in the nav, title and footer (e.g. "GIC Global").' },
      accent: { type: 'string', description: 'Brand accent hex (e.g. "#3a5a78"). Used sparingly (~5–10%).' },
      dest: { type: 'string', description: 'Workspace subfolder to scaffold into (default the workspace root ".").' },
    },
  },
  modes: ['code'],
  summarize: (a) => `scaffold website${a?.name ? ` "${a.name}"` : ''}`,
  async run(args, ctx) {
    if (!fs.existsSync(TEMPLATE_DIR)) return 'Error: the bundled website template is missing from this build.';
    const destRel = String(args.dest ?? '.').replace(/[^a-zA-Z0-9._/-]/g, '-') || '.';
    let destAbs: string;
    try {
      destAbs = resolveInWorkspace(ctx.repoDir, destRel);
    } catch (e: any) {
      return `Error: ${e?.message ?? e}`;
    }
    // If design_direction already locked a bespoke look (tokens.css), DON'T clobber it —
    // the scaffold provides mechanics, the direction provides the look (order-independent).
    const tokensPath = path.join(destAbs, 'tokens.css');
    const lockedTokens = fs.existsSync(tokensPath) ? fs.readFileSync(tokensPath, 'utf8') : null;
    try {
      copyTree(TEMPLATE_DIR, destAbs);
      copyTree(UI_KIT_DIR, path.join(destAbs, 'ui-kit'));
    } catch (e: any) {
      return `Error: could not scaffold the website — ${e?.message ?? e}`;
    }
    if (lockedTokens) fs.writeFileSync(tokensPath, lockedTokens); // restore the locked look

    const name = (typeof args.name === 'string' && args.name.trim() ? args.name.trim() : 'My Site').replace(/["'<>]/g, '').slice(0, 60);
    const accent = cleanHex(args.accent);
    for (const f of ['index.html', 'about.html', 'contact.html']) {
      patchAll(path.join(destAbs, f), [['__SITE_NAME__', name]]);
    }
    // Theme the LOOK (tokens.css), not the mechanics (site.css) — but never overwrite a locked direction.
    if (accent && !lockedTokens) patchAll(tokensPath, [['--accent: #3a5a78;', `--accent: ${accent};`]]);

    const at = destRel === '.' ? 'the workspace root' : `${destRel}/`;
    return (
      `Scaffolded a responsive multi-page website at ${at}: index.html / about.html / contact.html ` +
      `(name "${name}"${accent ? `, accent ${accent}` : ''}). Files: tokens.css (THE LOOK — colour/type/feel), ` +
      `site.css (MECHANICS — overflow-proof reset + a working responsive nav), ui-kit/craft.css (craft + SIGNATURE ` +
      `components: .eyebrow-rule, .board, .spec, .stamp, .ticket [a clip-safe boarding-pass card], .lift, .tilt, ` +
      `.sheen, .with-arrow, .nav-underline + motion), ui-kit/open-props.css (optional richer easings/animations/` +
      `gradients — use with restraint, keep it minimal·polished), site.js (wires the hamburger AND [data-reveal] scroll-in + ` +
      `[data-count] stat count-up — reduced-motion-safe), and ui-kit/ (the full component kit).${lockedTokens ? ' Your locked design_direction tokens.css was preserved.' : ''}\n` +
      `It already passes the mobile gate (viewport meta, no horizontal overflow at 320/390/768, the menu opens). ` +
      `NOW: (1) theme by editing ONLY tokens.css — set a palette + type trio (display / body / mono) grounded in the ` +
      `subject, never default blue; ${lockedTokens ? 'your design_direction look is already applied. ' : 'or run design_direction first to lock a bespoke concept. '}` +
      `(2) replace ALL placeholder copy with real, specific content for the brief; ` +
      `(3) build ONE meaningful SIGNATURE moment from craft.css (a .board / .spec / .ticket keyed to REAL codes/data ` +
      `for this subject — never generic 01/02/03; prefer these robust components over a hand-built fragile one); ` +
      `(4) add LIFE with the free motion: [data-reveal] on sections, [data-count] on key stats, .lift/.tilt/.sheen ` +
      `on cards + CTA; (5) add real imagery with generate_image (text-free). ADD PAGES by ` +
      `duplicating an existing .html and keeping its <header> nav + the three <link>s + <script src="site.js">. ` +
      `DON'T remove the CSS reset or rename .nav-links / .nav-toggle / #site-nav / [data-nav-toggle] (that keeps the ` +
      `mobile menu working). Publish with publish_app when it's ready.`
    );
  },
};
