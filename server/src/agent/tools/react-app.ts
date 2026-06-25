import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../../config';
import { resolveInWorkspace, type ToolDef } from './common';

const TEMPLATE_DIR = path.join(repoRoot, 'server', 'assets', 'react-app-template');

function copyTree(src: string, dest: string) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    if (f === 'node_modules' || f === 'dist') continue;
    const s = path.join(src, f);
    const d = path.join(dest, f);
    if (fs.statSync(s).isDirectory()) copyTree(s, d);
    else fs.copyFileSync(s, d);
  }
}

function patchAll(file: string, edits: Array<[string, string]>) {
  if (!fs.existsSync(file)) return;
  let s = fs.readFileSync(file, 'utf8');
  for (const [find, repl] of edits) s = s.split(find).join(repl);
  fs.writeFileSync(file, s);
}

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'react-app';

const cleanHex = (v: unknown): string => {
  const t = typeof v === 'string' ? v.trim() : '';
  return /^#?[0-9a-fA-F]{6}$/.test(t) ? (t.startsWith('#') ? t : `#${t}`) : '';
};

/** hex → "H S% L%" (the shadcn token format). */
export function hexToHslTriplet(hex: string): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let hue = 0;
  const l = (max + min) / 2;
  const d = max - min;
  let sat = 0;
  if (d !== 0) {
    sat = d / (1 - Math.abs(2 * l - 1));
    if (max === r) hue = ((g - b) / d) % 6;
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }
  return `${Math.round(hue)} ${Math.round(sat * 100)}% ${Math.round(l * 100)}%`;
}

/**
 * create_react_app — scaffold a Vite + React + TypeScript + Tailwind app with shadcn-style
 * components (Button/Card/Input/Label/Tabs/Dialog), pre-themed to the brand accent and minimal
 * by default. For a COMPLEX, stateful, interactive web app (dashboard, multi-view tool) where the
 * React/Tailwind ecosystem earns its keep. publish_app builds it (Vite). For a marketing/content
 * site, prefer the lighter create_web_app instead.
 */
export const createReactAppTool: ToolDef = {
  name: 'create_react_app',
  description:
    'Scaffold a Vite + React + TypeScript + TAILWIND app with shadcn-style UI components ' +
    '(Button, Card, Input, Label, Tabs, Dialog in src/components/ui), pre-themed to your brand ' +
    'accent and minimal by default — for a COMPLEX, stateful, interactive web APP (a dashboard, a ' +
    'multi-view tool, anything with real client state) where React + Tailwind + shadcn pays off. ' +
    'It uses base:"./" so the built app works at /apps/<slug>/. After scaffolding: run npm install, ' +
    'build screens in src/ from the components in src/components/ui (add more shadcn components as ' +
    'needed), theme via the tokens in src/index.css, then publish_app (it runs the Vite build). For a ' +
    'simple marketing/content/brochure SITE, use create_web_app instead (lighter, no build).',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'App name (shown in the title + sample screen).' },
      accent: { type: 'string', description: 'Brand accent hex (e.g. "#c8432b"). Themes --primary/--ring. Used sparingly.' },
      dest: { type: 'string', description: 'Workspace subfolder to scaffold into (default the workspace root ".").' },
    },
  },
  modes: ['code'],
  summarize: (a) => `scaffold React app${a?.name ? ` "${a.name}"` : ''}`,
  async run(args, ctx) {
    if (!fs.existsSync(TEMPLATE_DIR)) return 'Error: the bundled React template is missing from this build.';
    const destRel = String(args.dest ?? '.').replace(/[^a-zA-Z0-9._/-]/g, '-') || '.';
    let destAbs: string;
    try {
      destAbs = resolveInWorkspace(ctx.repoDir, destRel);
    } catch (e: any) {
      return `Error: ${e?.message ?? e}`;
    }
    try {
      copyTree(TEMPLATE_DIR, destAbs);
    } catch (e: any) {
      return `Error: could not scaffold the React app — ${e?.message ?? e}`;
    }

    const title = (typeof args.name === 'string' && args.name.trim() ? args.name.trim() : 'My App')
      .replace(/["'<>]/g, '')
      .slice(0, 60);
    const slug = slugify(title);
    const accent = cleanHex(args.accent);

    patchAll(path.join(destAbs, 'package.json'), [['__APP_NAME__', slug]]);
    patchAll(path.join(destAbs, 'index.html'), [['__APP_TITLE__', title]]);
    patchAll(path.join(destAbs, 'src', 'App.tsx'), [['__APP_TITLE__', title]]);
    if (accent) {
      const hsl = hexToHslTriplet(accent);
      patchAll(path.join(destAbs, 'src', 'index.css'), [
        ['215 28% 27%; /* __ACCENT_HSL__ — brand accent */', `${hsl}; /* brand accent ${accent} */`],
        ['--ring: 215 28% 27%;', `--ring: ${hsl};`],
      ]);
    }

    const at = destRel === '.' ? 'the workspace root' : `${destRel}/`;
    return (
      `Scaffolded a Vite + React + TypeScript + Tailwind app at ${at} (name "${title}"${accent ? `, accent ${accent}` : ''}). ` +
      `Components in src/components/ui (Button/Card/Input/Label/Tabs/Dialog), the cn() helper in src/lib/utils, ` +
      `tokens + theme in src/index.css (minimal, accent = --primary), Tailwind configured, base:"./" so it works at ` +
      `/apps/<slug>/.\nNOW: (1) run npm install; (2) build your real screens in src/ (edit src/App.tsx; add views/ ` +
      `components, and more shadcn components into src/components/ui as needed — they all use Tailwind + the tokens); ` +
      `(3) keep it MINIMAL · POLISHED · RESPONSIVE — restrained palette, one accent ~5–10%, real states, mobile-first; ` +
      `(4) for icons use lucide-react (already a dep); (5) verify (npm run build must pass — it runs tsc + vite build), ` +
      `then publish_app — publishing runs the Vite build and serves the app. Don't load anything from a CDN; the deps ` +
      `are bundled. The in-canvas PREVIEW builds + serves the static output automatically, so it renders reliably — ` +
      `the user sees it without any dev-server setup. For a simple marketing/content site, create_web_app is the lighter choice.`
    );
  },
};
