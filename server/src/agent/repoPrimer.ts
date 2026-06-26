// Repo onboarding primer (Phase 3): a cheap, deterministic "## Repository" orientation block
// injected into the system prompt when a real repo is connected — detected stack, package
// scripts, a shallow file tree, and the top of README/AGENTS/CLAUDE/CONTRIBUTING — so the agent
// starts grounded (good answers + safe edits) instead of discovering the whole layout blind via
// glob/grep. No model call needed. Mirrors how the "## Project" block already works.

import fs from 'node:fs';
import path from 'node:path';

export interface RepoStack {
  langs: string[]; // e.g. ['Node/TypeScript', 'Go']
  scripts: string[]; // package.json script names (node)
  frameworks: string[]; // react / next / fastify / …
  packageManager: string | null;
}

const FRAMEWORK_HINTS: Array<[RegExp, string]> = [
  [/\bnext\b/, 'Next.js'],
  [/\breact\b/, 'React'],
  [/\bvue\b/, 'Vue'],
  [/\bsvelte\b/, 'Svelte'],
  [/\b@angular\/core\b/, 'Angular'],
  [/\bastro\b/, 'Astro'],
  [/\bvite\b/, 'Vite'],
  [/\bfastify\b/, 'Fastify'],
  [/\bexpress\b/, 'Express'],
  [/\bnestjs|@nestjs\/core\b/, 'NestJS'],
  [/\btailwindcss\b/, 'Tailwind'],
];

/** Pure-ish stack detection from the marker files in a repo root. */
export function detectStack(dir: string): RepoStack {
  const stack: RepoStack = { langs: [], scripts: [], frameworks: [], packageManager: null };
  const has = (f: string) => fs.existsSync(path.join(dir, f));
  const readJson = (f: string): any => {
    try {
      return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    } catch {
      return null;
    }
  };

  if (has('package.json')) {
    const pkg = readJson('package.json') || {};
    const isTs = has('tsconfig.json');
    stack.langs.push(isTs ? 'Node/TypeScript' : 'Node/JavaScript');
    stack.scripts = Object.keys(pkg.scripts || {});
    if (typeof pkg.packageManager === 'string') stack.packageManager = pkg.packageManager.split('@')[0];
    else if (has('pnpm-lock.yaml')) stack.packageManager = 'pnpm';
    else if (has('yarn.lock')) stack.packageManager = 'yarn';
    else if (has('bun.lockb')) stack.packageManager = 'bun';
    else if (has('package-lock.json')) stack.packageManager = 'npm';
    const deps = JSON.stringify({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }).toLowerCase();
    for (const [re, name] of FRAMEWORK_HINTS) if (re.test(deps)) stack.frameworks.push(name);
  }
  if (has('go.mod')) stack.langs.push('Go');
  if (has('Cargo.toml')) stack.langs.push('Rust');
  if (has('pyproject.toml') || has('requirements.txt') || has('setup.py')) stack.langs.push('Python');
  if (has('pom.xml') || has('build.gradle') || has('build.gradle.kts')) stack.langs.push('Java/JVM');
  if (has('Gemfile')) stack.langs.push('Ruby');
  if (has('composer.json')) stack.langs.push('PHP');
  // de-dupe, keep order
  stack.frameworks = [...new Set(stack.frameworks)];
  stack.langs = [...new Set(stack.langs)];
  return stack;
}

const IGNORE_DIRS = new Set([
  'node_modules', '.git', '.venv', 'venv', 'env', '__pycache__', 'dist', 'build', 'out',
  '.next', '.nuxt', 'target', 'vendor', '.cache', 'coverage', '.turbo', '.svelte-kit',
]);

/** A shallow tree: top-level entries, plus one level inside the obvious source dirs. */
function shallowTree(dir: string): string[] {
  const lines: string[] = [];
  let top: fs.Dirent[];
  try {
    top = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return lines;
  }
  top = top
    .filter((e) => !(e.isDirectory() && IGNORE_DIRS.has(e.name)) && !e.name.startsWith('.git'))
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
    .slice(0, 40);
  for (const e of top) {
    if (e.isDirectory()) {
      lines.push(`${e.name}/`);
      if (['src', 'app', 'lib', 'server', 'client', 'packages', 'cmd', 'internal'].includes(e.name)) {
        try {
          const kids = fs
            .readdirSync(path.join(dir, e.name), { withFileTypes: true })
            .filter((k) => !(k.isDirectory() && IGNORE_DIRS.has(k.name)))
            .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
            .slice(0, 16);
          for (const k of kids) lines.push(`  ${e.name}/${k.name}${k.isDirectory() ? '/' : ''}`);
        } catch {
          /* unreadable */
        }
      }
    } else {
      lines.push(e.name);
    }
  }
  return lines;
}

/** First N chars of the first existing doc among the candidates. */
function topOfDoc(dir: string, names: string[], cap = 1000): { name: string; text: string } | null {
  for (const n of names) {
    const p = path.join(dir, n);
    try {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) {
        const raw = fs.readFileSync(p, 'utf8').trim();
        if (raw) return { name: n, text: raw.length > cap ? raw.slice(0, cap) + '…' : raw };
      }
    } catch {
      /* skip */
    }
  }
  return null;
}

/**
 * Build the "## Repository" orientation block, or null if the workspace has no useful signal
 * (empty/fresh workspace). Bounded in size so it never dominates the context.
 */
export function buildRepoPrimer(dir: string, repoName?: string | null): string | null {
  if (!dir || !fs.existsSync(dir)) return null;
  const stack = detectStack(dir);
  const tree = shallowTree(dir);
  if (!stack.langs.length && tree.length === 0) return null;

  const header = repoName
    ? `## Repository: ${repoName} — orientation (you're working on an existing codebase)`
    : `## Repository — orientation (you're working on an existing codebase)`;
  const lines = [header];

  if (stack.langs.length) lines.push(`\nStack: ${stack.langs.join(', ')}${stack.frameworks.length ? ` · ${stack.frameworks.join(', ')}` : ''}.`);
  if (stack.packageManager) lines.push(`Package manager: ${stack.packageManager}.`);
  if (stack.scripts.length)
    lines.push(`Scripts (run via the package manager): ${stack.scripts.slice(0, 16).join(', ')}.`);

  if (tree.length) lines.push(`\nLayout (top level):\n${tree.map((l) => `  ${l}`).join('\n')}`);

  // Contributor docs — read these BEFORE making changes (conventions live here).
  const agents = topOfDoc(dir, ['AGENTS.md', 'CLAUDE.md', '.cursorrules'], 1400);
  if (agents) lines.push(`\nContributor guide (${agents.name}) — follow it:\n${agents.text}`);
  const readme = topOfDoc(dir, ['README.md', 'README.rst', 'README.txt', 'README'], 1000);
  if (readme) lines.push(`\nFrom ${readme.name}:\n${readme.text}`);
  const contributing = topOfDoc(dir, ['CONTRIBUTING.md', 'CONTRIBUTING'], 700);
  if (contributing) lines.push(`\nFrom ${contributing.name}:\n${contributing.text}`);

  lines.push(
    `\nWork like a careful contributor: match the existing style and conventions, make minimal focused ` +
      `changes, reuse what's here, and run the project's own checks/tests (the scripts above) before finishing.`,
  );
  return lines.join('\n');
}
