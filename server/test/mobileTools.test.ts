import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ToolCtx } from '../src/agent/tools/common';
import { createExpoAppTool } from '../src/agent/tools/expo-app';
import { addMobileUiKitTool } from '../src/agent/tools/mobile-ui-kit';
import { addAppBackendTool } from '../src/agent/tools/app-backend';

function ws(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-mobile-'));
}
function ctx(dir: string): ToolCtx {
  return {
    session: { id: 's1' } as any,
    repoDir: dir,
    mode: 'code',
    signal: new AbortController().signal,
    addCost: () => {},
  } as any;
}

test('create_expo_app scaffolds a runnable, crash-safe, kit-wired Expo app', async () => {
  const dir = ws();
  const res = await createExpoAppTool.run({ name: 'Snap QR', accent: '#e23744' }, ctx(dir));
  assert.doesNotMatch(res, /^Error/);

  // Core files exist.
  for (const f of ['package.json', 'app.json', 'tsconfig.json', 'babel.config.js', 'app/_layout.tsx', 'app/index.tsx']) {
    assert.ok(fs.existsSync(path.join(dir, f)), `missing ${f}`);
  }
  // The mobile UI kit was dropped into src/ui.
  for (const f of ['tokens.ts', 'components.tsx', 'ErrorBoundary.tsx']) {
    assert.ok(fs.existsSync(path.join(dir, 'src', 'ui', f)), `missing src/ui/${f}`);
  }

  // Root is crash-safe + theme-wired with the chosen accent.
  const layout = fs.readFileSync(path.join(dir, 'app', '_layout.tsx'), 'utf8');
  assert.match(layout, /AppErrorBoundary/);
  assert.match(layout, /ThemeProvider/);
  assert.match(layout, /brandTheme\('#e23744'\)/);

  // Name + slug + Android package were personalized.
  const appjson = JSON.parse(fs.readFileSync(path.join(dir, 'app.json'), 'utf8'));
  assert.equal(appjson.expo.name, 'Snap QR');
  assert.equal(appjson.expo.slug, 'snap-qr');
  assert.equal(appjson.expo.android.package, 'studio.arksai.snapqr');
  assert.equal(appjson.expo.web.output, 'single'); // single-page web for the Canvas preview

  // Expo + expo-router are declared.
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  assert.ok(pkg.dependencies.expo);
  assert.ok(pkg.dependencies['expo-router']);
});

test('create_expo_app rejects path traversal in dest', async () => {
  const res = await createExpoAppTool.run({ dest: '../../etc' }, ctx(ws()));
  assert.match(res, /^Error/);
});

test('add_mobile_ui_kit installs the RN kit', async () => {
  const dir = ws();
  const res = await addMobileUiKitTool.run({}, ctx(dir));
  assert.doesNotMatch(res, /^Error/);
  for (const f of ['tokens.ts', 'components.tsx', 'ErrorBoundary.tsx']) {
    assert.ok(fs.existsSync(path.join(dir, 'src', 'ui', f)), `missing src/ui/${f}`);
  }
});

test('add_app_backend installs a validated Fastify + SQLite backend', async () => {
  const dir = ws();
  const res = await addAppBackendTool.run({}, ctx(dir));
  assert.doesNotMatch(res, /^Error/);
  for (const f of ['server.js', 'db.js', 'package.json', 'README.md']) {
    assert.ok(fs.existsSync(path.join(dir, 'server', f)), `missing server/${f}`);
  }
  const server = fs.readFileSync(path.join(dir, 'server', 'server.js'), 'utf8');
  // The quality patterns must be present: error envelope, auth preHandler, schema validation, PORT bind.
  assert.match(server, /error:\s*\{\s*message/);
  assert.match(server, /jwtVerify/);
  assert.match(server, /schema:/);
  assert.match(server, /process\.env\.PORT/);
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'server', 'package.json'), 'utf8'));
  assert.ok(pkg.dependencies.fastify);
});
