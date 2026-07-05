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
    'Search the OFFLINE vendored vector-asset library (~18,000 open-licensed assets: Lucide/' +
    'Tabler/Phosphor line icons, Health Icons medical set, ~3,400 REAL brand logos (official ' +
    'colors), and ~1,800 FULL-COLOR PROPS (kind:\'prop\' — flat colorful food/objects/organs/' +
    'planets/characters from Fluent Emoji + Streamline illustrations; perfect for motion-video ' +
    'scenes; their colors are part of the asset — never recolored) and write your picks into the workspace ' +
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
      kind: { type: 'string', enum: ['icon', 'logo', 'prop', 'any'], description: 'Filter by asset kind (default any). prop = full-color illustrations.' },
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
    const kind = args.kind === 'icon' || args.kind === 'logo' || args.kind === 'prop' ? args.kind : 'any';
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
      .map((h) => `- ${h.id} — ${h.name}${h.kind === 'logo' ? ` [brand logo${h.brandHex ? ' ' + h.brandHex : ''}]` : h.kind === 'prop' ? ' [color prop]' : ` [${h.set}]`}`)
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

// ---------------------------------------------------------------------------
// search_photos — REAL photography + stock footage (operator directive 2026-07-05)
// ---------------------------------------------------------------------------
import { searchPhotos, downloadPhoto } from '../assets/photos';
import { config } from '../../config';
import { analyzeImage } from '../../engines/minimax';

export const searchPhotosTool: ToolDef = {
  name: 'search_photos',
  description:
    'Search REAL stock photography (and stock footage when Pexels is configured) and download the best hit ' +
    'into assets/photos/. Sources: Pexels (best quality, free-use license, needs the admin-configured key) ' +
    'with keyless CC fallbacks (Openverse, Wikimedia Commons). Use for photographic PLATES in motion videos ' +
    '(vox style), report imagery, and any "show the real thing" moment. FALLBACK CHAIN: if no quality photo ' +
    'comes back, use generate_image (photographic prompt, text-free) instead — a bad stock photo is worse ' +
    'than a generated one. By default the tool downloads the top candidate (vision-checked when available) ' +
    'and returns its workspace path; attribution is recorded automatically in assets/photos/ATTRIBUTIONS.md.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'What the photo must show, concrete and visual: "salmon fillet on a cutting board", "person running at sunrise".' },
      kind: { type: 'string', enum: ['photo', 'video'], description: 'photo (default) or a short stock video clip (Pexels key required).' },
      orientation: { type: 'string', enum: ['landscape', 'portrait', 'square'], description: 'Match the frame you are filling (default landscape).' },
      download: { type: 'boolean', description: 'Download the best candidate (default true). Pass false to only list candidates.' },
      count: { type: 'number', description: 'How many candidates to list (default 6, max 12).' },
    },
    required: ['query'],
  },
  modes: ['chat', 'code'],
  summarize: (a) => `photos: ${String(a.query ?? '').slice(0, 50)}`,
  async run(args, ctx) {
    const query = String(args.query ?? '').trim();
    if (!query) return 'Error: pass a concrete visual query, e.g. "salmon fillet on a cutting board".';
    const kind = args.kind === 'video' ? 'video' : 'photo';
    const { candidates, providersTried, notes } = await searchPhotos(query, {
      kind,
      orientation: typeof args.orientation === 'string' ? args.orientation : 'landscape',
      limit: Number(args.count) || 6,
    });
    if (!candidates.length) {
      return (
        `No usable ${kind} found for "${query}" (tried: ${providersTried.join(', ') || 'no provider available'}${notes.length ? '; ' + notes.join('; ') : ''}). ` +
        `FALL BACK NOW: use generate_image with a photographic, text-free prompt describing exactly this subject.`
      );
    }
    let out = `${kind === 'video' ? 'Footage' : 'Photos'} for "${query}" (${providersTried.join('+')}):\n`;
    out += candidates
      .map((c, i) => `${i + 1}. [${c.provider}] ${c.width}x${c.height}${c.creator ? ` — ${c.creator}` : ''} (${c.license})`)
      .join('\n');
    if (notes.length) out += `\nNotes: ${notes.join('; ')}`;

    if (args.download === false) return out;

    // Download the best candidate; when vision is available, verify quality/subject and
    // step down the list once or twice rather than shipping a bad plate.
    const tryList = candidates.slice(0, 3);
    for (const c of tryList) {
      try {
        const dl = await downloadPhoto(c, ctx.repoDir, ctx.signal);
        if (kind === 'photo' && config.minimaxApiKey) {
          try {
            const { fileToDataUrl } = await import('../../engines/minimax');
            const v = await analyzeImage(
              fileToDataUrl(path.join(ctx.repoDir, dl.relPath)),
              `Is this a high-quality photograph clearly showing: ${query}? It will be a full-bleed video plate. Answer "YES" or "NO: <reason>" only.`,
              ctx.signal,
            );
            if (v.ok && v.text && /^\s*no\b/i.test(v.text)) {
              fs.rmSync(path.join(ctx.repoDir, dl.relPath), { force: true });
              out += `\nRejected ${c.id} (${v.text.trim().slice(0, 80)}) — trying the next candidate.`;
              continue;
            }
          } catch {
            /* vision gate is best-effort */
          }
        }
        out += `\n\nDownloaded: ${dl.relPath} (${(dl.bytes / 1024).toFixed(0)}KB) — attribution recorded. Use this path in scene slots/plates.`;
        return out;
      } catch (e: any) {
        out += `\nDownload of ${c.id} failed (${String(e?.message ?? e).slice(0, 80)}) — trying the next candidate.`;
      }
    }
    return out + `\n\nNo candidate survived download/quality checks — use generate_image (photographic, text-free) for this subject instead.`;
  },
};
