import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ToolCtx } from '../src/agent/tools/common';
import { addWebComponentsTool } from '../src/agent/tools/web-components';

const ctx = (ws: string): ToolCtx => ({
  session: { id: 's1' } as any,
  repoDir: ws,
  mode: 'code',
  signal: new AbortController().signal,
  addCost: () => {},
});

test('add_web_components self-hosts a lean runtime into ui-kit/wa', async () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-wc-'));
  const out = await addWebComponentsTool.run({}, ctx(ws));
  const wa = path.join(ws, 'ui-kit', 'wa');
  assert.ok(fs.existsSync(path.join(wa, 'shoelace-autoloader.js')), 'autoloader copied');
  assert.ok(fs.existsSync(path.join(wa, 'themes', 'light.css')), 'theme copied');
  assert.ok(fs.existsSync(path.join(wa, 'wa-theme.css')), 'token bridge copied');
  assert.ok(fs.existsSync(path.join(wa, 'components', 'dialog')), 'a component is present');
  // the lean runtime drops the heavy Bootstrap-Icons asset bundle
  assert.ok(!fs.existsSync(path.join(wa, 'assets')), 'icon asset bundle is omitted (lean)');
  // the REQUIRED base-path attribute is in the instructions
  assert.match(out, /data-shoelace="\."/);
});

test('the token bridge themes components to OUR accent (not Shoelace blue)', () => {
  const repoRoot = path.join(__dirname, '..', '..');
  const bridge = fs.readFileSync(
    path.join(__dirname, '..', 'assets', 'web-components', 'wa-theme.css'),
    'utf8',
  );
  assert.match(bridge, /--sl-color-primary-600:\s*var\(--accent/);
  assert.match(bridge, /--sl-font-sans:\s*var\(--font/);
  assert.match(bridge, /--sl-border-radius-medium:\s*var\(--radius/);
  void repoRoot;
});

test('respects a custom serve dir (public/)', async () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-wc2-'));
  const out = await addWebComponentsTool.run({ dest: 'public' }, ctx(ws));
  assert.ok(fs.existsSync(path.join(ws, 'public', 'ui-kit', 'wa', 'shoelace-autoloader.js')));
  assert.match(out, /public\/ui-kit\/wa/);
});
