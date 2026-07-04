import fs from 'node:fs';
import path from 'node:path';
import { assetSource, ATTRIBUTIONS_MD } from './library';

/**
 * Materialize library assets into a workspace as ready-to-use SVG files.
 *
 * Icons: iconify bodies stroke/fill with currentColor → we wrap them in an <svg> whose
 * `color` is set, so ONE hex recolors the whole glyph (and `currentColor` keeps working
 * when the file is inlined into a page that sets `color` via CSS).
 * Logos: simple-icons paths get their OFFICIAL brand hex by default (that's the point of
 * a real brand mark); pass `color` to override (e.g. all-white logo walls).
 */

const sanitize = (s: string) => s.replace(/[^a-z0-9-]+/gi, '-').toLowerCase();

export interface MaterializedAsset {
  id: string;
  /** Repo-relative path of the written SVG, e.g. "assets/lucide-heart-pulse.svg". */
  relPath: string;
  name: string;
  kind: 'icon' | 'logo';
}

export function buildAssetSvg(id: string, opts: { color?: string; size?: number } = {}): { svg: string; name: string; kind: 'icon' | 'logo' } | null {
  const src = assetSource(id);
  if (!src) return null;
  const size = Math.max(8, Math.min(2048, Math.round(opts.size ?? 96)));
  if (src.kind === 'logo') {
    const fill = opts.color || src.hex;
    const svg =
      `<!-- ${src.title} — Simple Icons (CC0). The mark remains a trademark of its owner. -->\n` +
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" role="img" aria-label="${src.title}">` +
      `<path d="${src.path}" fill="${fill}"/></svg>`;
    return { svg, name: src.title, kind: 'logo' };
  }
  const color = opts.color || 'currentColor';
  const style = color === 'currentColor' ? '' : ` style="color:${color}"`;
  const svg =
    `<!-- ${src.set}:${src.name} — vendored open-licensed icon (see assets/ATTRIBUTIONS.md) -->\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${src.width} ${src.height}" width="${size}" height="${size}"${style}>` +
    `${src.body}</svg>`;
  return { svg, name: src.name, kind: 'icon' };
}

/** Write assets into `<repoDir>/assets/`; returns what was written (skips unknown ids). */
export function materializeAssets(
  repoDir: string,
  ids: string[],
  opts: { color?: string; size?: number } = {},
): { written: MaterializedAsset[]; unknown: string[] } {
  const dir = path.join(repoDir, 'assets');
  fs.mkdirSync(dir, { recursive: true });
  const attribution = path.join(dir, 'ATTRIBUTIONS.md');
  if (!fs.existsSync(attribution)) fs.writeFileSync(attribution, ATTRIBUTIONS_MD);
  const written: MaterializedAsset[] = [];
  const unknown: string[] = [];
  for (const id of ids) {
    const built = buildAssetSvg(id, opts);
    if (!built) {
      unknown.push(id);
      continue;
    }
    const file = `${sanitize(id)}.svg`;
    fs.writeFileSync(path.join(dir, file), built.svg);
    written.push({ id, relPath: `assets/${file}`, name: built.name, kind: built.kind });
  }
  return { written, unknown };
}
