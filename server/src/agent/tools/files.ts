import fs from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import { resolveInWorkspace, ToolError, type ToolDef } from './common';
import { execBash, truncateMiddle } from '../../lib/exec';

const READ_LINE_CAP = 2000;

// Per-(session,file) read counter. Breaks the "read → middle elided → re-read with a new
// offset / line-by-line" loop that re-sends a growing context every turn and balloons INPUT
// tokens into the per-run budget breaker (observed live: 5.46M input tokens from one file
// loop → the 5M safety cutoff). The signature loop-guard misses it because the args vary.
const readCounts = new Map<string, number>();
const MAX_REREADS = 5;
function bumpRead(key: string): number {
  const n = (readCounts.get(key) || 0) + 1;
  readCounts.set(key, n);
  if (readCounts.size > 5000) {
    const first = readCounts.keys().next().value;
    if (first !== undefined) readCounts.delete(first);
  }
  return n;
}
const GENERATED_RE = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Gemfile\.lock|composer\.lock|poetry\.lock|Cargo\.lock)$|\.lock$/i;

export const readFileTool: ToolDef = {
  name: 'read_file',
  description: 'Read a file from the workspace. Returns numbered lines. Paths are relative to the repo root.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      offset: { type: 'number', description: '1-based line to start from' },
      limit: { type: 'number', description: 'Max lines to return' },
    },
    required: ['path'],
  },
  modes: ['chat', 'plan', 'code'],
  summarize: (args) => String(args.path ?? ''),
  async run(args, ctx) {
    const rel = String(args.path);
    const abs = resolveInWorkspace(ctx.repoDir, rel);
    if (!fs.existsSync(abs)) return `Error: file not found: ${rel}`;
    if (fs.statSync(abs).isDirectory()) return `Error: ${rel} is a directory`;

    // Don't dump machine-generated / lock files — they're huge, useless to read whole, and the
    // #1 source of read-loop token blowups. Direct to grep for the one thing the agent needs.
    if (GENERATED_RE.test(rel) || abs.includes(`${path.sep}node_modules${path.sep}`)) {
      if (fs.statSync(abs).size > 20_000 && !args.offset) {
        return `${rel} is a large generated/lock file — do NOT read it in full (it's machine-generated and re-reading it balloons the run budget). If you need a specific value (e.g. a dependency version), use grep("<pattern>", "${rel}"). Skipping the dump.`;
      }
    }

    const reads = bumpRead(`${ctx.session.id}|${rel}`);
    const lines = fs.readFileSync(abs, 'utf8').split('\n');
    const offset = Math.max(1, Number(args.offset) || 1);
    const limit = Math.min(Number(args.limit) || READ_LINE_CAP, READ_LINE_CAP);

    // Re-read guard: after several reads of the SAME file in a run, stop returning content —
    // re-reading yields the same bytes and only grows the context toward the budget breaker.
    if (reads > MAX_REREADS) {
      return `You've read ${rel} ${reads} times in this run. STOP re-reading it — re-reading returns the same content and burns the run budget (this is what trips the safety cutoff). Use grep("<pattern>", "${rel}") to find the specific thing you need, or act on what you've already seen.`;
    }

    const slice = lines.slice(offset - 1, offset - 1 + limit);
    const body = slice.map((l, i) => `${offset + i}\t${l}`).join('\n');
    const more = lines.length > offset - 1 + limit ? `\n... (${lines.length} lines total)` : '';
    const shown = truncateMiddle(body);
    const elided = shown.length < body.length
      ? `\n\n⚠ This file is large and the middle was truncated. Do NOT re-read it with different offsets to get the rest — use grep("<pattern>", "${rel}") to jump to the specific content you need.`
      : '';
    return shown + more + elided;
  },
};

export const writeFileTool: ToolDef = {
  name: 'write_file',
  description: 'Create or overwrite a file in the workspace. Parent directories are created automatically.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      content: { type: 'string' },
    },
    required: ['path', 'content'],
  },
  modes: ['code'],
  summarize: (args) => String(args.path ?? ''),
  async run(args, ctx) {
    const abs = resolveInWorkspace(ctx.repoDir, String(args.path));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, String(args.content ?? ''));
    return `Wrote ${args.path} (${String(args.content ?? '').length} bytes)`;
  },
};

export const editFileTool: ToolDef = {
  name: 'edit_file',
  description:
    'Replace an exact string in a file. Fails if old_string is not found or is ambiguous (unless replace_all).',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      old_string: { type: 'string' },
      new_string: { type: 'string' },
      replace_all: { type: 'boolean' },
    },
    required: ['path', 'old_string', 'new_string'],
  },
  modes: ['code'],
  summarize: (args) => String(args.path ?? ''),
  async run(args, ctx) {
    const abs = resolveInWorkspace(ctx.repoDir, String(args.path));
    if (!fs.existsSync(abs)) return `Error: file not found: ${args.path}`;
    const content = fs.readFileSync(abs, 'utf8');
    const oldStr = String(args.old_string);
    const count = content.split(oldStr).length - 1;
    if (count === 0) return `Error: old_string not found in ${args.path}. Read the file and retry with the exact text.`;
    if (count > 1 && !args.replace_all) {
      return `Error: old_string occurs ${count} times in ${args.path}. Provide more context or set replace_all.`;
    }
    const updated = args.replace_all
      ? content.split(oldStr).join(String(args.new_string))
      : content.replace(oldStr, String(args.new_string));
    fs.writeFileSync(abs, updated);
    return `Edited ${args.path} (${count} replacement${count > 1 ? 's' : ''})`;
  },
};

export const globTool: ToolDef = {
  name: 'glob',
  description: 'Find files matching a glob pattern (e.g. "src/**/*.ts"). Ignores .git and node_modules.',
  parameters: {
    type: 'object',
    properties: { pattern: { type: 'string' } },
    required: ['pattern'],
  },
  modes: ['chat', 'plan', 'code'],
  summarize: (args) => String(args.pattern ?? ''),
  async run(args, ctx) {
    const matches = await fg(String(args.pattern), {
      cwd: ctx.repoDir,
      ignore: ['**/node_modules/**', '**/.git/**'],
      dot: true,
      onlyFiles: true,
      followSymbolicLinks: false,
    });
    if (matches.length === 0) return 'No files matched.';
    const shown = matches.slice(0, 200);
    const more = matches.length > 200 ? `\n... and ${matches.length - 200} more` : '';
    return shown.join('\n') + more;
  },
};

export const grepTool: ToolDef = {
  name: 'grep',
  description: 'Search file contents with a regex (ripgrep). Returns matching lines with file:line prefixes.',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Regex pattern' },
      glob: { type: 'string', description: 'Optional file glob filter, e.g. "*.ts"' },
      max_results: { type: 'number', description: 'Max matching lines (default 100)' },
    },
    required: ['pattern'],
  },
  modes: ['chat', 'plan', 'code'],
  summarize: (args) => String(args.pattern ?? '').slice(0, 80),
  async run(args, ctx) {
    const max = Math.min(Number(args.max_results) || 100, 500);
    const globArg = args.glob ? `--glob ${JSON.stringify(String(args.glob))}` : '';
    const res = await execBash(
      `rg -n --no-heading --max-columns 300 ${globArg} -e ${JSON.stringify(String(args.pattern))} . | head -n ${max}`,
      { cwd: ctx.repoDir, timeoutMs: 30_000, signal: ctx.signal },
    );
    if (!res.output.trim()) return 'No matches.';
    return res.output;
  },
};

export { ToolError };
