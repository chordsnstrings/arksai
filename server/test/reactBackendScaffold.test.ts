import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createReactAppTool } from '../src/agent/tools/react-app';

function ctx(dir: string): any {
  return { repoDir: dir, mode: 'code', signal: new AbortController().signal, addCost: () => {}, session: {} };
}

test('create_react_app backend:true scaffolds a full-stack single service with correct API routing', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-rb-'));
  const out = await createReactAppTool.run({ name: 'Test App', accent: '#1f6a3a', backend: true }, ctx(d));
  assert.match(out, /FULL-STACK/);

  // server files exist
  const serverIdx = fs.readFileSync(path.join(d, 'server', 'index.js'), 'utf8');
  assert.ok(fs.existsSync(path.join(d, 'server', 'db.js')), 'server/db.js exists');

  // THE critical property: /api (router + 404) is registered BEFORE the SPA history fallback,
  // so GET /api/* can never fall through to index.html.
  const apiMount = serverIdx.indexOf("app.use('/api', api)");
  const api404 = serverIdx.indexOf("app.use('/api', (_req, res) => res.status(404)");
  const spaFallback = serverIdx.indexOf('app.get(/.*/');
  assert.ok(apiMount > 0 && api404 > 0 && spaFallback > 0, 'all three present');
  assert.ok(apiMount < spaFallback, 'API router mounted before the SPA fallback');
  assert.ok(api404 < spaFallback, 'API 404 registered before the SPA fallback');
  assert.match(serverIdx, /process\.env\.PORT/, 'listens on PORT');

  // package.json: single deployable service — build + start, runtime deps present
  const pkg = JSON.parse(fs.readFileSync(path.join(d, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.start, 'node server/index.js');
  assert.match(pkg.scripts.build, /vite build/);
  assert.ok(pkg.dependencies.express, 'express runtime dep');
  assert.ok(pkg.dependencies['better-sqlite3'], 'better-sqlite3 runtime dep');

  // vite dev proxy so `npm run dev` reaches the API
  const vite = fs.readFileSync(path.join(d, 'vite.config.ts'), 'utf8');
  assert.match(vite, /proxy:\s*\{\s*'\/api'/);
});

test('create_react_app without backend stays a frontend-only SPA (no server/, no express)', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-rf-'));
  const out = await createReactAppTool.run({ name: 'Static App' }, ctx(d));
  assert.doesNotMatch(out, /FULL-STACK/);
  assert.ok(!fs.existsSync(path.join(d, 'server')), 'no server dir');
  const pkg = JSON.parse(fs.readFileSync(path.join(d, 'package.json'), 'utf8'));
  assert.ok(!pkg.dependencies.express, 'no express in a static SPA');
});
