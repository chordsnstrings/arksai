import fs from 'node:fs';
import path from 'node:path';

/**
 * Deterministic, source-level checks for the structural mobile defects that a headless browser
 * smoke test CAN'T see — most importantly a missing `<meta name="viewport">`: Playwright sets the
 * viewport directly, so the page never renders at desktop-width-and-zoomed-out the way it does on a
 * real phone, and the check sails through. These run with no browser, no vision, and no egress, so a
 * website is gated on the basics even in a degraded environment. Pure analyzers are unit-tested; the
 * `auditWebHygiene` wrapper does the file IO. Conservative by design (only high-confidence defects).
 */

export interface WebHygieneResult {
  ran: boolean;
  defects: string[];
}

/** A `<meta name="viewport">` must be present or mobile renders at ~980px and zooms out. */
export function hasViewportMeta(html: string): boolean {
  return /<meta\b[^>]*\bname\s*=\s*["']?viewport["']?[^>]*>/i.test(html);
}

/** A hard `min-width` wider than a small phone (~420px) on layout forces horizontal overflow. */
export function findFixedMinWidths(css: string): number[] {
  const out: number[] = [];
  // Require a declaration terminator (; or }) so a `@media (min-width: 721px)` breakpoint —
  // where min-width is followed by `)` — is NOT mistaken for a fixed layout min-width.
  const re = /min-width\s*:\s*(\d{2,4})px\s*[;}]/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    const px = parseInt(m[1], 10);
    if (px > 420) out.push(px);
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

const TOGGLE_RE =
  /class\s*=\s*["'][^"']*\b(hamburger|menu-toggle|menu-btn|nav-toggle|navbar-toggler|burger|nav-open|navtoggle)\b|aria-label\s*=\s*["'][^"']*\bmenu\b|aria-controls\s*=/i;
const HAMBURGER_GLYPH = /(☰|≡|&#9776;|&#x2630;)/;

/** Does the markup contain a hamburger / menu toggle control? */
export function hasMenuToggle(html: string): boolean {
  return TOGGLE_RE.test(html) || HAMBURGER_GLYPH.test(html);
}

/**
 * Is there ANY mechanism that could open a mobile menu — a script, a native <details>, an inline
 * handler, or a checkbox/:target CSS hack? If a toggle exists with none of these, the menu is dead.
 * Lenient on purpose (any <script> counts) so this only fires on the clearest "pure HTML, no wiring"
 * case; a present-but-buggy JS toggle is the browser check's job.
 */
export function hasToggleWiring(html: string, css: string): boolean {
  if (/<script[\s>]/i.test(html)) return true;
  if (/<details[\s>]/i.test(html)) return true;
  if (/\son(click|change|toggle)\s*=/i.test(html)) return true;
  if (/:checked|:target/i.test(css)) return true;
  return false;
}

/** Collect the CSS that applies to an HTML file: inline <style> blocks + linked local stylesheets. */
function collectCss(htmlFile: string, html: string, root: string): string {
  let css = '';
  for (const m of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) css += '\n' + m[1];
  const baseDir = path.dirname(htmlFile);
  const realRoot = (() => {
    try {
      return fs.realpathSync(root);
    } catch {
      return path.resolve(root);
    }
  })();
  for (const m of html.matchAll(/<link\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    const tag = m[0];
    if (!/rel\s*=\s*["']?stylesheet/i.test(tag)) continue;
    const href = m[1];
    if (/^https?:|^\/\//i.test(href)) continue; // external CDN — can't read, not our concern
    try {
      const p = path.resolve(baseDir, href.replace(/^\//, ''));
      if (!fs.realpathSync(p).startsWith(realRoot)) continue; // stay inside the workspace
      css += '\n' + fs.readFileSync(p, 'utf8');
      if (css.length > 400_000) break;
    } catch {
      /* missing/ unreadable link — skip */
    }
  }
  return css;
}

/** Find the HTML entry files in a served site (root + one level deep), capped. */
function findHtmlFiles(dir: string): string[] {
  const out: string[] = [];
  const pushHtml = (d: string) => {
    try {
      for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
        if (ent.isFile() && /\.html?$/i.test(ent.name)) out.push(path.join(d, ent.name));
      }
    } catch {
      /* unreadable dir */
    }
  };
  pushHtml(dir);
  try {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (out.length >= 12) break;
      if (ent.isDirectory() && !ent.name.startsWith('.') && ent.name !== 'node_modules') pushHtml(path.join(dir, ent.name));
    }
  } catch {
    /* unreadable */
  }
  // index.html first (the entry point), then the rest.
  return out.sort((a, b) => (/index\.html?$/i.test(a) ? -1 : 0) - (/index\.html?$/i.test(b) ? -1 : 0)).slice(0, 12);
}

// Local <link>/<script>/<img>/<source> references that point at a file in the workspace which does
// NOT exist — a 404 at runtime, so its CSS/JS/image is silently missing and the page renders broken
// (the recurring "I linked landing.css but only created site.css" bug, where the bespoke component
// styles + the signature element render unstyled). Cheap, deterministic, browser-free — and exactly
// the class the headless probe can miss when a static server answers a missing file with a 200 page.
const ASSET_REF_RE =
  /<(?:link\b[^>]*\bhref|script\b[^>]*\bsrc|img\b[^>]*\bsrc|source\b[^>]*\bsrc)\s*=\s*["']([^"']+)["']/gi;
const VERIFIABLE_ASSET = /\.(css|js|mjs|png|jpe?g|gif|webp|svg|avif|woff2?|ttf|otf|ico|mp4|webm)$/i;

export function findMissingLocalAssets(html: string, htmlFile: string, dir: string): string[] {
  const missing: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  ASSET_REF_RE.lastIndex = 0;
  while ((m = ASSET_REF_RE.exec(html))) {
    let ref = (m[1] || '').trim();
    if (!ref || /^(https?:|\/\/|data:|blob:|mailto:|tel:|javascript:|#)/i.test(ref)) continue;
    ref = ref.split(/[?#]/)[0];
    if (!ref || !VERIFIABLE_ASSET.test(ref) || seen.has(ref)) continue;
    seen.add(ref);
    const abs = ref.startsWith('/')
      ? path.join(dir, ref.replace(/^\/+/, ''))
      : path.resolve(path.dirname(htmlFile), ref);
    try {
      if (!fs.existsSync(abs)) missing.push(ref);
    } catch {
      /* ignore */
    }
  }
  return missing;
}

/** Audit a built/served static site's source for structural mobile defects. Never throws. */
export function auditWebHygiene(dir: string): WebHygieneResult {
  let files: string[];
  try {
    files = findHtmlFiles(dir);
  } catch {
    return { ran: false, defects: [] };
  }
  if (!files.length) return { ran: false, defects: [] };

  const defects: string[] = [];
  for (const f of files) {
    let html = '';
    try {
      html = fs.readFileSync(f, 'utf8');
    } catch {
      continue;
    }
    const rel = path.relative(dir, f) || path.basename(f);
    const css = collectCss(f, html, dir);

    if (!hasViewportMeta(html))
      defects.push(
        `${rel}: missing <meta name="viewport"> — on a phone the page renders at desktop width and zooms out (tiny, unusable). Add <meta name="viewport" content="width=device-width, initial-scale=1"> in <head>.`,
      );
    const mins = findFixedMinWidths(css);
    if (mins.length)
      defects.push(
        `${rel}: a fixed min-width wider than a phone (${mins.join(', ')}px) forces horizontal scrolling on mobile. Use max-width / fluid widths and media queries instead of a hard min-width.`,
      );
    if (hasMenuToggle(html) && !hasToggleWiring(html, css))
      defects.push(
        `${rel}: there's a menu/hamburger control but nothing wires it to open (no <script>, <details>, inline handler, or :checked/:target CSS) — the mobile menu won't open. Wire the toggle (JS classList toggle that shows the nav panel) or use the kit's working nav.`,
      );
    const missing = findMissingLocalAssets(html, f, dir);
    if (missing.length)
      defects.push(
        `${rel}: links local file(s) that don't exist — ${missing.join(', ')}. A <link>/<script>/<img> points at a file you never created (it 404s), so its CSS/JS/image is missing and the page renders broken (e.g. unstyled signature elements or lists falling back to default bullets). Either CREATE the missing file(s) with the intended styles/script, or fix the reference to the file that actually exists (e.g. site.css). Do NOT ship a page with a broken local reference.`,
      );
  }
  return { ran: true, defects: [...new Set(defects)].slice(0, 8) };
}
