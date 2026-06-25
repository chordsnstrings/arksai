import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detectFrontendBuild } from '../src/agent/canvasExport';

function ws(pkg: any, extra?: (dir: string) => void): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-fe-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
  extra?.(dir);
  return dir;
}

test('detects a Vite app → build to dist', () => {
  const dir = ws({ scripts: { build: 'vite build', dev: 'vite' }, devDependencies: { vite: '^5' } });
  assert.deepEqual(detectFrontendBuild(dir), { outDir: 'dist' });
});

test('detects Vite via config file even without an explicit dep entry', () => {
  const dir = ws({ scripts: { build: 'vite build' } }, (d) => fs.writeFileSync(path.join(d, 'vite.config.ts'), ''));
  assert.deepEqual(detectFrontendBuild(dir), { outDir: 'dist' });
});

test('Create React App → build/', () => {
  const dir = ws({ scripts: { build: 'react-scripts build' }, dependencies: { 'react-scripts': '5' } });
  assert.deepEqual(detectFrontendBuild(dir), { outDir: 'build' });
});

test('Gatsby → public/', () => {
  const dir = ws({ scripts: { build: 'gatsby build' }, dependencies: { gatsby: '5' } });
  assert.deepEqual(detectFrontendBuild(dir), { outDir: 'public' });
});

test('SSR frameworks (Next) are NOT static-served (run their own server)', () => {
  const dir = ws({ scripts: { build: 'next build', start: 'next start' }, dependencies: { next: '14' } });
  assert.equal(detectFrontendBuild(dir), null);
});

test('a plain node API/server is not a frontend build', () => {
  const dir = ws({ scripts: { start: 'node server.js' }, dependencies: { fastify: '4' } });
  assert.equal(detectFrontendBuild(dir), null);
});

test('a project with no build script is not a frontend build', () => {
  const dir = ws({ scripts: { dev: 'vite' }, devDependencies: { vite: '5' } });
  assert.equal(detectFrontendBuild(dir), null);
});
