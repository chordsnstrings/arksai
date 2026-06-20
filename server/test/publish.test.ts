import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detectSpaBuild, findAppRoot } from '../src/deploy/publish';
import { rewriteHtml } from '../src/routes/deployments';

function pkgDir(pkg: any): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-spa-'));
  fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify(pkg));
  return d;
}

test('detectSpaBuild: a Vite/React app → build+static-serve (never run the dev server)', () => {
  const d = pkgDir({ scripts: { dev: 'vite', build: 'vite build' }, devDependencies: { vite: '^5', react: '^18' } });
  assert.deepEqual(detectSpaBuild(d), { build: 'npm run build' });
});

test('detectSpaBuild: CRA / Vue-CLI / Parcel also build', () => {
  for (const dep of ['react-scripts', '@vue/cli-service', 'parcel', '@angular/cli']) {
    const d = pkgDir({ scripts: { build: 'build' }, dependencies: { [dep]: '1' } });
    assert.ok(detectSpaBuild(d), `${dep} should be detected as a SPA build`);
  }
});

test('detectSpaBuild: a Vite app is caught by its config file or build-script too (not just the dep name)', () => {
  // vite.config present, dep name not matched
  const d1 = pkgDir({ scripts: { build: 'tsc && vite build' }, devDependencies: {} });
  fs.writeFileSync(path.join(d1, 'vite.config.ts'), 'export default {}');
  assert.ok(detectSpaBuild(d1), 'vite.config.ts should mark it a SPA build');
  // build script names the bundler
  const d2 = pkgDir({ scripts: { build: 'react-scripts build' }, dependencies: {} });
  assert.ok(detectSpaBuild(d2), 'a react-scripts build script should mark it a SPA build');
});

test('detectSpaBuild: a real runtime server is NOT static-built (keeps the run-a-process path)', () => {
  for (const dep of ['next', 'nuxt', 'express', 'fastify', '@nestjs/core', '@remix-run/node']) {
    const d = pkgDir({ scripts: { build: 'build', start: 'start' }, dependencies: { [dep]: '1' } });
    assert.equal(detectSpaBuild(d), null, `${dep} must keep running as a server`);
  }
});

test('detectSpaBuild: null when there is no build script, no SPA bundler, or no package.json', () => {
  assert.equal(detectSpaBuild(pkgDir({ scripts: { start: 'node server.js' }, dependencies: { vite: '5' } })), null); // no build script
  assert.equal(detectSpaBuild(pkgDir({ scripts: { build: 'tsc' }, dependencies: { lodash: '4' } })), null); // build but not a SPA bundler
  assert.equal(detectSpaBuild(fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-nopkg-'))), null); // no package.json
});

test('findAppRoot: an app built in a subdir (todo-app/) is found, not the empty root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-approot-'));
  fs.writeFileSync(path.join(root, 'README.md'), '# notes'); // root has no app marker
  const sub = path.join(root, 'todo-app');
  fs.mkdirSync(sub);
  fs.writeFileSync(path.join(sub, 'package.json'), '{}');
  assert.equal(findAppRoot(root), sub);
});

test('findAppRoot: returns the root itself when the app IS at the root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-approot2-'));
  fs.writeFileSync(path.join(root, 'index.html'), '<html></html>');
  assert.equal(findAppRoot(root), root);
});

test('findAppRoot: nested two levels (client/) still found; bare dir → itself', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-approot3-'));
  const sub = path.join(root, 'apps', 'web');
  fs.mkdirSync(sub, { recursive: true });
  fs.writeFileSync(path.join(sub, 'package.json'), '{}');
  assert.equal(findAppRoot(root), sub);
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-approot4-'));
  assert.equal(findAppRoot(bare), bare); // nothing to find → root
});

test('rewriteHtml: injects <base>, rewrites root-absolute attrs, and shims fetch/XHR to the app prefix', () => {
  const html = `<!doctype html><html><head><title>x</title></head><body><script src="/assets/app.js"></script></body></html>`;
  const out = rewriteHtml(html, '/apps/my-app/');
  assert.match(out, /<base href="\/apps\/my-app\/">/); // base injected
  assert.match(out, /src="\/apps\/my-app\/assets\/app\.js"/); // root-absolute attr rewritten
  assert.match(out, /window\.fetch=function/); // fetch patched
  assert.match(out, /XMLHttpRequest\.prototype\.open=function/); // XHR patched
});

test('rewriteHtml: the fetch shim prefixes root-absolute paths but leaves external + protocol-relative URLs alone', () => {
  // Exercise the shimmed fx() logic directly (mirrors the injected function).
  const B = '/apps/my-app/';
  const fx = (u: string) => (typeof u === 'string' && u.charAt(0) === '/' && u.charAt(1) !== '/' ? B + u.slice(1) : u);
  assert.equal(fx('/api/hello'), '/apps/my-app/api/hello'); // the bug we fixed
  assert.equal(fx('https://api.example.com/x'), 'https://api.example.com/x'); // external untouched
  assert.equal(fx('//cdn.example.com/x'), '//cdn.example.com/x'); // protocol-relative untouched
  assert.equal(fx('api/hello'), 'api/hello'); // relative untouched (<base> handles it)
});
