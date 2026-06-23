import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { config } from '../config';
import { analyzeImage, generateTextM3 } from '../engines/minimax';
import { embedFontsInSvg, fontCatalogText, fontFaceCss, usedFamilies } from './fontkit';

/**
 * Logo & brand-identity generator. Gets M3 to its quality ceiling by playing ONLY to its
 * strengths — real font glyphs (perfect letterforms) + overlapping flat primitives (clean
 * shapes) — and BANNING the one thing it's bad at (morphing a glyph into an object). Then it
 * wraps the mark in a full designer submission: a brand directive + palette, light/dark
 * variants, app/website placements, and a zipped multi-format asset kit. See LOGO_PLAN.md.
 */

// ----------------------------------------------------------------- the spec (prompt)

/** The unified generation spec. `route` is 'auto' | 'concept' | 'lettermark'. Pure. */
export function logoSpec(): string {
  return `You are a world-class logo designer. Produce ONE self-contained inline SVG, viewBox "0 0 100 100", flat vector. Return ONLY the SVG inside a \`\`\`svg code block — no commentary. Never call an image tool; write the SVG yourself.

THE ONE LAW — NO MORPHING: never turn a letter into an object or an object into a letter. A LETTER is always REAL TYPE (an <text> element in a named font). An OBJECT is always built from PRIMITIVE SHAPES. They may sit beside / above / around each other, but they NEVER merge into one shape. (Hand-drawing a letter as <path> outlines is forbidden — use <text>.)

ROUTES (use the one in the directive; you may combine):
- CONCEPT / PICTORIAL: a concrete idea (boat, leaf, globe, bubble, shield, mountain, bird, sun, wave, building) BUILT FROM OVERLAPPING PRIMITIVES, optionally with a real-font wordmark below. The strong, distinctive route — prefer it whenever the concept can be drawn.
- LETTERMARK: an abstract/name-led brand — a real-font initial or word as the hero + at most ONE small primitive accent.

PRIMITIVE VOCABULARY (overlap, layer, group, transform, mirror freely):
<rect> (rx = rounded), <circle>, <ellipse>, <line>, <polyline>, <polygon> (triangles, trapezoids, diamonds, chevrons, stars), and SIMPLE curves via <path> using ONLY M/L/Q/C/A — for an OBJECT's curve (a wave, a hull, a crescent, a petal), NEVER to spell a letter. Use <g transform="translate()/rotate()/scale(-1,1)"> to place and mirror parts. Build a recognizable object by STACKING simple shapes (boat = trapezoid hull + triangle sail + line mast + wavy <path> water; bird = two overlapping ellipses + a triangle beak; globe = circle + ellipse meridians + arc orbits).

TYPOGRAPHY — any letters/words MUST be a real <text> element using the EXACT font-family named in the directive, font-weight 600 or 700, text-anchor="middle", dominant-baseline="central", and a font-size that fills the space. Do not substitute another font.

RULES: flat solid fills + solid strokes only (no gradients/shadows/filters/<image>); use ONLY the directive's palette hexes; one mark centered, filling ~70% of the canvas; EVERYTHING inside the canvas with >=6 units margin (nothing past x=6..94 / y=6..94 — for a long word REDUCE font-size until it fits: width ≈ font-size × 0.6 × letters); every load-bearing shape >=8 units so it survives at 16px; optically balanced. Put a full-canvas background <rect> first using the directive's background colour.

SELF-CHECK before returning: (1) NO morphing — every letter is real <text>, every object is primitives? (2) If concept route, is the object clearly assembled from recognizable overlapping primitives? (3) Only the directive's palette, flat, centered, nothing clipped at the edges? (4) Survives at 16px?`;
}

export interface Palette {
  name: string;
  hex: string;
  role: string;
}
export interface Directive {
  brandName: string;
  tagline?: string;
  concept: string;
  rationale: string;
  route: 'concept' | 'lettermark';
  palette: Palette[];
  typography: { display: string; body: string; labels?: string };
  background: 'light' | 'dark';
}

export interface LogoInput {
  brandName: string;
  brandDescription: string;
  directions?: string[];
  paletteHint?: string;
  vibe?: string;
  route?: 'auto' | 'concept' | 'lettermark';
  candidates?: number;
}

