import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../../config';
import { resolveInWorkspace, type ToolDef } from './common';

const UI_KIT_DIR = path.join(repoRoot, 'server', 'assets', 'ui-kit');
const FX_FILES = ['hero-fx.css', 'hero-fx.js'];

/** The bundled hero-effect catalog. Pure data — shared by the tool description AND the test. */
export const FX_EFFECTS: Array<{ id: string; name: string; blurb: string; fits: string }> = [
  { id: 'aurora', name: 'Aurora mesh', blurb: 'soft drifting gradient blobs — a calm, premium glow', fits: 'brand / SaaS / product / calm creative heroes' },
  { id: 'particles', name: 'Constellation field', blurb: 'drifting dots linked by faint lines, gently pointer-reactive', fits: 'tech / data / network / launch heroes' },
  { id: 'waves', name: 'Flowing waves', blurb: 'layered flowing lines low in the frame — a signal / topographic band', fits: 'audio / motion / energy / fintech heroes' },
];

/**
 * add_hero_fx — self-host a small, fallback-first Canvas-2D hero-background effect (aurora /
 * particles / waves). It is DECORATIVE and gated: reach for it ONLY when the brief actually
 * calls for an expressive, atmospheric hero (a brand / product / launch / creative landing
 * page), NEVER on a booking flow, dashboard, admin tool, form or utilitarian page (there it's
 * noise and a battery cost).
 *
 * Correct-by-construction quality: Canvas 2D (renders reliably everywhere, unlike WebGL), the
 * animated canvas OVERLAYS a solid --fx-bg colour that is BOTH the no-JS / reduced-motion
 * fallback AND the surface the legibility gate measures against, an optional scrim, a capped
 * DPR + particle budget, and it pauses when offscreen / the tab is hidden. So it can never
 * blank the hero, hurt contrast, or thrash the CPU.
 */
export const addHeroFxTool: ToolDef = {
  name: 'add_hero_fx',
  description:
    'Self-host a fallback-first, Canvas-2D ANIMATED HERO BACKGROUND (no CDN, no WebGL, ~10KB) so a ' +
    'brand / product / launch / creative landing page gets an expressive, atmospheric hero that reads as ' +
    'genuinely interactive — WITHOUT the fragility of WebGL or a heavy library. Three effects (data-fx): ' +
    FX_EFFECTS.map((e) => `"${e.id}" (${e.blurb})`).join('; ') +
    '. USE THIS ONLY when the brief truly wants an expressive hero (a brand site, a product/app launch, a ' +
    'creative/portfolio page) — NEVER on a dashboard, booking flow, admin tool, form or any utilitarian page ' +
    '(there it is noise). ONE hero per page, never stack effects. It is fallback-first and reduced-motion-safe ' +
    'by construction: the animated canvas overlays a SOLID --fx-bg colour that shows on its own when JS/Canvas ' +
    'is unavailable or the user prefers reduced motion, and your headline must be legible on that --fx-bg (the ' +
    'gate measures it there). Still must pass the responsive + contrast gate — set --fx-ink to contrast --fx-bg.',
  parameters: {
    type: 'object',
    properties: {
      dest: {
        type: 'string',
        description: 'Workspace subfolder the effect files install into (default "ui-kit"; if you serve public/, pass "public/ui-kit"). Keep it inside the directory you actually serve.',
      },
    },
  },
  modes: ['code'],
  summarize: () => 'add an animated hero background',
  async run(args, ctx) {
    for (const f of FX_FILES) {
      if (!fs.existsSync(path.join(UI_KIT_DIR, f))) return `Error: the bundled hero-FX runtime (${f}) is missing from this build.`;
    }
    const destRel = String(args.dest ?? 'ui-kit').replace(/[^a-zA-Z0-9._/-]/g, '-') || 'ui-kit';
    let destAbs: string;
    try {
      destAbs = resolveInWorkspace(ctx.repoDir, destRel);
    } catch (e: any) {
      return `Error: ${e?.message ?? e}`;
    }
    try {
      fs.mkdirSync(destAbs, { recursive: true });
      for (const f of FX_FILES) fs.copyFileSync(path.join(UI_KIT_DIR, f), path.join(destAbs, f));
    } catch (e: any) {
      return `Error: could not install the hero-FX runtime — ${e?.message ?? e}`;
    }
    return (
      `Installed the hero-FX runtime into ${destRel}/ (self-hosted, no CDN, no WebGL).\n` +
      `In <head>, link the CSS RELATIVE to your HTML (NOT root-absolute):\n` +
      `  <link rel="stylesheet" href="${destRel}/hero-fx.css">\n` +
      `…and before </body> (defer):\n` +
      `  <script src="${destRel}/hero-fx.js" defer></script>\n` +
      `Then build ONE hero with this markup (pick ONE data-fx that fits the brand):\n` +
      `  <section class="fx-hero" data-fx="aurora"\n` +
      `           style="--fx-bg:#0b0f1a; --fx-accent:#5b8cff; --fx-accent-2:#c86bff; --fx-ink:#f4f6ff">\n` +
      `    <canvas class="fx-canvas" aria-hidden="true"></canvas>\n` +
      `    <div class="fx-scrim" aria-hidden="true"></div>   <!-- optional: adds a legibility veil; use it for a busy effect -->\n` +
      `    <div class="fx-content"> <!-- headline / sub / CTA go here, they sit above the effect --> </div>\n` +
      `  </section>\n` +
      `EFFECTS: ${FX_EFFECTS.map((e) => `${e.id} — ${e.blurb} (${e.fits})`).join(' · ')}. ` +
      `Tune with data-fx-density="0.5–1.5" and data-fx-speed="0.5–1.6" (defaults 1).\n` +
      `RULES (all correct-by-construction — respect them and it passes the gate): ` +
      `(1) --fx-bg is a SOLID colour — it is the fallback shown with no JS / under reduced motion AND what the ` +
      `contrast gate measures your headline against, so make --fx-ink clearly legible on --fx-bg (WCAG AA). ` +
      `Dark --fx-bg + light --fx-ink (default) or light --fx-bg + dark --fx-ink both work. ` +
      `(2) Set --fx-accent (and optionally --fx-accent-2) to YOUR brand tokens — never leave the demo blues; ` +
      `keep it restrained (the effect is ambient, not the message). ` +
      `(3) Put ALL copy inside .fx-content; never place text directly on the canvas without .fx-content. ` +
      `(4) ONE hero per page — never stack effects, never add it to more than the hero. ` +
      `(5) It already caps DPR, budgets particles, pauses offscreen/hidden, and is OFF under prefers-reduced-motion — ` +
      `don't re-implement any of that. This is DECORATIVE polish for an expressive hero only; a utilitarian page ` +
      `should not use it at all.`
    );
  },
};
