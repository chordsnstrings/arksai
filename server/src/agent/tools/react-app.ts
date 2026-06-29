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

// A correct Express + SQLite server for the Vite SPA. The ONE thing it gets right that
// hand-rolled servers repeatedly get wrong: /api routes (and an /api 404) are registered
// BEFORE the SPA history fallback, so a GET /api/* can never fall through to index.html
// (which returns HTML and breaks the client's JSON fetch with "Unexpected token '<'").
const SERVER_INDEX = `import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, init } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // accept normal HTML <form> posts too

init();

// ===========================================================================
// API ROUTES — add yours here. They are mounted under /api and resolved BEFORE
// the SPA fallback at the bottom, so /api/* always returns JSON, never HTML.
// ===========================================================================
const api = express.Router();

api.get('/health', (_req, res) => res.json({ ok: true }));

// Sample CRUD over the \`items\` table (see db.js) — replace with your real routes.
api.get('/items', (_req, res) => {
  res.json({ items: db.prepare('SELECT * FROM items ORDER BY id DESC').all() });
});
api.post('/items', (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  if (!name) return res.status(400).json({ error: 'name is required' });
  const info = db.prepare('INSERT INTO items (name) VALUES (?)').run(name);
  res.status(201).json({ item: db.prepare('SELECT * FROM items WHERE id = ?').get(info.lastInsertRowid) });
});

app.use('/api', api);
// Unknown /api/* → JSON 404. This MUST come before the SPA fallback so an API
// typo never returns index.html (the "Unexpected token '<'" client crash).
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// ===========================================================================
// STATIC SPA — serve the Vite build (dist/) with a history fallback for client routes.
// ===========================================================================
const dist = path.join(__dirname, '..', 'dist');
app.use(express.static(dist));
// History fallback (regex form works in BOTH Express 4 and 5 — bare '*' throws in Express 5).
app.get(/.*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(\`server listening on :\${PORT}\`));
`;

const SERVER_DB = `import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// The SQLite file lives in ./data BESIDE the app by construction — a single, writable,
// deployment-stable location that persists on republish. Use APP_DATA_DIR (a dedicated name)
// only to mount a persistent disk on an external host; never the generic DATA_DIR, which the
// hosting platform sets for its OWN storage and would otherwise hijack the app's DB path.
const dataDir = process.env.APP_DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

export const db = new Database(path.join(dataDir, 'app.db'));
db.pragma('journal_mode = WAL');

export function init() {
  // Idempotent schema — safe to run on every boot. Add your tables here.
  db.exec(\`
    CREATE TABLE IF NOT EXISTS items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  \`);
}
`;

