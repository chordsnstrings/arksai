import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../config';

/**
 * Shared designer-font registry. The self-hosted woff2 set under server/assets/report-fonts
 * is the SAME identity the reports/creatives use. The logo generator exposes the full
 * catalogue to the model (so it can pick a typeface that fits the brand) and embeds the
 * chosen face into the SVG as base64 @font-face so the downloadable file renders anywhere.
 */

const FONT_DIR = path.join(repoRoot, 'server', 'assets', 'report-fonts');

export interface FontFace {
  family: string;
  weight: number;
  file: string;
}

// Every weight we ship. Family strings are the exact `font-family` value to use in CSS/SVG.
export const FONT_FACES: FontFace[] = [
  { family: 'Inter', weight: 400, file: 'inter-400.woff2' },
  { family: 'Inter', weight: 500, file: 'inter-500.woff2' },
  { family: 'Inter', weight: 600, file: 'inter-600.woff2' },
  { family: 'Inter', weight: 700, file: 'inter-700.woff2' },
  { family: 'Source Serif 4', weight: 400, file: 'source-serif-400.woff2' },
  { family: 'Source Serif 4', weight: 600, file: 'source-serif-600.woff2' },
  { family: 'Space Grotesk', weight: 500, file: 'space-grotesk-500.woff2' },
  { family: 'Space Grotesk', weight: 700, file: 'space-grotesk-700.woff2' },
  { family: 'Fraunces', weight: 600, file: 'fraunces-600.woff2' },
  { family: 'DM Sans', weight: 400, file: 'dmsans-400.woff2' },
  { family: 'DM Sans', weight: 600, file: 'dmsans-600.woff2' },
  { family: 'Plus Jakarta Sans', weight: 400, file: 'jakarta-400.woff2' },
  { family: 'Plus Jakarta Sans', weight: 600, file: 'jakarta-600.woff2' },
  { family: 'Lora', weight: 400, file: 'lora-400.woff2' },
  { family: 'Manrope', weight: 600, file: 'manrope-600.woff2' },
  { family: 'Newsreader', weight: 400, file: 'newsreader-400.woff2' },
  { family: 'Outfit', weight: 600, file: 'outfit-600.woff2' },
  { family: 'Sora', weight: 600, file: 'sora-600.woff2' },
  // expanded logo-grade set
  { family: 'Poppins', weight: 600, file: 'poppins-600.woff2' },
  { family: 'Poppins', weight: 700, file: 'poppins-700.woff2' },
  { family: 'Montserrat', weight: 600, file: 'montserrat-600.woff2' },
  { family: 'Montserrat', weight: 700, file: 'montserrat-700.woff2' },
  { family: 'Archivo', weight: 700, file: 'archivo-700.woff2' },
  { family: 'Epilogue', weight: 700, file: 'epilogue-700.woff2' },
  { family: 'Libre Franklin', weight: 700, file: 'librefranklin-700.woff2' },
  { family: 'Syne', weight: 700, file: 'syne-700.woff2' },
  { family: 'Bricolage Grotesque', weight: 700, file: 'bricolage-700.woff2' },
  { family: 'Playfair Display', weight: 700, file: 'playfair-700.woff2' },
  { family: 'Spectral', weight: 600, file: 'spectral-600.woff2' },
  { family: 'Cormorant', weight: 600, file: 'cormorant-600.woff2' },
  { family: 'Libre Baskerville', weight: 700, file: 'librebaskerville-700.woff2' },
  { family: 'Unbounded', weight: 700, file: 'unbounded-700.woff2' },
];

