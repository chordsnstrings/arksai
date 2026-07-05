import fs from 'node:fs';
import path from 'node:path';
import { config } from '../../config';
import { getSetting, setSetting } from '../../db';
import { encryptSecret, decryptSecret } from '../../lib/crypto';
import { fetchPublic, fetchPublicBuffer } from '../../lib/web';

/**
 * Real PHOTOGRAPHY + stock footage search (operator directive 2026-07-05: "access to much
 * more assets including photos where necessary or generate when quality photo or video
 * couldn't be found").
 *
 * Providers, in quality order:
 *  - Pexels (photos + videos) when a key is configured — free tier 200 req/hr / 20k/mo,
 *    header auth, license = free use with a prominent Pexels credit (we write it into
 *    ATTRIBUTIONS.md). Key comes from env PEXELS_API_KEY or app_settings (encrypted),
 *    the byteplusRuntime pattern — activated via POST /api/admin/providers/pexels, no SSH.
 *  - Openverse (CC-licensed aggregate) and Wikimedia Commons — KEYLESS fallbacks so the
 *    tool works day one. Quality varies; candidates are ranked below Pexels.
 * Everything downloads through the SSRF-guarded fetchPublicBuffer.
 *
 * Pure request builders + parsers (unit-tested without network); thin fetch wrappers.
 */

// ---------------- runtime key (env wins; else encrypted app_settings) ----------------

let cachedPexelsKey = config.pexelsApiKey || '';

export async function loadPhotoRuntime(): Promise<void> {
  if (!cachedPexelsKey) {
    const enc = await getSetting('pexels_api_key');
    if (enc) {
      try {
        cachedPexelsKey = decryptSecret(enc);
      } catch {
        /* bad/rotated encryption key — Pexels stays off, keyless fallbacks still work */
      }
    }
  }
}

export function pexelsKey(): string {
  return cachedPexelsKey;
}

export async function setPexelsKey(key: string): Promise<void> {
  cachedPexelsKey = key;
  await setSetting('pexels_api_key', encryptSecret(key));
}

/** TEST ONLY: set the in-memory key without a DB write. */
export function __setPexelsKeyForTest(key: string): void {
  cachedPexelsKey = key;
}

// ---------------- pure request builders + parsers ----------------

export interface PhotoCandidate {
  id: string;
  provider: 'pexels' | 'openverse' | 'wikimedia';
  kind: 'photo' | 'video';
  /** Direct download URL of a large rendition. */
  url: string;
  thumb?: string;
  width: number;
  height: number;
  creator?: string;
  license: string;
  attribution: string;
}

export function pexelsSearchUrl(query: string, opts: { kind?: 'photo' | 'video'; orientation?: string; perPage?: number } = {}): string {
  const base = opts.kind === 'video' ? 'https://api.pexels.com/videos/search' : 'https://api.pexels.com/v1/search';
  const p = new URLSearchParams({ query, per_page: String(Math.min(20, Math.max(1, opts.perPage ?? 8))) });
  if (opts.orientation && ['landscape', 'portrait', 'square'].includes(opts.orientation)) p.set('orientation', opts.orientation);
  return `${base}?${p}`;
}

export function parsePexels(json: any, kind: 'photo' | 'video'): PhotoCandidate[] {
  const rows: any[] = Array.isArray(json?.photos) ? json.photos : Array.isArray(json?.videos) ? json.videos : [];
  return rows
    .map((r): PhotoCandidate | null => {
      if (kind === 'photo') {
        const url = r?.src?.large2x || r?.src?.large || r?.src?.original;
        if (!url) return null;
        return {
          id: `pexels:${r.id}`,
          provider: 'pexels',
          kind,
          url: String(url),
          thumb: r?.src?.medium ? String(r.src.medium) : undefined,
          width: Number(r?.width) || 0,
          height: Number(r?.height) || 0,
          creator: r?.photographer ? String(r.photographer) : undefined,
          license: 'Pexels License (free use; credit appreciated)',
          attribution: `Photo by ${r?.photographer ?? 'Pexels photographer'} on Pexels (${r?.url ?? 'pexels.com'})`,
        };
      }
      const files: any[] = Array.isArray(r?.video_files) ? r.video_files : [];
      // best HD-ish mp4 (≤1920 wide keeps downloads inside the 15MB-ish envelope for short clips)
      const file = files
        .filter((f) => /mp4/i.test(String(f?.file_type ?? '')) && Number(f?.width) <= 1920)
        .sort((a, b) => Number(b?.width) - Number(a?.width))[0];
      if (!file?.link) return null;
      return {
        id: `pexels:${r.id}`,
        provider: 'pexels',
        kind,
        url: String(file.link),
        thumb: r?.image ? String(r.image) : undefined,
        width: Number(file?.width) || 0,
        height: Number(file?.height) || 0,
        creator: r?.user?.name ? String(r.user.name) : undefined,
        license: 'Pexels License (free use; credit appreciated)',
        attribution: `Video by ${r?.user?.name ?? 'Pexels creator'} on Pexels (${r?.url ?? 'pexels.com'})`,
      };
    })
    .filter((c): c is PhotoCandidate => !!c);
}