// ----------------------------------------------------------------- prompt builders (pure)

export function buildDirectivePrompt(input: LogoInput): string {
  const dirs = input.directions?.length ? `Concept directions the user wants explored: ${input.directions.join('; ')}.` : 'No fixed direction — propose the strongest concept.';
  const pal = input.paletteHint ? `Colour preference: ${input.paletteHint}.` : 'No fixed colours — choose a palette that fits the brand.';
  const vibe = input.vibe ? `Desired vibe: ${input.vibe}.` : '';
  const route = input.route && input.route !== 'auto' ? `Use the ${input.route} route.` : 'Choose the route (concept vs lettermark) that suits the brand best — prefer a concept/pictorial mark when there is a drawable idea.';
  return `You are a brand director writing the creative directive for a new logo. Reply with ONLY compact JSON (no prose, no code fence):
{"brandName":"...","tagline":"... (optional, omit if none)","concept":"one tight sentence naming the single visual idea","rationale":"2-3 sentences on why it fits the brand","route":"concept|lettermark","palette":[{"name":"Navy","hex":"#0A2540","role":"primary"},{"name":"Gold","hex":"#C9A24B","role":"accent"},{"name":"Ivory","hex":"#F5F1E8","role":"background"}],"typography":{"display":"<one family name from the list>","body":"<one family>","labels":"<one family>"},"background":"light|dark"}

Rules: 2-4 palette colours with hex + role (must include exactly one role:"background"); pick a DISTINCT, restrained palette (not generic blue unless it truly fits). Choose typography families ONLY from this catalogue, matched to the brand's personality:
${fontCatalogText()}

BRAND: ${input.brandName} — ${input.brandDescription}
${dirs}
${pal}
${vibe}
${route}`;
}

/** Compose the per-candidate generation prompt from the spec + the locked directive. Pure. */
export function buildGenPrompt(input: LogoInput, d: Directive): string {
  const palLines = d.palette.map((p) => `  ${p.hex} — ${p.name} (${p.role})`).join('\n');
  const bg = d.palette.find((p) => p.role === 'background')?.hex ?? (d.background === 'dark' ? '#0E1116' : '#FFFFFF');
  return `${logoSpec()}

----- LOCKED DIRECTIVE (follow exactly) -----
Brand: ${d.brandName}${d.tagline ? ` — "${d.tagline}"` : ''}
Concept: ${d.concept}
Route: ${d.route}
Palette (use ONLY these):
${palLines}
Background colour: ${bg}
Display font for any letters/words: "${d.typography.display}" (weight 700)

Build the mark now per the directive and the spec. Make it genuinely distinctive and premium — a logo a real studio would ship. Return ONLY the SVG.`;
}

/** Structure-locked polish prompt: fix the named defects, keep concept + shapes. Pure. */
export function buildPolishPrompt(svg: string, d: Directive, defects: string): string {
  return `You are doing a FINAL POLISH pass on this logo. Keep the CONCEPT and STRUCTURE exactly — do NOT change the idea, do NOT shrink the key shapes, do NOT switch fonts, do NOT add colours outside the palette. Improve ONLY craft: symmetry, balance, clean geometry, even spacing, and small-size legibility.

THE ONE LAW still holds: letters are real <text> in "${d.typography.display}"; objects are primitives; never merge them.
Palette (only these): ${d.palette.map((p) => p.hex).join(', ')}.
Keep everything inside x=6..94 / y=6..94 (nothing clipped).

FIX THESE SPECIFIC ISSUES:
${defects || '- tighten symmetry and optical centering; ensure it reads cleanly at 16px.'}

Return ONLY the improved SVG in a \`\`\`svg code block, viewBox "0 0 100 100".

CURRENT SVG:
${svg}`;
}

/** Recolor the exact SVG for the opposite-background variant. Pure. */
export function buildRecolorPrompt(svg: string, d: Directive, target: 'light' | 'dark'): string {
  const bgHex = target === 'dark' ? '#0E1116' : (d.palette.find((p) => p.role === 'background')?.hex ?? '#FFFFFF');
  return `Recolor this logo for a ${target.toUpperCase()} background. Keep EVERY shape, path, position, font and size IDENTICAL — change ONLY fill/stroke colours so the mark reads with strong contrast on ${target} (set the background <rect> to ${bgHex}; on dark, turn dark inks to off-white/light and keep the accent vivid; on light, do the reverse). Stay within the brand spirit of this palette: ${d.palette.map((p) => `${p.hex} ${p.name}`).join(', ')}. Return ONLY the SVG in a \`\`\`svg code block, viewBox "0 0 100 100".

CURRENT SVG:
${svg}`;
}

