import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../../config';
import { resolveInWorkspace, type ToolDef } from './common';
import { ICON_NAMES } from './icons';

const FONTS_DIR = path.join(repoRoot, 'server', 'assets', 'report-fonts');

/**
 * Install a curated set of high-quality, self-hosted fonts (woff2 + fonts.css)
 * into the workspace so any report OR UI can embed beautiful typography with no
 * network dependency. The agent designs bespoke — this just guarantees great
 * fonts are always available to @font-face.
 */
export const addFontsTool: ToolDef = {
  name: 'add_fonts',
  description:
    'Install curated, high-quality self-hosted fonts (Inter, Source Serif 4, Space Grotesk — ' +
    'woff2 + a fonts.css with @font-face) into the workspace so you can embed beautiful ' +
    'typography with NO network dependency. Use this for reports and for any UI build, then ' +
    'link the fonts.css and set your type in CSS. Always prefer this over leaving default fonts.',
  parameters: {
    type: 'object',
    properties: {
      dest: { type: 'string', description: 'Workspace subfolder to install into (default "fonts").' },
    },
  },
  modes: ['report', 'code'],
  summarize: () => 'install fonts',
  async run(args, ctx) {
    if (!fs.existsSync(FONTS_DIR)) return 'Error: the bundled font set is missing from this build.';
    const destRel = String(args.dest ?? 'fonts').replace(/[^a-zA-Z0-9._/-]/g, '-') || 'fonts';
    let destAbs: string;
    try {
      destAbs = resolveInWorkspace(ctx.repoDir, destRel);
    } catch (e: any) {
      return `Error: ${e?.message ?? e}`;
    }
    try {
      fs.mkdirSync(destAbs, { recursive: true });
      for (const f of fs.readdirSync(FONTS_DIR)) fs.copyFileSync(path.join(FONTS_DIR, f), path.join(destAbs, f));
    } catch (e: any) {
      return `Error: could not install fonts — ${e?.message ?? e}`;
    }
    // Enumerate the EXACT families + weights actually on disk, so the model never specifies a
    // face/weight that isn't embedded (a real failure seen live: it asked for Bricolage 600 /
    // JetBrains Mono, neither bundled, then had to work around it).
    let available = '';
    try {
      const css = fs.readFileSync(path.join(FONTS_DIR, 'fonts.css'), 'utf8');
      const map = new Map<string, Set<string>>();
      const re = /font-family:\s*'([^']+)'[^}]*?font-weight:\s*(\d+)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(css))) {
        if (!map.has(m[1])) map.set(m[1], new Set());
        map.get(m[1])!.add(m[2]);
      }
      available = [...map.entries()]
        .map(([fam, ws]) => `"${fam}" (${[...ws].sort().join('/')})`)
        .join(', ');
    } catch {
      /* fall back to no list */
    }
    return (
      `Installed fonts + icons into ${destRel}/. Link RELATIVE to your HTML (NOT root-absolute "/${destRel}/..."): ` +
      `<link rel="stylesheet" href="${destRel}/fonts.css"> (or @import). Keep ${destRel}/ in (or under) the directory ` +
      `your app serves — if you serve public/, install it there — or root-absolute paths 404 and fonts won't load. ` +
      `Pick a DELIBERATE type trio that fits the SUBJECT (not the reflexive default) — a display, a body, and a ` +
      `MONO/DATA face for labels/codes/figures (the cheapest tell of expensive editorial design). ` +
      `USE ONLY these embedded families + weights (do NOT name a face or weight not in this list — it 404s and ` +
      `falls back to a system font): ${available || '(see fonts.css)'}. For roles: display/serif — Fraunces, Spectral, ` +
      `Source Serif 4, Newsreader, Bricolage Grotesque, Space Grotesk; body/sans — Hanken Grotesk (a deliberate alt to ` +
      `Inter), Inter, DM Sans, Plus Jakarta Sans, Manrope, Outfit, Sora; data/MONO — IBM Plex Mono, Space Mono. ` +
      `Avoid default-Inter-everywhere and reflexive Playfair. Also ` +
      `${destRel}/icons.svg — a curated ${ICON_NAMES.length}-icon Lucide line set: read it and INLINE an icon's inner <path>s into your HTML ` +
      `(an external <use href> does NOT render in the PDF). Pick a font pairing for the brand and use icons for section markers/KPIs. ` +
      `Available icons include: ${ICON_NAMES.join(', ')}.`
    );
  },
};
