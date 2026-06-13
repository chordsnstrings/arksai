import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../../config';
import { resolveInWorkspace, type ToolDef } from './common';

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
      `Installed the UI kit into ${destRel}/. In your HTML <head>, link in THIS ORDER: ` +
      `fonts.css → design-tokens.css → components.css → themes.css. Build with the CSS variables ` +
      `(--accent, --ink, --surface, --s-*, --t-*, --r-*, --shadow-*). Pick a look with ` +
      `<html data-theme="aurora|emerald|sunset|mono|editorial"> (aurora is the default); offer the user a ` +
      `quick choice. Override --accent to match a brand. Icons: inline a symbol's <path>s from icons.svg ` +
      `(external <use href> does NOT render reliably). Use the component classes (.btn, .card, .field, .input, ` +
      `.table, .badge, .state, .skeleton, .hero, .container, .section) and keep all interactive/empty/loading/error states.`
    );
  },
};
