import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../../config';
import { resolveInWorkspace, type ToolDef } from './common';

const BACKEND_KIT_DIR = path.join(repoRoot, 'server', 'assets', 'mobile-backend-kit');

function copyDirInto(src: string, dest: string) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    const s = path.join(src, f);
    if (fs.statSync(s).isFile()) fs.copyFileSync(s, path.join(dest, f));
  }
}

/**
 * Install the ArksAI app backend kit (Fastify + SQLite) — a clean, typed, validated API
 * starter (JWT auth, error envelope, a sample resource) — into an app's backend folder so
 * a mobile/PWA app's backend matches the front-end's quality. Publish it on the normal
 * pipeline to get a live URL the client calls. The backend counterpart of add_mobile_ui_kit.
 */
export const addAppBackendTool: ToolDef = {
  name: 'add_app_backend',
  description:
    'Install the ArksAI app backend kit (Fastify + SQLite) into an app: server.js (health, JWT auth ' +
    '/auth/register|/auth/login|/me, a sample CRUD resource, a consistent error envelope, per-route ' +
    'JSON-schema validation, CORS, binds PORT), db.js (SQLite + idempotent migrate), package.json. ' +
    'Use it whenever an app needs accounts/data/persistence; then extend with the real data model ' +
    '(keep the validation/envelope/auth patterns) and publish it to get a live <slug>.apps URL the ' +
    'mobile/PWA client calls. The backend counterpart of add_mobile_ui_kit.',
  parameters: {
    type: 'object',
    properties: {
      dest: { type: 'string', description: 'Workspace subfolder to install into (default "server").' },
    },
  },
  modes: ['code'],
  summarize: () => 'install app backend kit',
  async run(args, ctx) {
    if (!fs.existsSync(BACKEND_KIT_DIR)) return 'Error: the bundled app backend kit is missing from this build.';
    const destRel = String(args.dest ?? 'server').replace(/[^a-zA-Z0-9._/-]/g, '-') || 'server';
    let destAbs: string;
    try {
      destAbs = resolveInWorkspace(ctx.repoDir, destRel);
    } catch (e: any) {
      return `Error: ${e?.message ?? e}`;
    }
    try {
      copyDirInto(BACKEND_KIT_DIR, destAbs);
    } catch (e: any) {
      return `Error: could not install the backend kit — ${e?.message ?? e}`;
    }
    return (
      `Installed the app backend kit into ${destRel}/ (server.js, db.js, package.json, README.md).\n` +
      `Run: cd ${destRel} && npm install && npm start (binds process.env.PORT). Endpoints: GET /health, ` +
      `POST /auth/register, POST /auth/login, GET /me, GET/POST /items.\n` +
      `EXTEND with the app's real data model in db.js (a migration) + routes in server.js — KEEP the ` +
      `patterns: per-route JSON-schema validation, the { error: { message, code } } envelope, and the ` +
      `JWT 'auth' preHandler on protected routes. Then PUBLISH it (publish_app) to get the live ` +
      `<slug>.apps.arksai.studio URL; wire the mobile/PWA client to that base URL with the JWT from login.`
    );
  },
};