// What to advertise to the model — a curated, personality-tagged catalogue for the spec.
export const FONT_CATALOG: { family: string; cat: 'sans' | 'serif' | 'display'; note: string }[] = [
  { family: 'Space Grotesk', cat: 'sans', note: 'technical, distinctive, modern' },
  { family: 'Sora', cat: 'sans', note: 'clean geometric, techy' },
  { family: 'Outfit', cat: 'sans', note: 'friendly geometric' },
  { family: 'Manrope', cat: 'sans', note: 'neutral, contemporary' },
  { family: 'Plus Jakarta Sans', cat: 'sans', note: 'approachable, current' },
  { family: 'DM Sans', cat: 'sans', note: 'minimal geometric' },
  { family: 'Inter', cat: 'sans', note: 'neutral, UI-grade' },
  { family: 'Poppins', cat: 'sans', note: 'rounded geometric, friendly' },
  { family: 'Montserrat', cat: 'sans', note: 'urban geometric, confident' },
  { family: 'Archivo', cat: 'sans', note: 'grotesque, strong, industrial' },
  { family: 'Epilogue', cat: 'sans', note: 'modern grotesque' },
  { family: 'Libre Franklin', cat: 'sans', note: 'classic grotesque, trustworthy' },
  { family: 'Source Serif 4', cat: 'serif', note: 'clean editorial' },
  { family: 'Fraunces', cat: 'serif', note: 'characterful old-style display serif' },
  { family: 'Playfair Display', cat: 'serif', note: 'high-contrast, luxury' },
  { family: 'Spectral', cat: 'serif', note: 'refined editorial' },
  { family: 'Cormorant', cat: 'serif', note: 'elegant, fashion/luxury' },
  { family: 'Lora', cat: 'serif', note: 'warm, readable' },
  { family: 'Newsreader', cat: 'serif', note: 'journalistic' },
  { family: 'Libre Baskerville', cat: 'serif', note: 'classic, authoritative' },
  { family: 'Syne', cat: 'display', note: 'quirky modern display' },
  { family: 'Unbounded', cat: 'display', note: 'bold geometric display' },
  { family: 'Bricolage Grotesque', cat: 'display', note: 'editorial display, characterful' },
];

const _cssCache = new Map<string, string>();

/**
 * @font-face CSS (base64-embedded woff2). Pass a list of family names to embed only those
 * (smaller files); omit to embed everything. Missing files are skipped (fail-soft).
 */
export function fontFaceCss(families?: string[]): string {
  const key = families && families.length ? families.map((f) => f.toLowerCase()).sort().join('|') : '*';
  const cached = _cssCache.get(key);
  if (cached != null) return cached;
  const want = families && families.length ? new Set(families.map((f) => f.toLowerCase())) : null;
  const css = FONT_FACES.filter((f) => !want || want.has(f.family.toLowerCase()))
    .map((f) => {
      try {
        const b64 = fs.readFileSync(path.join(FONT_DIR, f.file)).toString('base64');
        return `@font-face{font-family:'${f.family}';font-weight:${f.weight};font-display:block;src:url(data:font/woff2;base64,${b64}) format('woff2')}`;
      } catch {
        return '';
      }
    })
    .filter(Boolean)
    .join('\n');
  _cssCache.set(key, css);
  return css;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Family names from our registry that an SVG/HTML string actually references. Pure. */
export function usedFamilies(markup: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const f of FONT_FACES) {
    if (seen.has(f.family)) continue;
    if (new RegExp(`\\b${escapeRegExp(f.family)}\\b`, 'i').test(markup)) {
      seen.add(f.family);
      out.push(f.family);
    }
  }
  return out;
}

/**
 * Make a standalone SVG self-contained by injecting a <style> with @font-face for every
 * registry font it references. No-op when it uses no known font (a pure-shape mark). Pure.
 */
export function embedFontsInSvg(svg: string): string {
  const fams = usedFamilies(svg);
  if (!fams.length) return svg;
  const css = fontFaceCss(fams);
  if (!css) return svg;
  const style = `<style>${css}</style>`;
  // Insert right after the opening <svg ...> tag.
  const m = svg.match(/<svg[^>]*>/i);
  if (!m) return svg;
  const idx = (m.index ?? 0) + m[0].length;
  return svg.slice(0, idx) + style + svg.slice(idx);
}

/** The font catalogue rendered as a compact list for the generation spec. Pure. */
export function fontCatalogText(): string {
  const grp = (cat: 'sans' | 'serif' | 'display') =>
    FONT_CATALOG.filter((f) => f.cat === cat)
      .map((f) => `"${f.family}" (${f.note})`)
      .join(', ');
  return `  Sans / geometric: ${grp('sans')}.\n  Serif / editorial: ${grp('serif')}.\n  Display: ${grp('display')}.`;
}
