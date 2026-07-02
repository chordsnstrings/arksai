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

/**
 * CSS cascade lint (pure): a responsive `@media (max-width…)` rule declared ABOVE the base rule
 * for the same selector is SILENTLY overridden for every property the base rule also sets (same
 * specificity → source order wins). This exact disease shipped a live app whose entire mobile
 * layer half-applied (art panel that was display:none'd showed anyway, a sidebar chip overlapped
 * every page heading). Returns actionable defect lines; empty when the cascade is clean.
 */
export function auditCssCascade(css: string): string[] {
  const defects: string[] = [];
  // Collect max-width media blocks with their end offsets: [{end, rules: {selector → props[]}}]
  // Pass 1: locate ALL @media block ranges (any kind) so later matches inside one can be skipped.
  const allMedia: { start: number; end: number; isMaxWidth: boolean }[] = [];
  const mediaRe = /@media[^{]*\{/g;
  let m: RegExpExecArray | null;
  while ((m = mediaRe.exec(css))) {
    let depth = 1;
    let i = m.index + m[0].length;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
      i++;
    }
    allMedia.push({ start: m.index, end: i, isMaxWidth: /max-width/.test(m[0]) });
    mediaRe.lastIndex = i; // don't re-match inside the block
  }
  const insideMedia = (idx: number) => allMedia.some((b) => idx > b.start && idx < b.end);

  // Pass 2: for each rule inside a max-width block, look for a LATER top-level rule with the
  // same selector re-declaring one of the same properties — the later rule wins everywhere.
  for (const b of allMedia) {
    if (!b.isMaxWidth) continue;
    const body = css.slice(css.indexOf('{', b.start) + 1, b.end - 1);
    const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
    let r: RegExpExecArray | null;
    while ((r = ruleRe.exec(body))) {
      const sel = r[1].trim();
      if (!sel || sel.startsWith('@')) continue;
      const props = r[2].split(';').map((p) => p.split(':')[0].trim().toLowerCase()).filter(Boolean);
      if (!props.length) continue;
      const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const laterRe = new RegExp(`(?:^|\\}|\\n|;)\\s*${esc}\\s*\\{([^{}]*)\\}`, 'g');
      laterRe.lastIndex = b.end;
      let later: RegExpExecArray | null;
      while ((later = laterRe.exec(css))) {
        if (insideMedia(later.index + later[0].indexOf(sel))) continue; // media-vs-media is fine
        const laterProps = later[1].split(';').map((p) => p.split(':')[0].trim().toLowerCase());
        const clash = props.filter((p) => laterProps.includes(p));
        if (clash.length) {
          defects.push(
            `CSS cascade bug: the responsive rule "${sel} { ${clash.join(', ')} }" inside a max-width @media block is declared BEFORE the base "${sel}" rule, so the base rule overrides it at EVERY width (same specificity → source order wins) — the mobile style silently never applies. Move @media blocks BELOW the base rules (keep a responsive layer at the END of the stylesheet).`,
          );
          break;
        }
      }
    }
  }
  return [...new Set(defects)].slice(0, 4);
}

/**
 * Production-seam audit (pure): demo-grade markers that must never ship in a DELIVERED app —
 * "we don't want a working demo or MVP; we want the actual complete production-level app."
 * Conservative, high-confidence only: placeholder latin, stub copy ("coming soon" as visible
 * text / a string literal, never a code comment), untouched scaffold fingerprints, unpatched
 * __APP_*__ tokens, and dead href="#" nav clusters. `kind` selects which patterns make sense
 * for the file (jsx applies both — JSX text nodes read like HTML, compiled strings like JS).
 */
export function findProductionSeams(content: string, kind: 'html' | 'js' | 'jsx'): string[] {
  const out: string[] = [];
  const STUB = /\b(coming soon|under construction|not (?:yet )?implemented)\b/i;

  if (/lorem ipsum/i.test(content))
    out.push('"lorem ipsum" placeholder text — the delivered product carries REAL copy everywhere; write the actual content.');
  if (/__APP_[A-Z_]+__/.test(content))
    out.push('an unreplaced __APP_*__ scaffold token is still in the shipped code — patch in the real app name/copy.');
  if (/build the app(?:'|’)s real content here|scaffolded home page/i.test(content))
    out.push('the scaffold home-page placeholder is still in place — build the app\'s REAL home content (the product\'s actual landing surface after sign-in), don\'t deliver the scaffold stub.');
  if (content.includes('EXEMPLAR list/create/toggle/delete page') && /<h1>\s*Items\s*<\/h1>/.test(content))
    out.push('the CRUD exemplar is still the untouched generic "Items" page — clone/rename it into the REAL domain entities (or remove it); a generic Items page is demo-grade, not the product.');

  const visibleStub =
    (kind !== 'js' && new RegExp(`>[^<>{}]{0,80}${STUB.source}`, 'i').test(content)) ||
    (kind !== 'html' && new RegExp(`["'\`][^"'\`\\n]{0,80}${STUB.source}`, 'i').test(content));
  if (visibleStub)
    out.push('stub copy ("coming soon" / "under construction" / "not implemented") in the UI — the delivered app must be production-COMPLETE: fully implement the feature or remove the screen/control; never ship a stub. (If a capability truly can\'t run here — e.g. live payments — build the complete flow up to that seam and state it plainly in the delivery message instead.)');

  if (kind === 'html') {
    const dead = (content.match(/href\s*=\s*["']#["']/gi) || []).length;
    if (dead >= 3)
      out.push(`${dead} dead links (href="#") — nav/footer links must lead somewhere real (a page, a section id, an action) or be removed; a wall of dead links is a demo, not a product.`);
  }
  return out;
}

const SEAM_EXT: Record<string, 'html' | 'js' | 'jsx'> = {
  '.html': 'html', '.htm': 'html', '.js': 'js', '.mjs': 'js', '.jsx': 'jsx', '.tsx': 'jsx', '.ts': 'js', '.vue': 'jsx', '.svelte': 'jsx',
};
const SEAM_SKIP_DIRS = new Set(['node_modules', '.git', '.arksai', 'data', 'uploads', 'knowledge', 'coverage']);

/** Walk the workspace (bounded) and collect production seams. Skips vendored/minified files. */
export function auditProductionSeams(dir: string): string[] {
  const defects: string[] = [];
  let visited = 0;
  const walk = (d: string, depth: number) => {
    if (depth > 6 || visited > 400 || defects.length > 24) return;
    let ents: fs.Dirent[];
    try {
      ents = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of ents) {
      if (visited > 400 || defects.length > 24) return;
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) {
        if (!ent.name.startsWith('.') && !SEAM_SKIP_DIRS.has(ent.name)) walk(p, depth + 1);
        continue;
      }
      const kind = SEAM_EXT[path.extname(ent.name).toLowerCase()];
      if (!kind) continue;
      visited++;
      let s = '';
      try {
        if (fs.statSync(p).size > 300_000) continue; // vendored bundles — not authored copy
        s = fs.readFileSync(p, 'utf8');
      } catch {
        continue;
      }
      // Minified vendor code (very long average lines) is never authored UI copy — skip it so a
      // library's internal "not implemented" error string can't fail a build.
      const lines = s.split('\n').length;
      if (s.length > 10_000 && s.length / lines > 400) continue;
      const rel = path.relative(dir, p) || ent.name;
      for (const seam of findProductionSeams(s, kind)) defects.push(`${rel}: ${seam}`);
    }
  };
  walk(dir, 0);
  return [...new Set(defects)].slice(0, 6);
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
    for (const c of auditCssCascade(css)) defects.push(`${rel}: ${c}`);
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
  // Production-completeness: demo-grade seams (placeholder copy, untouched scaffold pages,
  // dead-stub links) gate a delivery exactly like a structural defect — the bar is the
  // complete production app, not a working demo.
  try {
    defects.push(...auditProductionSeams(dir));
  } catch {
    /* never let the seam walk break the audit */
  }
  return { ran: true, defects: [...new Set(defects)].slice(0, 10) };
}