export function openverseSearchUrl(query: string, opts: { perPage?: number } = {}): string {
  const p = new URLSearchParams({
    q: query,
    license_type: 'commercial',
    page_size: String(Math.min(20, Math.max(1, opts.perPage ?? 8))),
  });
  return `https://api.openverse.org/v1/images/?${p}`;
}

export function parseOpenverse(json: any): PhotoCandidate[] {
  const rows: any[] = Array.isArray(json?.results) ? json.results : [];
  return rows
    .map((r): PhotoCandidate | null => {
      if (!r?.url) return null;
      return {
        id: `openverse:${r.id}`,
        provider: 'openverse',
        kind: 'photo',
        url: String(r.url),
        thumb: r?.thumbnail ? String(r.thumbnail) : undefined,
        width: Number(r?.width) || 0,
        height: Number(r?.height) || 0,
        creator: r?.creator ? String(r.creator) : undefined,
        license: String(r?.license ?? 'cc').toUpperCase(),
        attribution: String(r?.attribution ?? `"${r?.title ?? 'image'}" by ${r?.creator ?? 'unknown'} (${r?.license ?? 'CC'})`),
      };
    })
    .filter((c): c is PhotoCandidate => !!c);
}

export function wikimediaSearchUrl(query: string, opts: { perPage?: number } = {}): string {
  const p = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: `filetype:bitmap ${query}`,
    gsrnamespace: '6',
    gsrlimit: String(Math.min(20, Math.max(1, opts.perPage ?? 8))),
    prop: 'imageinfo',
    iiprop: 'url|size|extmetadata',
    iiurlwidth: '1600',
    format: 'json',
    origin: '*',
  });
  return `https://commons.wikimedia.org/w/api.php?${p}`;
}

export function parseWikimedia(json: any): PhotoCandidate[] {
  const pages = json?.query?.pages ? Object.values(json.query.pages) : [];
  return (pages as any[])
    .map((p): PhotoCandidate | null => {
      const info = Array.isArray(p?.imageinfo) ? p.imageinfo[0] : null;
      const url = info?.thumburl || info?.url;
      if (!url || !/\.(jpe?g|png)(\?|$)/i.test(String(url))) return null;
      const meta = info?.extmetadata ?? {};
      const license = String(meta?.LicenseShortName?.value ?? 'see Commons');
      const artist = String(meta?.Artist?.value ?? '')
        .replace(/<[^>]+>/g, '')
        .trim();
      return {
        id: `wikimedia:${p.pageid}`,
        provider: 'wikimedia',
        kind: 'photo',
        url: String(url),
        thumb: info?.thumburl ? String(info.thumburl) : undefined,
        width: Number(info?.thumbwidth || info?.width) || 0,
        height: Number(info?.thumbheight || info?.height) || 0,
        creator: artist || undefined,
        license,
        attribution: `"${String(p?.title ?? '').replace(/^File:/, '')}" via Wikimedia Commons — ${artist || 'unknown'} (${license})`,
      };
    })
    .filter((c): c is PhotoCandidate => !!c);
}

// ---------------- search + download ----------------

type Fetcher = (url: string, init?: RequestInit) => Promise<{ status: number; body: string }>;

const defaultFetcher: Fetcher = async (url, init) => {
  const ac = new AbortController();
  const r = await fetchPublic(url, ac.signal, init);
  return { status: r.status, body: r.body };
};

