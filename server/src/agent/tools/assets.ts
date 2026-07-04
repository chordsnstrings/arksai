import fs from 'node:fs';
import path from 'node:path';
import { resolveInWorkspace, type ToolDef } from './common';
import { searchAssets, libraryStats } from '../assets/library';
import { materializeAssets } from '../assets/materialize';
import { fetchPublicBuffer } from '../../lib/web';

/**
 * Asset access for autonomous builds — the operator's rule for motion graphics and any
 * icon-heavy deliverable: the RIGHT asset at the RIGHT moment, never a hand-drawn path.
 */

export const searchAssetsTool: ToolDef = {
  name: 'search_assets',
  description:
    'Search the OFFLINE vendored vector-asset library (~20,000 open-licensed assets: Lucide/' +
    'Tabler/Phosphor line icons, Health Icons medical set, and ~3,400 REAL brand logos from ' +
    'Simple Icons with official brand colors) and write the ones you pick into the workspace ' +
    'as ready SVG files. THE RULE: NEVER hand-draw an icon path, guess a slug, or hotlink an ' +
    'icon CDN — search here first (synonyms work: "money", "exercise", "cholesterol"…). ' +
    'Search with a SHORT concept query (1-3 words), then pass the chosen ids in `materialize` ' +
    'to get files under assets/ (icons recolor via `color`; brand logos default to their ' +
    'official color). The returned SVGs are inline-able and animate cleanly (stroke draw-on, ' +
    'fills). For photographic imagery use generate_image; for charts use render_chart.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Short concept query, e.g. "heart health", "credit card", "stripe logo".' },
      kind: { type: 'string', enum: ['icon', 'logo', 'any'], description: 'Filter by asset kind (default any).' },
      limit: { type: 'number', description: 'Max results to list (default 12, max 40).' },
      materialize: {
        type: 'array',
        items: { type: 'string' },
        description: 'Asset ids from a previous search (e.g. ["lucide:heart-pulse","brand:stripe"]) to WRITE into assets/ as SVG files.',
      },
      color: { type: 'string', description: 'Hex to recolor materialized icons (default currentColor; logos default to brand hex).' },
      size: { type: 'number', description: 'Pixel size for materialized SVGs (default 96).' },
    },
    required: ['query'],
  },
  modes: ['chat', 'code'],
  summarize: (a) => `assets: ${String(a.query ?? '').slice(0, 50)}`,
  async run(args, ctx) {
    const query = String(args.query ?? '').trim();
    if (!query) return 'Error: pass a short concept query, e.g. "heart health".';
    const kind = args.kind === 'icon' || args.kind === 'logo' ? args.kind : 'any';
    const hits = searchAssets(query, { kind, limit: Number(args.limit) || 12 });

    let out = '';
    const ids = Array.isArray(args.materialize) ? args.materialize.map(String).slice(0, 30) : [];
    if (ids.length) {
      const { written, unknown } = materializeAssets(ctx.repoDir, ids, {
        color: args.color ? String(args.color) : undefined,
        size: args.size ? Number(args.size) : undefined,
      });
      if (written.length)
        out += `Wrote ${written.length} SVG(s):\n${written.map((w) => `- ${w.relPath} (${w.name})`).join('\n')}\n\n`;
      if (unknown.length) out += `Unknown ids (re-search and use exact ids): ${unknown.join(', ')}\n\n`;
    }
    if (!hits.length) {
      const s = libraryStats();
      return out + `No matches for "${query}" in the ${s.total}-asset library. Try a simpler/synonym query ("money", "doctor", "chart") or kind:"logo" for brands.`;
    }
    out += `Matches for "${query}" (pass ids via materialize to write files):\n`;
    out += hits
      .map((h) => `- ${h.id} — ${h.name}${h.kind === 'logo' ? ` [brand logo${h.brandHex ? ' ' + h.brandHex : ''}]` : ` [${h.set}]`}`)
      .join('\n');
    return out;
  },
};

const EXT_BY_TYPE: Record<string, string> = {
  'image/svg+xml': '.svg',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'audio/mpeg': '.mp3',
  'audio/ogg': '.ogg',
  'audio/wav': '.wav',
  'font/woff2': '.woff2',
};

export const fetchAssetTool: ToolDef = {
  name: 'fetch_asset',
  description:
    'Download a PUBLIC asset URL (image/SVG/logo/audio/font) into the workspace, binary-safe. ' +
    'Use when the user points at an asset on the web ("use the logo from our site https://…"). ' +
    'Only public http(s) URLs (private/internal addresses are refused); 15MB cap. Saved under ' +
    'assets/ and the saved path is returned. Prefer search_assets for icons/brand logos — ' +
    'this is for user-specific files.',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'The public asset URL.' },
      filename: { type: 'string', description: 'Optional filename to save as (extension inferred from content-type if omitted).' },
    },
    required: ['url'],
  },
  modes: ['chat', 'code'],
  summarize: (a) => `fetch asset ${String(a.url ?? '').slice(0, 60)}`,
  async run(args, ctx) {
    const url = String(args.url ?? '').trim();
    try {
      const r = await fetchPublicBuffer(url, ctx.signal);
      if (r.status >= 400) return `Error: the URL answered HTTP ${r.status}.`;
      if (!r.buffer.length) return 'Error: the URL returned an empty body.';
      const baseType = r.contentType.split(';')[0].trim().toLowerCase();
      const ext = EXT_BY_TYPE[baseType] ?? path.extname(new URL(url).pathname) ?? '';
      let name = String(args.filename ?? '').replace(/[^a-zA-Z0-9._-]/g, '-');
      if (!name) name = (path.basename(new URL(url).pathname) || 'asset').replace(/[^a-zA-Z0-9._-]/g, '-');
      if (!path.extname(name) && ext) name += ext;
      const rel = path.posix.join('assets', name);
      const abs = resolveInWorkspace(ctx.repoDir, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, r.buffer);
      return `Saved ${rel} (${(r.buffer.length / 1024).toFixed(0)}KB, ${baseType || 'unknown type'}).`;
    } catch (e: any) {
      return `Error: ${String(e?.message ?? e)}`;
    }
  },
};
