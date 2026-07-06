import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from '../config';
import { q } from '../db';
import type { Robot } from '../../../shared/types';
import { ALL_TOOLS } from '../agent/tools';
import { parseDelimited } from '../agent/tools/data';
import { normalizeAddr } from './store';

/**
 * STUDIO TOOLS — the system's production tools, reachable from a robot CONVERSATION
 * (operator 2026-07-06: "robots that can connect to all the new tools").
 *
 * Two lanes cover the whole tool surface:
 *  - HEAVY production (websites, apps, videos, music, full reports) rides the commander
 *    BUILD bridge — a full agent session that already carries every tool.
 *  - QUICK production (an image, an ad creative, a document, a spreadsheet, a chart,
 *    stock photos) runs RIGHT HERE in the reply loop via the adapters below, and the
 *    produced files are delivered on the same channel as the reply.
 *
 * Safety posture (§5c preserved):
 *  - Adapters wrap the REAL ToolDefs from the agent registry (single source of truth) but
 *    expose only FLAT string params the reply model fills — no schema surface to abuse.
 *  - Execution happens in a per-robot studio workspace under data/ (never the host repo),
 *    so produced files are exactly what the channel delivery layer can publish.
 *  - Gated per robot: config.replyTools = 'commanders' (default — only the owner's own
 *    addresses can trigger production) | 'everyone' | 'off'. Customers of a default robot
 *    never spend a dirham of generation.
 *  - Shares the gated-action rate cap + audit log (action_name "tool:<name>").
 */

export type ReplyToolsMode = 'off' | 'commanders' | 'everyone';

export function replyToolsMode(robot: Robot): ReplyToolsMode {
  const v = (robot.config as any)?.replyTools;
  return v === 'off' || v === 'everyone' ? v : 'commanders';
}

/** May THIS sender use studio tools on this robot? (commanders = the owner's addresses) */
export async function senderMayUseTools(robot: Robot, fromAddr: string): Promise<boolean> {
  const mode = replyToolsMode(robot);
  if (mode === 'off') return false;
  if (mode === 'everyone') return true;
  try {
    const rows = await q('SELECT address FROM robot_commanders WHERE robot_id = $1', [robot.id]);
    const from = normalizeAddr(fromAddr);
    return rows.some((r: any) => normalizeAddr(String(r.address ?? '')) === from);
  } catch {
    return false; // fail closed — no commander table, no tools
  }
}

// ---- adapters: flat params → real tool args ----

export interface StudioParam {
  name: string;
  description: string;
}
export interface StudioTool {
  name: string; // advertised to the reply model (never collides with org action names by order)
  description: string;
  params: StudioParam[];
  required: string[];
  /** The underlying agent tool this adapter drives. */
  tool: string;
  /** Map the flat reply-lane params onto the real tool's args. Throws on bad input. */
  build: (p: Record<string, string>) => Record<string, unknown>;
}

/** CSV (first row = headers) → row objects for chart/sheet tools. Pure. */
export function csvToRows(csv: string): { headers: string[]; rows: Record<string, string | number>[] } {
  const grid = parseDelimited(csv.trim(), ',').filter((r) => r.some((c) => c.trim() !== ''));
  if (grid.length < 2) throw new Error('csv needs a header row plus at least one data row');
  const headers = grid[0].map((h, i) => h.trim() || `col${i + 1}`);
  const rows = grid.slice(1).map((r) => {
    const o: Record<string, string | number> = {};
    headers.forEach((h, i) => {
      const raw = (r[i] ?? '').trim();
      const num = raw !== '' && !Number.isNaN(Number(raw.replace(/,/g, ''))) ? Number(raw.replace(/,/g, '')) : null;
      o[h] = num ?? raw;
    });
    return o;
  });
  return { headers, rows };
}