// ----------------------------------------------------------------- parsing (pure)

/** Pull the last <svg>…</svg> block from model output. Pure. */
export function extractSvg(text: string): string | null {
  const all = text.match(/<svg[\s\S]*?<\/svg>/gi);
  return all && all.length ? all[all.length - 1].trim() : null;
}

/** Lenient: is this a plausible, renderable SVG (not an error string)? Pure. */
export function looksLikeSvg(svg: string | null): svg is string {
  return !!svg && /<svg[\s>]/i.test(svg) && /<\/svg>/i.test(svg) && svg.length > 60;
}

/** Parse the directive JSON with a safe fallback derived from the inputs. Pure. */
export function parseDirective(text: string, input: LogoInput): Directive {
  const fallback: Directive = {
    brandName: input.brandName,
    concept: input.directions?.[0] || `A clean lettermark for ${input.brandName}`,
    rationale: `A restrained, premium mark for ${input.brandName}.`,
    route: input.route && input.route !== 'auto' ? input.route : 'lettermark',
    palette: [
      { name: 'Ink', hex: '#15233B', role: 'primary' },
      { name: 'Accent', hex: '#C9A24B', role: 'accent' },
      { name: 'Paper', hex: '#F5F1E8', role: 'background' },
    ],
    typography: { display: 'Space Grotesk', body: 'Inter', labels: 'Space Grotesk' },
    background: 'light',
  };
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return fallback;
  try {
    const j = JSON.parse(m[0]);
    const palette: Palette[] = Array.isArray(j.palette)
      ? j.palette
          .filter((p: any) => p && /^#[0-9a-fA-F]{3,8}$/.test(String(p.hex)))
          .map((p: any) => ({ name: String(p.name || 'Colour'), hex: String(p.hex), role: String(p.role || 'primary') }))
      : [];
    if (palette.length < 2) return fallback;
    if (!palette.some((p) => p.role === 'background')) palette.push({ name: 'Background', hex: '#FFFFFF', role: 'background' });
    const route: 'concept' | 'lettermark' = j.route === 'concept' || j.route === 'lettermark' ? j.route : fallback.route;
    const t = j.typography || {};
    return {
      brandName: String(j.brandName || input.brandName),
      tagline: j.tagline ? String(j.tagline) : undefined,
      concept: String(j.concept || fallback.concept),
      rationale: String(j.rationale || fallback.rationale),
      route,
      palette,
      typography: { display: String(t.display || 'Space Grotesk'), body: String(t.body || 'Inter'), labels: t.labels ? String(t.labels) : undefined },
      background: j.background === 'dark' ? 'dark' : 'light',
    };
  } catch {
    return fallback;
  }
}

// ----------------------------------------------------------------- HTML builders (pure)

const sz = (svg: string, n: number) => svg.replace(/<svg/i, `<svg width="${n}" height="${n}"`);

/** A square page that renders one SVG centered on a coloured background → for PNG/JPEG export. */
export function buildSwatchHtml(svg: string, n: number, bg: string, fontsCss: string): string {
  return `<!doctype html><html><head><meta charset="utf8"><style>${fontsCss}
*{margin:0}html,body{width:${n}px;height:${n}px;background:${bg};display:flex;align-items:center;justify-content:center}svg{display:block}</style></head><body>${sz(svg, Math.round(n * 0.82))}</body></html>`;
}

/** Rounded-square app-icon mock around the mark. */
export function buildAppIconHtml(svg: string, n: number, bg: string, fontsCss: string): string {
  const r = Math.round(n * 0.22);
  return `<!doctype html><html><head><meta charset="utf8"><style>${fontsCss}
*{margin:0}html,body{width:${n}px;height:${n}px;background:transparent;display:flex;align-items:center;justify-content:center}
.icon{width:${n}px;height:${n}px;border-radius:${r}px;background:${bg};display:flex;align-items:center;justify-content:center;overflow:hidden}</style></head><body><div class="icon">${sz(svg, Math.round(n * 0.62))}</div></body></html>`;
}

/** A browser-chrome website mock with the mark in the navbar. */
export function buildWebsiteHtml(svg: string, d: Directive, theme: 'light' | 'dark', fontsCss: string): string {
  const dark = theme === 'dark';
  const page = dark ? '#0E1116' : '#ffffff';
  const ink = dark ? '#E7E3DA' : '#15233B';
  const sub = dark ? 'rgba(231,227,218,0.6)' : 'rgba(21,35,59,0.55)';
  const bar = dark ? '#171B22' : '#F5F1E8';
  const accent = d.palette.find((p) => p.role === 'accent')?.hex ?? d.palette[0].hex;
  const hairline = dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
  const name = d.brandName;
  return `<!doctype html><html><head><meta charset="utf8"><style>${fontsCss}
*{margin:0;box-sizing:border-box}html,body{width:1600px;height:1000px;background:${page};font-family:'${d.typography.body}','Inter',sans-serif}
.chrome{height:46px;background:${bar};display:flex;align-items:center;gap:9px;padding:0 18px;border-bottom:1px solid ${hairline}}
.dot{width:12px;height:12px;border-radius:50%}
.nav{height:84px;display:flex;align-items:center;justify-content:space-between;padding:0 70px;border-bottom:1px solid ${hairline}}
.brand{display:flex;align-items:center;gap:14px}
.brand .nm{font-family:'${d.typography.display}',serif;font-weight:700;font-size:26px;color:${ink};letter-spacing:-0.01em}
.links{display:flex;gap:34px;color:${sub};font-size:17px;font-weight:500}
.cta{background:${accent};color:#fff;padding:11px 22px;border-radius:999px;font-weight:600;font-size:16px}
.hero{padding:110px 70px 0;text-align:center}
.ey{font-family:'${d.typography.labels || d.typography.display}',sans-serif;letter-spacing:0.22em;text-transform:uppercase;color:${accent};font-size:15px;font-weight:600}
.h1{font-family:'${d.typography.display}',serif;font-weight:700;font-size:74px;line-height:1.02;letter-spacing:-0.02em;color:${ink};max-width:16em;margin:20px auto 0}
.p{color:${sub};font-size:22px;margin:26px auto 0;max-width:30em;line-height:1.5}</style></head><body>
<div class="chrome"><span class="dot" style="background:#ff5f57"></span><span class="dot" style="background:#febc2e"></span><span class="dot" style="background:#28c840"></span></div>
<div class="nav"><div class="brand">${sz(svg, 46)}<span class="nm">${escapeHtml(name)}</span></div><div class="links"><span>Product</span><span>Company</span><span>Pricing</span><span class="cta">Get started</span></div></div>
<div class="hero"><div class="ey">${escapeHtml(d.tagline || 'Built for what matters')}</div><div class="h1">${escapeHtml(name)}</div><div class="p">${escapeHtml(d.concept)}</div></div>
</body></html>`;
}

/** The full designer presentation page (concept · marks · palette · type · placements). */
export function buildBrandSheetHtml(d: Directive, lightSvg: string, darkSvg: string, fontsCss: string): string {
  const sw = d.palette
    .map(
      (p) =>
        `<div class="sw"><div class="chip" style="background:${p.hex}"></div><div class="meta"><div class="cn">${escapeHtml(p.name)}</div><div class="ch">${escapeHtml(p.hex.toUpperCase())}</div><div class="cr">${escapeHtml(p.role)}</div></div></div>`,
    )
    .join('');
  const accent = d.palette.find((p) => p.role === 'accent')?.hex ?? d.palette[0].hex;
  return `<!doctype html><html><head><meta charset="utf8"><style>${fontsCss}
*{margin:0;box-sizing:border-box}body{background:#F5F1E8;color:#15233B;font-family:'Inter',sans-serif;padding:64px 72px;max-width:1100px;margin:0 auto}
.eyebrow{font-family:'Space Grotesk',sans-serif;letter-spacing:0.24em;text-transform:uppercase;font-size:13px;color:${accent};font-weight:600}
h1{font-family:'${d.typography.display}','Source Serif 4',serif;font-weight:700;font-size:54px;letter-spacing:-0.02em;margin:10px 0 4px}
.tag{font-size:18px;color:rgba(21,35,59,0.6);margin-bottom:8px}
.rule{height:1px;background:rgba(21,35,59,0.14);margin:30px 0}
h2{font-family:'Space Grotesk',sans-serif;font-size:13px;letter-spacing:0.18em;text-transform:uppercase;color:rgba(21,35,59,0.5);margin:36px 0 16px;font-weight:600}
.lede{font-size:19px;line-height:1.6;max-width:40em;color:rgba(21,35,59,0.85)}
.marks{display:grid;grid-template-columns:1fr 1fr;gap:20px}
.mk{border-radius:16px;padding:48px;display:flex;align-items:center;justify-content:center}
.mk.l{background:#fff;border:1px solid rgba(0,0,0,0.06)}
.mk.d{background:#0E1116}
.pal{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
.sw{display:flex;flex-direction:column;gap:10px}
.chip{height:88px;border-radius:12px;border:1px solid rgba(0,0,0,0.06)}
.cn{font-weight:600;font-size:15px}.ch{font-family:'Space Grotesk',monospace;font-size:13px;color:rgba(21,35,59,0.6)}.cr{font-size:12px;color:rgba(21,35,59,0.45);text-transform:uppercase;letter-spacing:0.08em}
.type{display:flex;flex-direction:column;gap:18px}
.spec{display:flex;align-items:baseline;gap:18px;border-bottom:1px solid rgba(21,35,59,0.08);padding-bottom:14px}
.spec .lab{font-family:'Space Grotesk',sans-serif;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:rgba(21,35,59,0.5);width:90px;flex:0 0 auto}
.place{display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:center}
.appicon{width:120px;height:120px;border-radius:27px;background:${d.background === 'dark' ? '#0E1116' : '#fff'};border:1px solid rgba(0,0,0,0.06);display:flex;align-items:center;justify-content:center}
.foot{margin-top:40px;font-size:12px;color:rgba(21,35,59,0.4)}</style></head><body>
<div class="eyebrow">Brand Identity</div>
<h1>${escapeHtml(d.brandName)}</h1>
${d.tagline ? `<div class="tag">${escapeHtml(d.tagline)}</div>` : ''}
<div class="rule"></div>
<h2>The concept</h2>
<div class="lede"><strong>${escapeHtml(d.concept)}</strong><br><br>${escapeHtml(d.rationale)}</div>
<h2>The mark — light &amp; dark</h2>
<div class="marks"><div class="mk l">${sz(lightSvg, 220)}</div><div class="mk d">${sz(darkSvg, 220)}</div></div>
<h2>Palette</h2>
<div class="pal">${sw}</div>
<h2>Typography</h2>
<div class="type">
  <div class="spec"><span class="lab">Display</span><span style="font-family:'${d.typography.display}',serif;font-size:34px">${escapeHtml(d.typography.display)}</span></div>
  <div class="spec"><span class="lab">Body</span><span style="font-family:'${d.typography.body}',sans-serif;font-size:24px">${escapeHtml(d.typography.body)} — the quick brown fox</span></div>
</div>
<h2>In place</h2>
<div class="place"><div class="appicon">${sz(d.background === 'dark' ? darkSvg : lightSvg, 80)}</div><div class="lede" style="font-size:16px">Works as an app icon, a favicon, and a navbar mark — at full size and at 16px. SVG for the web, PNG/JPEG (light &amp; dark) for everywhere else.</div></div>
<div class="foot">Generated by ArksAI · ${new Date().getFullYear()} · ${escapeHtml(d.brandName)} brand kit</div>
</body></html>`;
}

export function escapeHtml(s: string): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Contact sheet of N candidates for the vision judge. */
function buildContactSheet(svgs: string[], fontsCss: string): string {
  const cells = svgs
    .map(
      (s, i) =>
        `<div class="c"><div class="big">${sz(s, 150)}</div><div class="sm">${sz(s, 28)}</div><div class="lab">candidate ${i + 1}</div></div>`,
    )
    .join('');
  return `<!doctype html><html><head><meta charset="utf8"><style>${fontsCss}
*{margin:0;box-sizing:border-box}body{background:#F5F1E8;font-family:Inter,sans-serif;display:flex;flex-wrap:wrap}
.c{width:${100 / svgs.length}%;padding:22px;text-align:center}
.big{background:#fff;border-radius:10px;padding:14px;display:inline-block}
.sm{margin-top:10px}.lab{margin-top:10px;font-size:13px;font-weight:700;color:#15233B}</style></head><body>${cells}</body></html>`;
}

// ----------------------------------------------------------------- rendering (Chromium)

interface RenderJob {
  html: string;
  w: number;
  h: number;
  out: string; // absolute
  format: 'png' | 'jpeg';
}

async function renderJobs(jobs: RenderJob[]): Promise<void> {
  let pw: any;
  try {
    pw = await import('playwright');
  } catch {
    throw new Error('logo rendering needs Playwright/Chromium, which is not available here');
  }
  const browser = await pw.chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const ctx = await browser.newContext({ deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    for (const j of jobs) {
      await page.setViewportSize({ width: j.w, height: j.h });
      await page.setContent(j.html, { waitUntil: 'load', timeout: 30_000 });
      await page.evaluate('document.fonts && document.fonts.ready').catch(() => {});
      await page.waitForTimeout(150);
      await page.screenshot(j.format === 'jpeg' ? { path: j.out, type: 'jpeg', quality: 92 } : { path: j.out, type: 'png' });
    }
  } finally {
    try {
      await browser.close();
    } catch {}
  }
}

async function renderOne(html: string, w: number, h: number, out: string, format: 'png' | 'jpeg' = 'png'): Promise<void> {
  await renderJobs([{ html, w, h, out, format }]);
}

// ----------------------------------------------------------------- zip

function zipDir(srcDir: string, outZipAbs: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('zip', ['-r', '-q', outZipAbs, '.'], { cwd: srcDir, timeout: 60_000 }, (err) => {
      if (!err && fs.existsSync(outZipAbs)) return resolve(true);
      // fallback: tar.gz next to it
      const tgz = outZipAbs.replace(/\.zip$/, '.tar.gz');
      execFile('tar', ['-czf', tgz, '.'], { cwd: srcDir, timeout: 60_000 }, (e2) => resolve(!e2 && fs.existsSync(tgz)));
    });
  });
}

