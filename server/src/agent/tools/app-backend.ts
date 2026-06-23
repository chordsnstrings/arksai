import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../../config';
import { resolveInWorkspace, type ToolDef } from './common';

const BACKEND_KIT_DIR = path.join(repoRoot, 'server', 'assets', 'mobile-backend-kit');

/** Copy only the FILES in src (not subdirs) into dest. */
function copyFilesInto(src: string, dest: string) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    const s = path.join(src, f);
    if (fs.statSync(s).isFile()) fs.copyFileSync(s, path.join(dest, f));
  }
}

/**
 * Install the ArksAI app backend kit (Fastify + SQLite) AND its matching typed client API
 * module — so a mobile/PWA app's backend matches the front-end's quality AND the client
 * talks to it the same safe way from every screen. Publish the backend on the normal
 * pipeline to get a live URL; set it in src/api/config.ts. The backend counterpart of the kits.
 */
export const addAppBackendTool: ToolDef = {
  name: 'add_app_backend',
  description:
    'Install a complete app backend + its client: into server/ — server.js (health, JWT auth ' +
    '/auth/register|/auth/login|/me, a sample CRUD resource, a consistent { error:{message,code} } ' +
    'envelope, per-route JSON-schema validation, CORS, binds PORT), db.js (SQLite + idempotent migrate), ' +
    'package.json; AND into src/api/ a typed CLIENT (client.ts = fetch wrapper w/ JWT + AsyncStorage + ' +
    'error-envelope handling, auth.ts = login/register/me, config.ts = the ONE API_BASE_URL). ' +
    'Use whenever an app needs accounts/data/persistence; then extend the real data model + matching ' +
    'client calls, publish the backend (publish_app), and set API_BASE_URL in src/api/config.ts to the ' +
    'live <slug>.apps.arksai.studio URL. Backend + client come wired together.',
  parameters: {
    type: 'object',
    properties: {
      dest: { type: 'string', description: 'Backend subfolder (default "server"). The client always goes to src/api/.' },
    },
  },
  modes: ['code'],
  summarize: () => 'install app backend + client',
  async run(args, ctx) {
    if (!fs.existsSync(BACKEND_KIT_DIR)) return 'Error: the bundled app backend kit is missing from this build.';
    const destRel = String(args.dest ?? 'server').replace(/[^a-zA-Z0-9._/-]/g, '-') || 'server';
    let serverAbs: string;
    let clientAbs: string;
    try {
      serverAbs = resolveInWorkspace(ctx.repoDir, destRel);
      clientAbs = resolveInWorkspace(ctx.repoDir, 'src/api');
    } catch (e: any) {
      return `Error: ${e?.message ?? e}`;
    }
    try {
      copyFilesInto(BACKEND_KIT_DIR, serverAbs); // top-level files = the backend
      copyFilesInto(path.join(BACKEND_KIT_DIR, 'client'), clientAbs); // client/ = the typed client
    } catch (e: any) {
      return `Error: could not install the backend kit — ${e?.message ?? e}`;
    }
    return (
      `Installed the BACKEND into ${destRel}/ (server.js, db.js, package.json) and the matching typed CLIENT into ` +
      `src/api/ (client.ts, auth.ts, config.ts).\n` +
      `BACKEND: cd ${destRel} && npm install && npm start (binds process.env.PORT). Endpoints: GET /health, ` +
      `POST /auth/register, POST /auth/login, GET /me, GET/POST /items. EXTEND with the app's real data model in ` +
      `db.js (a migration) + routes in server.js — KEEP the per-route JSON-schema validation, the ` +
      `{ error:{message,code} } envelope, and the JWT 'auth' preHandler.\n` +
      `CLIENT: import { login, register, me } from 'src/api/auth' and { api } from 'src/api/client' in your ` +
      `screens (api('/items') etc. — JWT is attached automatically). Add matching typed calls as you extend the API.\n` +
      `DEPLOY: publish the backend with publish_app → it returns the live https URL → set API_BASE_URL in ` +
      `src/api/config.ts to that URL. Needs @react-native-async-storage/async-storage (expo install it).`
    );
  },
};
