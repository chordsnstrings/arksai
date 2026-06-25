import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ToolCtx } from '../src/agent/tools/common';
import { createReactAppTool, hexToHslTriplet } from '../src/agent/tools/react-app';

const ctx = (ws: string): ToolCtx => ({
  session: { id: 's1' } as any,
  repoDir: ws,
  mode: 'code',
  signal: new AbortController().signal,
  addCost: () => {},
});

test('hexToHslTriplet converts hex to the shadcn "H S% L%" format', () => {
  assert.equal(hexToHslTriplet('#ffffff'), '0 0% 100%');
  assert.equal(hexToHslTriplet('#000000'), '0 0% 0%');
  // a vermilion → red-ish hue, mid saturation/lightness
  const t = hexToHslTriplet('#c8432b').split(' ');
  assert.ok(Number(t[0]) >= 0 && Number(t[0]) <= 20, 'red hue');
  assert.match(hexToHslTriplet('#c8432b'), /^\d+ \d+% \d+%$/);
});

test('create_react_app scaffolds a themed Vite+React+Tailwind app', async () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-rt-'));
  const out = await createReactAppTool.run({ name: 'Helio Analytics', accent: '#c8432b' }, ctx(ws));
  // core files
  for (const f of ['package.json', 'vite.config.ts', 'tailwind.config.js', 'tsconfig.json', 'index.html', 'src/main.tsx', 'src/App.tsx', 'src/index.css', 'src/lib/utils.ts']) {
    assert.ok(fs.existsSync(path.join(ws, f)), `missing ${f}`);
  }
  // shadcn-style components vendored
  for (const c of ['button', 'card', 'input', 'label', 'tabs', 'dialog']) {
    assert.ok(fs.existsSync(path.join(ws, 'src', 'components', 'ui', `${c}.tsx`)), `missing ui/${c}`);
  }
  // self-hosted SMOOTH fonts (Inter + Source Serif 4 — NOT a system fallback, NOT Spectral)
  assert.ok(fs.existsSync(path.join(ws, 'src', 'fonts', 'inter-400.woff2')));
  assert.ok(fs.existsSync(path.join(ws, 'src', 'fonts', 'source-serif-600.woff2')));
  assert.ok(!fs.existsSync(path.join(ws, 'src', 'fonts', 'spectral-600.woff2')), 'irregular Spectral removed');
  const css = fs.readFileSync(path.join(ws, 'src', 'index.css'), 'utf8');
  assert.match(css, /@font-face[\s\S]*Inter/);
  assert.match(css, /Source Serif 4/);
  // placeholders patched + accent themed to HSL
  const pkg = fs.readFileSync(path.join(ws, 'package.json'), 'utf8');
  assert.match(pkg, /"name": "helio-analytics"/);
  assert.doesNotMatch(css, /__ACCENT_HSL__/);
  assert.match(css, /--primary: \d+ \d+% \d+%;/);
  // base ./ for subfolder serving
  assert.match(fs.readFileSync(path.join(ws, 'vite.config.ts'), 'utf8'), /base:\s*'\.\/'/);
  assert.match(out, /Vite \+ React/);
});
