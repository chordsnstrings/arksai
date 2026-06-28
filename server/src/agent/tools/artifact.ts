import fs from 'node:fs';
import { resolveInWorkspace, type ToolDef } from './common';
import { buildArtifactHtml, compileComponent } from '../artifact';
import { PALETTES } from '../palettes';

/**
 * create_artifact — turn a self-contained React component into a single, self-contained HTML
 * file that renders INSTANTLY in a browser with NO build step (the React runtime is vendored
 * inline, the JSX is compiled server-side, the design tokens + a confident palette are baked in).
 * It previews in the Canvas in ~1s and can be published as-is. The fast path for a small visual
 * deliverable — a chart, a calculator, an interactive widget, a single landing section, a data viz.
 */
export const createArtifactTool: ToolDef = {
  name: 'create_artifact',
  description:
    'Render a self-contained React component to an INSTANT, no-build, single-file HTML artifact ' +
    '(the React runtime is vendored inline — no CDN, no npm install, no Vite build). Use it for a ' +
    'quick VISUAL deliverable: a chart, calculator, interactive widget, a single landing section, a ' +
    'data viz — anything self-contained and frontend-only. It previews in the Canvas in ~1s and is ' +
    'instantly publishable.\n' +
    'RULES for the `component` code: define a function component named `App` that returns JSX (TSX is ' +
    'fine — types are stripped). NO import/export — React is global and the hooks useState, useEffect, ' +
    'useRef, useMemo, useCallback, useReducer, useContext are provided as locals. Keep everything inline ' +
    '(no npm packages); style with inline styles or a <style> tag, and use the CSS variables that are ' +
    'pre-set: --accent, --accent-2, --accent-deep, --accent-tint, --accent-ink, --ink, --ink-soft, --muted, ' +
    '--bg, --surface, --line, --radius, --font-sans, --font-display, --font-serif, --font-mono. Pick a fitting ' +
    '`palette` for real colour. ' +
    'TYPE (elegant + uniform by default — high-quality fonts are EMBEDDED, so USE THE TOKENS and never name a ' +
    'raw font or pull in Google Fonts): --font-sans (Inter) for body/UI; --font-display (Space Grotesk) for ' +
    'headings + large numerals (h1–h4 already use it); --font-mono (IBM Plex Mono) for figures that should ' +
    'align — timers, prices, stats, tables (add font-variant-numeric:tabular-nums on any changing number); ' +
    '--font-serif (Source Serif 4) only for an editorial long-form feel. ' +
    'POLISH (minimal · modern · muted — refinement is the whole game; reach for the SCALE tokens, ' +
    'do not invent flat values): the neutral system (--bg/--surface/--ink/--line) is already a bespoke ' +
    'TINTED ramp derived from the accent — use those tokens, never a raw grey or #fff/#000. Elevation: ' +
    '--shadow-sm/-md/-lg (soft, layered, accent-tinted — lift cards with these, never a hard drop shadow). ' +
    'Radius: --r-sm/-md/-lg/-xl. Type scale: --text-xs…--text-5xl with --tracking-tight/-snug/-wide/-caps ' +
    '(tighten big display, open up small UPPERCASE labels; put eyebrows/labels in --font-mono + ' +
    'letter-spacing:var(--tracking-caps)). Aim for ONE generous hero moment + lots of restraint, ' +
    'precise spacing on a 4/8px rhythm, hairline borders (--line), and a calm muted palette — expensive ' +
    'minimalism, not a flat template. ' +
    'CONTRAST (important): for text use --ink (body), --ink-soft / --muted (secondary); for surfaces use --bg / ' +
    '--surface. These are guaranteed legible together. Do NOT hard-code a dark background colour while using ' +
    'the dark text tokens — that renders dark-on-dark. For a DARK / moody aesthetic, pass theme:"dark" (the ' +
    'token set flips to a dark surface with LIGHT ink automatically) and keep using the same tokens; do not ' +
    'paint your own dark background. Put colour through --accent (on --accent-ink) for emphasis only. ' +
    'For a data-backed or multi-page APP use create_react_app instead (this is a single static view).',
  parameters: {
    type: 'object',
    properties: {
      component: { type: 'string', description: 'The React component source. Must define `function App() { return (<…/>) }`. No imports/exports.' },
      title: { type: 'string', description: 'Artifact title (browser tab + heading context).' },
      palette: { type: 'string', description: `Palette name for the accent colour. One of: ${PALETTES.map((p) => p.name).join(', ')}. Default emerald.` },
      theme: { type: 'string', enum: ['light', 'dark'], description: 'Surface theme. "light" (default) = light surface + dark ink; "dark" = dark surface + LIGHT ink. Choose "dark" for a moody/night/focus aesthetic instead of hard-coding a dark background. The ink tokens flip automatically so text stays legible.' },
    },
    required: ['component'],
  },
  modes: ['chat', 'code'],
  summarize: (a) => `artifact ${String(a.title ?? a.output ?? 'component')}`,
  async run(args, ctx) {
    const src = String(args.component ?? '').trim();
    if (!src) return 'Error: `component` is required — the React component source (a function App that returns JSX).';
    // ALWAYS index.html — the artifact is the page, and the canvas preview + publish + the tappable
    // completion card all key off a root index.html. A descriptive name would silently break the
    // preview card (the renderer only auto-detects index.html).
    const finalName = 'index.html';
    let absOut: string;
    try {
      absOut = resolveInWorkspace(ctx.repoDir, finalName);
    } catch (e: any) {
      return `Error: ${e?.message ?? e}`;
    }

    let compiled: string;
    try {
      compiled = await compileComponent(src);
    } catch (e: any) {
      return `Error: the component didn't compile — fix it and call create_artifact again.\n\n${e?.message ?? e}`;
    }

    const theme = String(args.theme || '').toLowerCase() === 'dark' ? 'dark' : 'light';
    const html = buildArtifactHtml(compiled, { title: String(args.title || 'Artifact'), palette: args.palette ? String(args.palette) : undefined, theme });
    try {
      fs.writeFileSync(absOut, html);
    } catch (e: any) {
      return `Error: could not write the artifact — ${e?.message ?? e}`;
    }
    const sz = Math.round(fs.statSync(absOut).size / 1024);
    const pal = PALETTES.find((p) => p.name === String(args.palette || '').toLowerCase());
    return (
      `Created ${finalName} (${sz} KB) — a self-contained, no-build artifact${pal ? `, ${pal.name} palette` : ''}. This is the ` +
      `COMPLETE deliverable: it is one static HTML file with the React runtime inlined — do NOT add a server, package.json, ` +
      `or any app scaffolding around it, and do NOT try to "boot" or verify it; it needs none of that and calling ` +
      `create_artifact FINISHES the task. A TAPPABLE preview card with a live thumbnail appears for the user automatically, ` +
      `so do NOT tell them to "open the canvas" or paste the path — just say in ONE short line what you made. It's publishable ` +
      `as-is with publish_app. To change it, edit the component and call create_artifact again. (For a data-backed or ` +
      `multi-page app, use create_react_app instead — that one IS a full app.)`
    );
  },
};