/** Search providers in quality order; degrade per-provider, never throw on one failing. */
export async function searchPhotos(
  query: string,
  opts: { kind?: 'photo' | 'video'; orientation?: string; limit?: number } = {},
  fetcher: Fetcher = defaultFetcher,
): Promise<{ candidates: PhotoCandidate[]; providersTried: string[]; notes: string[] }> {
  const kind = opts.kind === 'video' ? 'video' : 'photo';
  const limit = Math.min(12, Math.max(1, opts.limit ?? 6));
  const candidates: PhotoCandidate[] = [];
  const providersTried: string[] = [];
  const notes: string[] = [];

  if (pexelsKey()) {
    providersTried.push('pexels');
    try {
      const r = await fetcher(pexelsSearchUrl(query, { kind, orientation: opts.orientation, perPage: limit + 2 }), {
        headers: { Authorization: pexelsKey() },
      });
      if (r.status === 200) candidates.push(...parsePexels(JSON.parse(r.body), kind));
      else notes.push(`Pexels returned ${r.status}`);
    } catch (e: any) {
      notes.push(`Pexels failed: ${String(e?.message ?? e).slice(0, 80)}`);
    }
  } else if (kind === 'video') {
    notes.push('Stock VIDEO search needs a Pexels key (free at pexels.com/api — configure via Admin providers); falling back to photos only.');
  }

  if (kind === 'photo' && candidates.length < limit) {
    providersTried.push('openverse');
    try {
      const r = await fetcher(openverseSearchUrl(query, { perPage: limit }), {});
      if (r.status === 200) candidates.push(...parseOpenverse(JSON.parse(r.body)));
      else notes.push(`Openverse returned ${r.status}`);
    } catch (e: any) {
      notes.push(`Openverse failed: ${String(e?.message ?? e).slice(0, 80)}`);
    }
  }
  if (kind === 'photo' && candidates.length < limit) {
    providersTried.push('wikimedia');
    try {
      const r = await fetcher(wikimediaSearchUrl(query, { perPage: limit }), {});
      if (r.status === 200) candidates.push(...parseWikimedia(JSON.parse(r.body)));
      else notes.push(`Wikimedia returned ${r.status}`);
    } catch (e: any) {
      notes.push(`Wikimedia failed: ${String(e?.message ?? e).slice(0, 80)}`);
    }
  }

  // Prefer big-enough imagery (a plate needs ≥1200px on the long edge when known).
  const ranked = candidates
    .filter((c) => !c.width || Math.max(c.width, c.height) >= (kind === 'photo' ? 900 : 640))
    .slice(0, limit);
  return { candidates: ranked.length ? ranked : candidates.slice(0, limit), providersTried, notes };
}

/** Download one candidate into assets/photos/ and record its attribution. */
export async function downloadPhoto(
  c: PhotoCandidate,
  repoDir: string,
  signal: AbortSignal,
): Promise<{ relPath: string; bytes: number }> {
  const r = await fetchPublicBuffer(c.url, signal, c.provider === 'pexels' && pexelsKey() ? { headers: { Authorization: pexelsKey() } } : {});
  if (r.status !== 200 || !r.buffer.length) throw new Error(`download failed (${r.status})`);
  const ext = c.kind === 'video' ? '.mp4' : /png/i.test(r.contentType) ? '.png' : '.jpg';
  const dir = path.join(repoDir, 'assets', 'photos');
  fs.mkdirSync(dir, { recursive: true });
  const name = `${c.provider}-${c.id.split(':').pop()}${ext}`;
  fs.writeFileSync(path.join(dir, name), r.buffer);
  const attrFile = path.join(dir, 'ATTRIBUTIONS.md');
  const line = `- ${name}: ${c.attribution}\n`;
  if (!fs.existsSync(attrFile)) {
    fs.writeFileSync(attrFile, `# Photo & footage attributions\n\nPhotos provided by Pexels / Openverse / Wikimedia Commons.\n\n${line}`);
  } else if (!fs.readFileSync(attrFile, 'utf8').includes(line)) {
    fs.appendFileSync(attrFile, line);
  }
  return { relPath: `assets/photos/${name}`, bytes: r.buffer.length };
}