/** Minimal markdown → generate_doc blocks (headings, bullets, numbered, quotes, paragraphs). Pure. */
export function mdToBlocks(md: string): Record<string, unknown>[] {
  const blocks: Record<string, unknown>[] = [];
  const lines = md.replace(/\r/g, '').split('\n');
  let list: { kind: 'bullets' | 'numbered'; items: string[] } | null = null;
  let para: string[] = [];
  const flushList = () => {
    if (list) blocks.push({ kind: list.kind, items: list.items });
    list = null;
  };
  const flushPara = () => {
    if (para.length) blocks.push({ kind: 'paragraph', text: para.join(' ').trim() });
    para = [];
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const quote = /^>\s?(.*)$/.exec(line);
    if (h) {
      flushList();
      flushPara();
      blocks.push({ kind: h[1].length === 1 ? 'heading' : h[1].length === 2 ? 'subheading' : 'heading3', text: h[2].trim() });
    } else if (bullet) {
      flushPara();
      if (!list || list.kind !== 'bullets') {
        flushList();
        list = { kind: 'bullets', items: [] };
      }
      list.items.push(bullet[1].trim());
    } else if (numbered) {
      flushPara();
      if (!list || list.kind !== 'numbered') {
        flushList();
        list = { kind: 'numbered', items: [] };
      }
      list.items.push(numbered[1].trim());
    } else if (quote) {
      flushList();
      flushPara();
      blocks.push({ kind: 'quote', text: quote[1].trim() });
    } else if (!line.trim()) {
      flushList();
      flushPara();
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushList();
  flushPara();
  return blocks;
}

const CHART_TYPES = new Set(['line', 'multi_line', 'dual_axis', 'bar', 'bar_h', 'stacked_bar', 'area', 'donut', 'heatmap']);
const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'file';

export const STUDIO_TOOLS: StudioTool[] = [
  {
    name: 'make_image',
    description: 'Generate a photographic/illustrative image from a description (no text in the image). Delivers the image file.',
    params: [
      { name: 'description', description: 'What the image should show — subject, style, mood, colors.' },
      { name: 'aspect_ratio', description: 'One of 1:1, 4:3, 3:4, 16:9, 9:16 (default 1:1).' },
    ],
    required: ['description'],
    tool: 'generate_image',
    build: (p) => ({ prompt: p.description, ...(p.aspect_ratio ? { aspect_ratio: p.aspect_ratio } : {}) }),
  },
  {
    name: 'make_creative',
    description: 'Produce a finished ad/social creative: generated imagery + crisp composited headline/CTA text. Delivers a PNG.',
    params: [
      { name: 'imagery', description: 'The scene/subject/style of the background imagery — NO words here.' },
      { name: 'headline', description: 'The headline text to composite.' },
      { name: 'subhead', description: 'Optional supporting line.' },
      { name: 'cta', description: 'Optional call-to-action button label.' },
      { name: 'aspect_ratio', description: '1:1, 4:5, 9:16, 16:9 or 1.91:1 (default 1:1).' },
      { name: 'accent', description: 'Optional brand accent hex like #c0502f.' },
    ],
    required: ['imagery'],
    tool: 'generate_creative',
    build: (p) => ({
      prompt: p.imagery,
      ...(p.headline ? { headline: p.headline } : {}),
      ...(p.subhead ? { subhead: p.subhead } : {}),
      ...(p.cta ? { cta: p.cta } : {}),
      ...(p.aspect_ratio ? { aspect_ratio: p.aspect_ratio } : {}),
      ...(p.accent ? { accent: p.accent } : {}),
    }),
  },
  {
    name: 'make_document',
    description: 'Produce a typographically designed Word document (.docx) from markdown content. Delivers the file.',
    params: [
      { name: 'title', description: 'The document title.' },
      { name: 'content_markdown', description: 'The FULL body as markdown: # headings, - bullets, 1. numbered lists, > quotes, paragraphs.' },
      { name: 'accent', description: 'Optional accent hex for headings.' },
    ],
    required: ['title', 'content_markdown'],
    tool: 'generate_doc',
    build: (p) => ({
      title: p.title,
      output: `${slug(p.title)}.docx`,
      ...(p.accent ? { accent: p.accent } : {}),
      blocks: mdToBlocks(p.content_markdown),
    }),
  },
  {
    name: 'make_spreadsheet',
    description: 'Produce a styled Excel workbook (.xlsx) from CSV data (first row = column headers). Delivers the file.',
    params: [
      { name: 'title', description: 'Workbook/sheet name.' },
      { name: 'csv', description: 'The data as CSV — first row is the column headers.' },
      { name: 'currency', description: 'Optional ISO currency code or symbol for money columns (AED, USD, $…).' },
    ],
    required: ['title', 'csv'],
    tool: 'generate_spreadsheet',
    build: (p) => {
      const { headers, rows } = csvToRows(p.csv);
      return {
        output: `${slug(p.title)}.xlsx`,
        ...(p.currency ? { currency: p.currency } : {}),
        sheets: [
          {
            name: p.title.slice(0, 28) || 'Data',
            columns: headers.map((h) => ({ header: h, key: h })),
            rows,
          },
        ],
      };
    },
  },
  {
    name: 'make_chart',
    description: 'Render a designed chart (SVG) from CSV data. Delivers the chart image.',
    params: [
      { name: 'chart_type', description: 'line, bar, bar_h, area, donut, multi_line, stacked_bar, dual_axis or heatmap.' },
      { name: 'title', description: 'Chart title.' },
      { name: 'csv', description: 'The data as CSV — first row is the column headers.' },
      { name: 'x', description: 'Header name for the x-axis (defaults to the first column).' },
      { name: 'y', description: 'Header name for the numeric series (defaults to the second column).' },
    ],
    required: ['chart_type', 'csv'],
    tool: 'render_chart',
    build: (p) => {
      const type = p.chart_type.trim().toLowerCase();
      if (!CHART_TYPES.has(type)) throw new Error(`unknown chart_type "${p.chart_type}"`);
      const { headers, rows } = csvToRows(p.csv);
      return {
        type,
        ...(p.title ? { title: p.title } : {}),
        data: rows,
        x: p.x?.trim() || headers[0],
        y: p.y?.trim() || headers[1],
        output: `charts/${slug(p.title || type)}.svg`,
      };
    },
  },
  {
    name: 'find_photos',
    description: 'Search professional stock photography and download the best match(es). Delivers the photo file(s).',
    params: [{ name: 'query', description: 'What the photo should show, e.g. "barista pouring latte art".' }],
    required: ['query'],
    tool: 'search_photos',
    build: (p) => ({ query: p.query }),
  },
];

/** The tools actually offerable right now (underlying ToolDef present + its engines keyed). */
export function availableStudioTools(): StudioTool[] {
  return STUDIO_TOOLS.filter((s) => {
    const t = ALL_TOOLS.find((x) => x.name === s.tool);
    return !!t && (!t.available || t.available());
  });
}

// ---- execution ----

export function studioDir(robotId: string): string {
  return path.join(config.dataDir, 'robots', robotId.replace(/[^\w-]/g, ''), 'studio');
}

export interface StudioRunResult {
  ok: boolean;
  summary: string;
  /** Absolute paths of files this run produced (under the robot's studio dir). */
  files: string[];
}

const TOOL_TIMEOUT_MS = Number(process.env.ROBOT_TOOL_TIMEOUT_MS || '180000') || 180_000;
const DELIVERABLE_EXT = new Set(['.pdf', '.docx', '.xlsx', '.pptx', '.png', '.jpg', '.jpeg', '.svg', '.mp3', '.mp4']);

/** New deliverable files under the studio dir since `sinceMs`, newest first, capped. */
export function collectStudioFiles(dir: string, sinceMs: number, cap = 4): string[] {
  const found: { abs: string; mtime: number }[] = [];
  const walk = (d: string, depth: number) => {
    if (depth > 3) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const abs = path.join(d, e.name);
      if (e.isDirectory()) {
        walk(abs, depth + 1);
        continue;
      }
      if (!DELIVERABLE_EXT.has(path.extname(e.name).toLowerCase())) continue;
      try {
        const st = fs.statSync(abs);
        if (st.mtimeMs >= sinceMs && st.size > 0) found.push({ abs, mtime: st.mtimeMs });
      } catch {
        /* raced */
      }
    }
  };
  walk(dir, 0);
  found.sort((a, b) => b.mtime - a.mtime);
  return found.slice(0, cap).map((f) => f.abs);
}

/** Run one studio tool for a robot in its own workspace. Never throws. */
export async function runStudioTool(
  robot: Robot,
  name: string,
  rawParams: Record<string, string>,
  signal: AbortSignal,
): Promise<StudioRunResult> {
  const adapter = STUDIO_TOOLS.find((s) => s.name.toLowerCase() === name.toLowerCase());
  if (!adapter) return { ok: false, summary: `No such tool "${name}".`, files: [] };
  const tool = ALL_TOOLS.find((t) => t.name === adapter.tool);
  if (!tool || (tool.available && !tool.available())) {
    return { ok: false, summary: `The ${adapter.name} tool is not configured on this server.`, files: [] };
  }
  const missing = adapter.required.filter((r) => !rawParams[r]?.trim());
  if (missing.length) return { ok: false, summary: `Missing required parameter(s): ${missing.join(', ')}.`, files: [] };

  const dir = studioDir(robot.id);
  fs.mkdirSync(dir, { recursive: true });
  const started = Date.now();
  // Bounded run: our own controller aborts on timeout OR when the caller aborts.
  const ac = new AbortController();
  const onAbort = () => ac.abort();
  signal.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => ac.abort(), TOOL_TIMEOUT_MS);
  try {
    const args = adapter.build(rawParams);
    const ctx: any = {
      repoDir: dir,
      mode: 'chat',
      signal: ac.signal,
      addCost: () => {},
      session: { id: `robot-${robot.id}`, orgId: robot.orgId } as any,
    };
    const out = await tool.run(args as any, ctx);
    const text = String(out ?? '').slice(0, 2000);
    const files = collectStudioFiles(dir, started - 1000);
    const failed = /^error[:\s]/i.test(text.trim());
    return { ok: !failed, summary: text || (files.length ? 'Done.' : 'The tool produced no output.'), files };
  } catch (e: any) {
    return { ok: false, summary: `Tool failed: ${String(e?.message ?? e).slice(0, 300)}`, files: [] };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
}

/** Audit every studio run into the existing action log (action_name "tool:<name>"). */
export async function logStudioRun(
  robot: Robot,
  name: string,
  params: Record<string, string>,
  fromAddr: string,
  ok: boolean,
  ms: number,
): Promise<void> {
  await q(
    'INSERT INTO robot_action_log(id, robot_id, org_id, action_name, params, from_addr, status, ok, ms, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    [randomUUID(), robot.id, robot.orgId, `tool:${name}`, JSON.stringify(params), fromAddr, ok ? 200 : 0, ok ? 1 : 0, ms, Date.now()],
  ).catch(() => {});
}