// ----------------------------------------------------------------- directive → markdown

export function directiveMarkdown(d: Directive): string {
  const pal = d.palette.map((p) => `| ${p.name} | \`${p.hex.toUpperCase()}\` | ${p.role} |`).join('\n');
  return `# ${d.brandName} — Brand Directive${d.tagline ? `\n\n*${d.tagline}*` : ''}

## The concept
**${d.concept}**

${d.rationale}

## Palette
| Colour | Hex | Role |
|---|---|---|
${pal}

## Typography
- **Display:** ${d.typography.display}
- **Body:** ${d.typography.body}${d.typography.labels ? `\n- **Labels:** ${d.typography.labels}` : ''}

## Usage
- Use the **light** mark on light/photo backgrounds, the **dark** mark on dark.
- Keep clear space around the mark equal to the height of the mark's main element.
- Prefer the **SVG** on the web; use the **PNG/JPEG** exports (light & dark) elsewhere.
- Don't recolour, stretch, rotate, add effects, or place the mark on a clashing colour.

*Generated by ArksAI.*
`;
}

// ----------------------------------------------------------------- the pipeline

export interface LogoResult {
  ok: boolean;
  error?: string;
  zipPath?: string; // workspace-relative
  brandSheetPath?: string;
  heroPath?: string;
  directive?: Directive;
  notes: string;
  costUsd: number;
}

