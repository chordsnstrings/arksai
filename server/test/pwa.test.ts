import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { addPwaTool } from '../src/agent/tools/pwa';

const ctxFor = (dir: string): any => ({ repoDir: dir, session: {}, mode: 'code', signal: new AbortController().signal, addCost() {} });
const HTML = `<!doctype html><html><head><title>Onda</title></head><body><h1>Onda Car Care</h1></body></html>`;

test('add_pwa: plain static site → valid manifest, safe SW, never-missing icon, wired HTML', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pwa-'));
  fs.writeFileSync(path.join(dir, 'index.html'), HTML);
  const out = await addPwaTool.run({ name: 'Onda Car Care', theme_color: '#0b6fae' }, ctxFor(dir));
  assert.match(out, /installable PWA/i);

  // Manifest is valid + has the required installability fields.
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.name, 'Onda Car Care');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, './');
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 1, 'has icons');
  assert.ok(manifest.icons.some((i: any) => /maskable/.test(i.purpose)), 'has a maskable icon');

  // Service worker exists and is safe (passes through non-GET/cross-origin, network-first navigation).
  const sw = fs.readFileSync(path.join(dir, 'sw.js'), 'utf8');
  assert.match(sw, /method !== 'GET'/);
  assert.match(sw, /navigate/);

  // Every icon the manifest references actually EXISTS on disk (the "never a missing icon" guarantee).
  for (const icon of manifest.icons) {
    assert.ok(fs.existsSync(path.join(dir, icon.src)), `icon ${icon.src} exists`);
  }
  assert.ok(fs.existsSync(path.join(dir, 'icons', 'icon.svg')), 'vector icon always written');

  // HTML wired: manifest link, theme-color, SW registration.
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  assert.match(html, /rel="manifest"/);
  assert.match(html, /name="theme-color"/);
  assert.match(html, /serviceWorker\.register/);
});

test('add_pwa: idempotent — running twice does not duplicate the head tags', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pwa2-'));
  fs.writeFileSync(path.join(dir, 'index.html'), HTML);
  await addPwaTool.run({ name: 'Twice' }, ctxFor(dir));
  await addPwaTool.run({ name: 'Twice' }, ctxFor(dir));
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  assert.equal((html.match(/rel="manifest"/g) || []).length, 1, 'manifest link not duplicated');
  assert.equal((html.match(/serviceWorker\.register/g) || []).length, 1, 'registration not duplicated');
});

test('add_pwa: Vite app → assets land in public/ (so the build copies them to the output root)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pwa3-'));
  fs.writeFileSync(path.join(dir, 'index.html'), HTML);
  fs.writeFileSync(path.join(dir, 'vite.config.ts'), 'export default {}');
  await addPwaTool.run({ name: 'Vite App' }, ctxFor(dir));
  assert.ok(fs.existsSync(path.join(dir, 'public', 'manifest.webmanifest')), 'manifest in public/');
  assert.ok(fs.existsSync(path.join(dir, 'public', 'sw.js')), 'sw in public/');
  assert.ok(fs.existsSync(path.join(dir, 'public', 'icons', 'icon.svg')), 'icon in public/');
});

test('add_pwa: no HTML to attach to → actionable error, not a crash', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pwa4-'));
  const out = await addPwaTool.run({ name: 'Nope' }, ctxFor(dir));
  assert.match(out, /no HTML entry/i);
});