/** Add a correct Express + SQLite backend to a scaffolded Vite app (single deployable service). */
function scaffoldBackend(destAbs: string): void {
  const serverDir = path.join(destAbs, 'server');
  fs.mkdirSync(serverDir, { recursive: true });
  fs.writeFileSync(path.join(serverDir, 'index.js'), SERVER_INDEX);
  fs.writeFileSync(path.join(serverDir, 'db.js'), SERVER_DB);

  // package.json → one deployable service: build the SPA, then `npm start` runs the
  // server which serves the built dist/ AND the API on a single process.env.PORT.
  const pkgPath = path.join(destAbs, 'package.json');
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    pkg.scripts = {
      ...pkg.scripts,
      // dev: vite (5173) + server (4000) together; vite proxies /api → the server.
      dev: 'concurrently -k -n WEB,API "vite" "node --watch server/index.js"',
      build: 'tsc --noEmit && vite build',
      start: 'node server/index.js',
    };
    delete pkg.scripts.preview;
    pkg.dependencies = { ...pkg.dependencies, express: '^4.21.0', 'better-sqlite3': '^11.3.0' };
    pkg.devDependencies = { ...pkg.devDependencies, concurrently: '^9.0.0' };
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  } catch {
    /* leave package.json as-is if it can't be parsed */
  }

  // vite dev proxy so `npm run dev` reaches the API on :4000 (production needs no proxy —
  // the server serves /api itself).
  const vitePath = path.join(destAbs, 'vite.config.ts');
  patchAll(vitePath, [
    [
      "  resolve: {\n    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },\n  },\n});",
      "  resolve: {\n    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },\n  },\n  server: { proxy: { '/api': 'http://localhost:4000' } },\n});",
    ],
  ]);

  // keep the SQLite data dir + build output out of git
  fs.writeFileSync(path.join(destAbs, '.gitignore'), 'node_modules\ndist\ndata\n*.log\n');
}

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
    'It uses base:"./" so the built app works at /apps/<slug>/. Set backend:true to ALSO scaffold a ' +
    'correct Express + SQLite server (single deployable service): the API routes are pre-wired BEFORE the ' +
    'SPA fallback so GET /api/* always returns JSON (never the "Unexpected token \'<\'" trap), it reads ' +
    'process.env.PORT, and `npm start` serves the built SPA AND the API on one port — use this for any ' +
    'app that PERSISTS data. After scaffolding: npm install, build screens in src/ from src/components/ui, ' +
    '(with backend) add your routes in server/index.js + tables in server/db.js, then publish_app (runs the ' +
    'Vite build + boots the server). The SQLite file path is handled FOR YOU — it lives at ./data/app.db ' +
    'beside the app by construction; do NOT change it, set DATA_DIR, or hunt for/move the .db file (that path ' +
    'is correct and stable, and chasing it is a wasted loop). Just add your tables in server/db.js. For a ' +
    'simple static marketing/brochure SITE, use create_web_app instead.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'App name (shown in the title + sample screen).' },
      accent: { type: 'string', description: 'Brand accent hex (e.g. "#c8432b"). Themes --primary/--ring. Used sparingly.' },
      backend: { type: 'boolean', description: 'Also scaffold a correct Express + SQLite backend (one deployable service). Use for any data-persisting app.' },
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

    const backend = args.backend === true || args.backend === 'true';
    if (backend) {
      try {
        scaffoldBackend(destAbs);
      } catch (e: any) {
        return `Scaffolded the frontend, but the backend step failed — ${e?.message ?? e}`;
      }
    }

    const at = destRel === '.' ? 'the workspace root' : `${destRel}/`;
    const base =
      `Scaffolded a Vite + React + TypeScript + Tailwind app at ${at} (name "${title}"${accent ? `, accent ${accent}` : ''}). ` +
      `Components in src/components/ui (Button/Card/Input/Label/Tabs/Dialog), the cn() helper in src/lib/utils, ` +
      `tokens + theme in src/index.css (minimal, accent = --primary), Tailwind configured, base:"./" so it works at ` +
      `/apps/<slug>/.`;
    if (backend) {
      return (
        base +
        `\nFULL-STACK (backend included): a single deployable service — \`server/index.js\` (Express) serves the ` +
        `built dist/ AND the API, \`server/db.js\` sets up SQLite. The API is ALREADY wired correctly: routes under ` +
        `/api are registered before the SPA fallback, with an /api 404, so GET /api/* never returns HTML.\n` +
        `NOW: (1) npm install; (2) build your screens in src/ (fetch your data from /api/...); (3) add your real ` +
        `routes in server/index.js and tables in server/db.js (keep the schema in init(), idempotent); (4) keep it ` +
        `MINIMAL · POLISHED · RESPONSIVE, mobile-first, lucide-react for icons; (5) TO TEST/PREVIEW & PUBLISH: run ` +
        `\`npm run build\` then \`npm start\` — the server serves the SPA + API together on process.env.PORT (default ` +
        `4000), exactly like production; do NOT run \`vite\` alone to verify (that's frontend-only, no API). Then ` +
        `publish_app boots the server. The DB persists to ./data (mountable on DigitalOcean). No CDNs — deps are bundled.`
      );
    }
    return (
      base +
      `\nNOW: (1) run npm install; (2) build your real screens in src/ (edit src/App.tsx; add views/ ` +
      `components, and more shadcn components into src/components/ui as needed — they all use Tailwind + the tokens); ` +
      `(3) keep it MINIMAL · POLISHED · RESPONSIVE — restrained palette, one accent ~5–10%, real states, mobile-first; ` +
      `(4) for icons use lucide-react (already a dep); (5) verify (npm run build must pass — it runs tsc + vite build), ` +
      `then publish_app — publishing runs the Vite build and serves the app. Don't load anything from a CDN; the deps ` +
      `are bundled. The in-canvas PREVIEW builds + serves the static output automatically, so it renders reliably — ` +
      `the user sees it without any dev-server setup. If the app needs to PERSIST data, re-scaffold with backend:true. ` +
      `For a simple marketing/content site, create_web_app is the lighter choice.`
    );
  },
};
