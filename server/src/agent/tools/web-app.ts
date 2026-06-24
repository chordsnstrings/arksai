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
    try {
      copyTree(TEMPLATE_DIR, destAbs);
      copyTree(UI_KIT_DIR, path.join(destAbs, 'ui-kit'));
    } catch (e: any) {
      return `Error: could not scaffold the website — ${e?.message ?? e}`;
    }

    const name = (typeof args.name === 'string' && args.name.trim() ? args.name.trim() : 'My Site').replace(/["'<>]/g, '').slice(0, 60);
    const accent = cleanHex(args.accent);
    for (const f of ['index.html', 'about.html', 'contact.html']) {
      patchAll(path.join(destAbs, f), [['__SITE_NAME__', name]]);
    }
    if (accent) patchAll(path.join(destAbs, 'site.css'), [['--accent: #3a5a78;', `--accent: ${accent};`]]);

    const at = destRel === '.' ? 'the workspace root' : `${destRel}/`;
    return (
      `Scaffolded a responsive multi-page website at ${at}: index.html / about.html / contact.html ` +
      `(name "${name}"${accent ? `, accent ${accent}` : ''}), site.css (overflow-proof reset + fluid type + ` +
      `a working responsive nav), site.js (wires the hamburger), and ui-kit/ (the ArksAI component kit).\n` +
      `It already passes the mobile gate (viewport meta, no horizontal overflow at 320/390/768, the menu opens). ` +
      `NOW: replace ALL placeholder copy with real, specific content for the brief; theme by editing --accent and ` +
      `the colour/type tokens at the top of site.css; add real imagery with generate_image (text-free). ADD PAGES by ` +
      `duplicating an existing .html and keeping its <header> nav + <script src="site.js"> — and add the link in the ` +
      `.nav-links of every page. DON'T remove the CSS reset or rename .nav-links / .nav-toggle / #site-nav / ` +
      `[data-nav-toggle] (that's what keeps the mobile menu working). Publish with publish_app when it's ready.`
    );
  },
};
