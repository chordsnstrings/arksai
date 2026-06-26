import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detectStack, buildRepoPrimer } from '../src/agent/repoPrimer';
import { parseOwnerRepo } from '../src/github/pr';

function tmpRepo(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-primer-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return dir;
}

test('detectStack: node + typescript + frameworks + scripts + package manager', () => {
  const dir = tmpRepo({
    'package.json': JSON.stringify({
      scripts: { dev: 'vite', build: 'vite build', test: 'vitest' },
      dependencies: { react: '^18', fastify: '^4' },
    }),
    'tsconfig.json': '{}',
    'package-lock.json': '{}',
  });
  const s = detectStack(dir);
  assert.ok(s.langs.includes('Node/TypeScript'));
  assert.ok(s.frameworks.includes('React'));
  assert.ok(s.frameworks.includes('Fastify'));
  assert.deepEqual(s.scripts.sort(), ['build', 'dev', 'test']);
  assert.equal(s.packageManager, 'npm');
});

test('detectStack: polyglot markers (go + python)', () => {
  const dir = tmpRepo({ 'go.mod': 'module x', 'requirements.txt': 'flask' });
  const s = detectStack(dir);
  assert.ok(s.langs.includes('Go'));
  assert.ok(s.langs.includes('Python'));
});

test('buildRepoPrimer: produces an orientation block with stack, scripts, layout, and docs', () => {
  const dir = tmpRepo({
    'package.json': JSON.stringify({ scripts: { build: 'tsc' }, dependencies: { next: '^14' } }),
    'tsconfig.json': '{}',
    'README.md': '# Cool App\nThis app does cool things.',
    'AGENTS.md': 'Run npm test before pushing.',
    'src/index.ts': 'export const x = 1;',
  });
  const primer = buildRepoPrimer(dir, 'me/cool-app')!;
  assert.match(primer, /## Repository: me\/cool-app/);
  assert.match(primer, /Node\/TypeScript/);
  assert.match(primer, /Next\.js/);
  assert.match(primer, /Scripts.*build/);
  assert.match(primer, /Layout/);
  assert.match(primer, /src\//);
  assert.match(primer, /Run npm test before pushing/); // AGENTS.md surfaced
  assert.match(primer, /This app does cool things/); // README surfaced
});

test('buildRepoPrimer: returns null for an empty workspace', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-empty-'));
  assert.equal(buildRepoPrimer(dir, null), null);
});

test('parseOwnerRepo: owner/repo and full URL forms', () => {
  assert.deepEqual(parseOwnerRepo('octocat/Hello-World'), { owner: 'octocat', repo: 'Hello-World' });
  assert.deepEqual(parseOwnerRepo('https://github.com/octocat/Hello-World.git'), {
    owner: 'octocat',
    repo: 'Hello-World',
  });
  assert.equal(parseOwnerRepo('not a repo'), null);
});
