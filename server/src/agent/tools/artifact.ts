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
    'pre-set: --accent, --accent-2, --accent-deep, --accent-tint, --accent-ink, --ink, --muted, --bg, ' +
    '--surface, --line, --radius, --font-sans, --font-serif. Pick a fitting `palette` for real colour. ' +
    'For a data-backed or multi-page APP use create_react_app instead (this is a single static view).',
  parameters: {
    type: 'object',
    properties: {
      component: { type: 'string', description: 'The React component source. Must define `function App() { return (<…/>) }`. No imports/exports.' },
      title: { type: 'string', description: 'Artifact title (browser tab + heading context).' },
      palette: { type: 'string', description: `Palette name for the accent colour. One of: ${PALETTES.map((p) => p.name).join(', ')}. Default emerald.` },
      output: { type: 'string', description: 'Output filename (default index.html so it previews + publishes at the root).' },
    },
    required: ['component'],
  },
  modes: ['chat', 'code'],
  summarize: (a) => `artifact ${String(a.title ?? a.output ?? 'component')}`,
  async run(args, ctx) {
    const src = String(args.component ?? '').trim();
    if (!src) return 'Error: `component` is required — the React component source (a function App that returns JSX).';
    const outName = String(args.output || 'index.html').replace(/[^a-zA-Z0-9._-]/g, '-');
    const finalName = /\.html?$/i.test(outName) ? outName : `${outName}.html`;
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

    const html = buildArtifactHtml(compiled, { title: String(args.title || 'Artifact'), palette: args.palette ? String(args.palette) : undefined });
    try {
      fs.writeFileSync(absOut, html);
    } catch (e: any) {
      return `Error: could not write the artifact — ${e?.message ?? e}`;
    }
    const sz = Math.round(fs.statSync(absOut).size / 1024);
    const pal = PALETTES.find((p) => p.name === String(args.palette || '').toLowerCase());
    return (
      `Created ${finalName} (${sz} KB) — a self-contained, no-build artifact${pal ? `, ${pal.name} palette` : ''}. It renders ` +
      `INSTANTLY in the canvas (no install/build) and is publishable as-is with publish_app. To change it, edit the ` +
      `component and call create_artifact again. (Frontend-only + single file — for a data-backed or multi-page app use create_react_app.)`
    );
  },
};