export async function composeLogo(input: LogoInput, repoDir: string, signal: AbortSignal): Promise<LogoResult> {
  const log: string[] = [];
  let cost = 0;
  const n = Math.min(Math.max(input.candidates ?? 3, 1), 5);
  try {
    // 1) directive
    const dRes = await generateTextM3(buildDirectivePrompt(input), signal, { maxTokens: 1200 });
    cost += config.minimaxTextCost;
    const directive = parseDirective(dRes.ok ? dRes.text! : '', input);
    if (!dRes.ok) log.push('directive fell back to defaults');

    // 2) best-of-N candidates (sequential — M3 stalls under concurrency)
    const genPrompt = buildGenPrompt(input, directive);
    const svgs: string[] = [];
    for (let i = 0; i < n; i++) {
      const r = await generateTextM3(genPrompt, signal, { maxTokens: 3000 });
      cost += config.minimaxTextCost;
      const svg = r.ok ? extractSvg(r.text!) : null;
      if (looksLikeSvg(svg)) svgs.push(svg);
    }
    if (!svgs.length) return { ok: false, notes: log.join('; '), costUsd: cost, error: 'the model did not return a usable SVG — try again' };

    // 3) + 4) vision-select the strongest (skip if only one)
    const sheetCss = fontFaceCss(); // full set for the contact sheet
    let winner = svgs[0];
    let defects = '';
    if (svgs.length > 1) {
      const tmpSheet = path.join(os.tmpdir(), `arks-logo-sheet-${Date.now()}.png`);
      await renderOne(buildContactSheet(svgs, sheetCss), Math.min(280 * svgs.length, 1200), 320, tmpSheet, 'png');
      const judge = await analyzeImage(
        `data:image/png;base64,${fs.readFileSync(tmpSheet).toString('base64')}`,
        `These are ${svgs.length} logo candidates (left to right: candidate 1..${svgs.length}) for "${directive.brandName}". Concept: ${directive.concept}. As a senior brand designer, judge concept clarity, legibility, craft and 16px survival, then pick the STRONGEST. Reply with ONLY compact JSON: {"winner":<1-${svgs.length}>,"defects":"the 1-2 specific craft fixes the winner still needs"}.`,
        signal,
      );
      cost += config.minimaxVisionCost;
      try { fs.unlinkSync(tmpSheet); } catch {}
      if (judge.ok && judge.text) {
        const m = judge.text.match(/\{[\s\S]*\}/);
        if (m) {
          try {
            const j = JSON.parse(m[0]);
            const idx = Number(j.winner) - 1;
            if (idx >= 0 && idx < svgs.length) { winner = svgs[idx]; log.push(`vision picked candidate ${idx + 1}/${svgs.length}`); }
            if (typeof j.defects === 'string') defects = j.defects;
          } catch {}
        }
      }
    }

    // 5) structure-locked polish
    {
      const r = await generateTextM3(buildPolishPrompt(winner, directive, defects), signal, { maxTokens: 3000 });
      cost += config.minimaxTextCost;
      const polished = r.ok ? extractSvg(r.text!) : null;
      if (looksLikeSvg(polished)) { winner = polished; log.push('polished'); }
    }

    // 6) dark variant (recolor)
    let lightSvg = winner;
    let darkSvg = winner;
    {
      const target: 'light' | 'dark' = directive.background === 'dark' ? 'light' : 'dark';
      const r = await generateTextM3(buildRecolorPrompt(winner, directive, target), signal, { maxTokens: 3000 });
      cost += config.minimaxTextCost;
      const recolored = r.ok ? extractSvg(r.text!) : null;
      if (looksLikeSvg(recolored)) {
        if (target === 'dark') darkSvg = recolored;
        else { darkSvg = winner; lightSvg = recolored; }
        log.push(`generated ${target} variant`);
      } else {
        log.push('dark variant fell back to the primary mark');
      }
    }

    // 7) embed fonts so the standalone SVGs render anywhere
    lightSvg = embedFontsInSvg(lightSvg);
    darkSvg = embedFontsInSvg(darkSvg);
    const usedCss = fontFaceCss([...new Set([...usedFamilies(lightSvg), ...usedFamilies(darkSvg), directive.typography.display, directive.typography.body])]);

    // 8) build the kit in a temp dir, render rasters, zip into the workspace
    const slug = (directive.brandName || 'brand').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'brand';
    const stage = fs.mkdtempSync(path.join(os.tmpdir(), `arks-logo-${slug}-`));
    const mk = (sub: string) => { const dd = path.join(stage, sub); fs.mkdirSync(dd, { recursive: true }); return dd; };
    const svgDir = mk('svg'), pngDir = mk('png'), jpgDir = mk('jpeg');
    fs.writeFileSync(path.join(svgDir, 'logo-light.svg'), lightSvg);
    fs.writeFileSync(path.join(svgDir, 'logo-dark.svg'), darkSvg);
    fs.writeFileSync(path.join(stage, 'brand-directive.md'), directiveMarkdown(directive));

    const lightBg = directive.palette.find((p) => p.role === 'background')?.hex ?? '#FFFFFF';
    const DARK = '#0E1116';
    const jobs: RenderJob[] = [];
    for (const px of [1024, 512, 256, 128, 64]) {
      jobs.push({ html: buildSwatchHtml(lightSvg, px, lightBg, usedCss), w: px, h: px, out: path.join(pngDir, `logo-light-${px}.png`), format: 'png' });
      jobs.push({ html: buildSwatchHtml(darkSvg, px, DARK, usedCss), w: px, h: px, out: path.join(pngDir, `logo-dark-${px}.png`), format: 'png' });
    }
    jobs.push({ html: buildSwatchHtml(lightSvg, 1024, lightBg, usedCss), w: 1024, h: 1024, out: path.join(jpgDir, 'logo-light-1024.jpg'), format: 'jpeg' });
    jobs.push({ html: buildSwatchHtml(darkSvg, 1024, DARK, usedCss), w: 1024, h: 1024, out: path.join(jpgDir, 'logo-dark-1024.jpg'), format: 'jpeg' });
    jobs.push({ html: buildAppIconHtml(lightSvg, 1024, lightBg, usedCss), w: 1024, h: 1024, out: path.join(stage, 'app-icon-light.png'), format: 'png' });
    jobs.push({ html: buildAppIconHtml(darkSvg, 1024, DARK, usedCss), w: 1024, h: 1024, out: path.join(stage, 'app-icon-dark.png'), format: 'png' });
    jobs.push({ html: buildSwatchHtml(directive.background === 'dark' ? darkSvg : lightSvg, 64, directive.background === 'dark' ? DARK : lightBg, usedCss), w: 64, h: 64, out: path.join(stage, 'favicon-64.png'), format: 'png' });
    jobs.push({ html: buildWebsiteHtml(lightSvg, directive, 'light', usedCss), w: 1600, h: 1000, out: path.join(stage, 'placement-website-light.png'), format: 'png' });
    jobs.push({ html: buildWebsiteHtml(darkSvg, directive, 'dark', usedCss), w: 1600, h: 1000, out: path.join(stage, 'placement-website-dark.png'), format: 'png' });

    const brandSheet = buildBrandSheetHtml(directive, lightSvg, darkSvg, fontFaceCss());
    fs.writeFileSync(path.join(stage, 'brand-sheet.html'), brandSheet);

    await renderJobs(jobs);

    // 9) zip + surface a few key files into the workspace
    const outDir = path.join(repoDir, 'images');
    fs.mkdirSync(outDir, { recursive: true });
    const zipName = `${slug}-logo-kit.zip`;
    const zipAbs = path.join(outDir, zipName);
    try { fs.unlinkSync(zipAbs); } catch {}
    const zipped = await zipDir(stage, zipAbs);
    // a hero PNG + the brand sheet + a quick SVG land in the workspace so they auto-surface
    const heroName = `${slug}-logo.png`;
    fs.copyFileSync(path.join(pngDir, 'logo-light-1024.png'), path.join(outDir, heroName));
    const sheetName = `${slug}-brand-sheet.html`;
    fs.writeFileSync(path.join(outDir, sheetName), brandSheet);
    fs.writeFileSync(path.join(outDir, `${slug}-logo.svg`), lightSvg);
    try { fs.rmSync(stage, { recursive: true, force: true }); } catch {}

    const finalZip = zipped ? (fs.existsSync(zipAbs) ? `images/${zipName}` : `images/${zipName.replace(/\.zip$/, '.tar.gz')}`) : undefined;
    return {
      ok: true,
      zipPath: finalZip,
      brandSheetPath: `images/${sheetName}`,
      heroPath: `images/${heroName}`,
      directive,
      notes: `route=${directive.route}, font=${directive.typography.display}, ${svgs.length} candidate(s)${log.length ? ' · ' + log.join('; ') : ''}`,
      costUsd: cost,
    };
  } catch (e: any) {
    return { ok: false, notes: log.join('; '), costUsd: cost, error: String(e?.message ?? e) };
  }
}
