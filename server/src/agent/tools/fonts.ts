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
    return (
      `Installed fonts + icons into ${destRel}/. Link RELATIVE to your HTML (NOT root-absolute "/${destRel}/..."): ` +
      `<link rel="stylesheet" href="${destRel}/fonts.css"> (or @import). Keep ${destRel}/ in (or under) the directory ` +
      `your app serves — if you serve public/, install it there — or root-absolute paths 404 and fonts won't load. ` +
      `Families (clean modern + refined serif — house style is minimal·muted) — body/sans: "Inter", "DM Sans", ` +
      `"Plus Jakarta Sans", "Manrope"; serif: "Source Serif 4", "Lora", "Newsreader"; display: "Space Grotesk", ` +
      `"Fraunces", "Outfit", "Sora". Pick a restrained display+body pairing that fits the brand (Fraunces = warm·premium; ` +
      `Outfit/Sora/DM Sans = modern; Source Serif 4/Newsreader = editorial; Manrope/Plus Jakarta = clean product). Also ` +
      `${destRel}/icons.svg — a curated ${ICON_NAMES.length}-icon Lucide line set: read it and INLINE an icon's inner <path>s into your HTML ` +
      `(an external <use href> does NOT render in the PDF). Pick a font pairing for the brand and use icons for section markers/KPIs. ` +
      `Available icons include: ${ICON_NAMES.join(', ')}.`
    );
  },
};
