import fs from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import { resolveInWorkspace, ToolError, type ToolDef } from './common';
import { execBash, truncateMiddle } from '../../lib/exec';

const READ_LINE_CAP = 2000;

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
  modes: ['plan', 'code'],
  summarize: (args) => String(args.path ?? ''),
  async run(args, ctx) {
    const abs = resolveInWorkspace(ctx.repoDir, String(args.path));
    if (!fs.existsSync(abs)) return `Error: file not found: ${args.path}`;
    if (fs.statSync(abs).isDirectory()) return `Error: ${args.path} is a directory`;
    const lines = fs.readFileSync(abs, 'utf8').split('\n');
    const offset = Math.max(1, Number(args.offset) || 1);
    const limit = Math.min(Number(args.limit) || READ_LINE_CAP, READ_LINE_CAP);
    const slice = lines.slice(offset - 1, offset - 1 + limit);
    const body = slice.map((l, i) => `${offset + i}\t${l}`).join('\n');
    const more = lines.length > offset - 1 + limit ? `\n... (${lines.length} lines total)` : '';
    return truncateMiddle(body) + more;
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
  modes: ['plan', 'code'],
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
  modes: ['plan', 'code'],
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
