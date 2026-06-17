import fs from 'node:fs';
import path from 'node:path';
import { config, repoRoot } from '../config';
import { analyzeImage } from '../engines/minimax';

/**
 * Marketing "creative" generator — the workaround for MiniMax not placing text well.
 * Pipeline: generate a TEXT-FREE background with reserved negative space → use M3 vision
 * to find the calmest zone + the colour that reads there → composite PIXEL-CRISP brand
 * typography on top with HTML/CSS (+ a contrast scrim) → rasterise to PNG/JPEG with
 * headless Chromium → vision QC + one corrective pass. Output is always an image so it's
 * drop-in usable. Reuses generate_image + analyze_image (M3) and the report fonts.
 */

const FONT_DIR = path.join(repoRoot, 'server', 'assets', 'report-fonts');

// Target canvas per aspect + the nearest MiniMax-supported generation ratio (we cover-crop).
// image-01 supports 1:1/3:4/4:3/2:3/3:2/9:16/16:9/21:9 — pick the CLOSEST so the crop is
// minimal and the vision-chosen text zone stays valid (4:5≈0.80 → 3:4≈0.75 crops ~90px,
// vs 9:16≈0.56 which cropped ~570px and moved the imagery out from under the zone).
export const CREATIVE_SIZES: Record<string, { w: number; h: number; gen: string }> = {
  '1:1': { w: 1080, h: 1080, gen: '1:1' },
  '4:5': { w: 1080, h: 1350, gen: '3:4' },
  '9:16': { w: 1080, h: 1920, gen: '9:16' },
  '16:9': { w: 1280, h: 720, gen: '16:9' },
  '1.91:1': { w: 1200, h: 628, gen: '16:9' },
};

export type Zone = 'top' | 'bottom' | 'left' | 'right';
export interface CreativeCopy {
  kicker?: string;
  headline: string;
  sub?: string;
  bullets?: string[];
  cta?: string;
  accent: string;
}

const sniffMime = (b: Buffer): string => (b[0] === 0xff && b[1] === 0xd8 ? 'image/jpeg' : 'image/png');

let _fontsCss: string | null = null;
function fontsCss(): string {
  if (_fontsCss != null) return _fontsCss;
  try {
    const ff = (fam: string, file: string, w: number) =>
      `@font-face{font-family:'${fam}';font-weight:${w};font-display:block;src:url(data:font/woff2;base64,${fs.readFileSync(path.join(FONT_DIR, file)).toString('base64')}) format('woff2')}`;
    _fontsCss = [
      ff('Inter', 'inter-400.woff2', 400), ff('Inter', 'inter-500.woff2', 500), ff('Inter', 'inter-600.woff2', 600), ff('Inter', 'inter-700.woff2', 700),
      ff('Source Serif 4', 'source-serif-400.woff2', 400), ff('Source Serif 4', 'source-serif-600.woff2', 600),
      ff('Space Grotesk', 'space-grotesk-500.woff2', 500), ff('Space Grotesk', 'space-grotesk-700.woff2', 700),
    ].join('\n');
  } catch {
    _fontsCss = ''; // fall back to system fonts if the assets are missing
  }
  return _fontsCss;
}

const esc = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escMultiline = (s: string) => esc(s).replace(/\r?\n/g, '<br>');

/**
 * Pure: build the composited-creative HTML. Exported for unit tests (no disk/network).
 */
export function buildCreativeHtml(opts: {
  bgDataUrl: string;
  zone: Zone;
  textColor: 'light' | 'dark';
  copy: CreativeCopy;
  w: number;
  h: number;
  logoDataUrl?: string;
  logoPlaceholder?: boolean;
  logoIsSvg?: boolean;
  fontsCss?: string;
}): string {
  const { bgDataUrl, zone, textColor, copy, w, h, logoDataUrl, logoPlaceholder, logoIsSvg } = opts;
  const light = textColor !== 'dark';
  const ink = light ? '#ffffff' : '#1b1813';
  const subInk = light ? 'rgba(255,255,255,0.86)' : 'rgba(27,24,19,0.72)';
  const scrimRGB = light ? '16,14,12' : '245,241,233';
  const dir = { bottom: 'to top', top: 'to bottom', left: 'to right', right: 'to left' }[zone];
  const scrim = `linear-gradient(${dir}, rgba(${scrimRGB},${light ? 0.72 : 0.9}) 0%, rgba(${scrimRGB},${light ? 0.34 : 0.55}) 42%, rgba(${scrimRGB},0) 72%)`;
  const pos: Record<Zone, string> = {
    bottom: 'left:0;right:0;bottom:0;padding:0 8% 8.5%;justify-content:flex-end;align-items:flex-start;text-align:left',
    top: 'left:0;right:0;top:0;padding:8.5% 8% 0;justify-content:flex-start;align-items:flex-start;text-align:left',
    left: 'left:0;top:0;bottom:0;width:62%;padding:0 0 0 8%;justify-content:center;align-items:flex-start;text-align:left',
    right: 'right:0;top:0;bottom:0;width:62%;padding:0 8% 0 0;justify-content:center;align-items:flex-end;text-align:right',
  };
  const wide = w >= h;
  const hSize = Math.round(w * (wide ? 0.07 : 0.078));
  const shadow = light ? 'text-shadow:0 1px 26px rgba(0,0,0,0.34)' : 'none';
  const bSize = Math.round(w * 0.0235);
  const bullets = (copy.bullets ?? []).filter(Boolean);
  const bulletsHtml = bullets.length
    ? `<div class="bl" style="margin-top:${Math.round(h * 0.028)}px">${bullets
        .map((b) => `<div class="bi"><span class="ck">✓</span><span>${esc(b)}</span></div>`)
        .join('')}</div>`
    : '';
  // Brand corner (top-left): a real logo, or a tasteful placeholder. Gets its own soft
  // scrim so it always reads. The pipeline keeps the text out of the top when this is on.
  const brandH = Math.round(h * 0.072);
  const brand = logoDataUrl
    ? `<div class="brand"><img src="${logoDataUrl}"></div>`
    : logoPlaceholder
    ? `<div class="brand"><span class="ph">LOGO</span></div>`
    : '';
  const brandScrim = logoDataUrl || logoPlaceholder ? `<div class="bscrim"></div>` : '';
  return `<!doctype html><html><head><meta charset="utf8"><style>${opts.fontsCss ?? fontsCss()}
*{margin:0;box-sizing:border-box}html,body{width:100%;height:100%}
.card{position:relative;width:${w}px;height:${h}px;overflow:hidden;background:#0d0c0b;font-family:'Inter',system-ui,sans-serif}
.bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.scrim{position:absolute;inset:0;background:${scrim};z-index:1}
.bscrim{position:absolute;top:0;left:0;width:60%;height:34%;background:radial-gradient(ellipse at top left, rgba(0,0,0,0.5), rgba(0,0,0,0) 72%);z-index:2}
.brand{position:absolute;top:${Math.round(h * 0.062)}px;left:${Math.round(w * 0.06)}px;z-index:4}
.brand img{${logoIsSvg ? `width:${Math.round(w * 0.42)}px;` : ''}height:${brandH}px;max-width:${Math.round(w * 0.42)}px;object-fit:contain;object-position:left center}
.brand .ph{display:inline-flex;align-items:center;justify-content:center;height:${brandH}px;padding:0 ${Math.round(w * 0.03)}px;border:1.5px dashed rgba(255,255,255,0.78);border-radius:12px;background:rgba(255,255,255,0.1);color:#fff;font-family:'Space Grotesk',sans-serif;font-weight:500;font-size:${Math.round(w * 0.018)}px;letter-spacing:0.16em}
.c{position:absolute;display:flex;flex-direction:column;gap:0;z-index:3;${pos[zone]}}
.kick{font-family:'Space Grotesk',sans-serif;font-weight:500;font-size:${Math.round(w * 0.0185)}px;letter-spacing:0.2em;text-transform:uppercase;color:${light ? '#fff' : copy.accent};opacity:${light ? 0.92 : 1};margin-bottom:${Math.round(h * 0.022)}px}
.h{font-family:'Source Serif 4',Georgia,serif;font-weight:600;font-size:${hSize}px;line-height:0.99;letter-spacing:-0.02em;color:${ink};${shadow}}
.sub{font-family:'Inter',sans-serif;font-weight:500;font-size:${Math.round(w * 0.026)}px;line-height:1.35;color:${ink};margin-top:${Math.round(h * 0.026)}px;max-width:20em;${shadow}}
.bl{display:flex;flex-direction:column;gap:${Math.round(h * 0.014)}px}
.bi{display:flex;align-items:center;gap:0.55em;font-family:'Inter',sans-serif;font-weight:400;font-size:${bSize}px;color:${subInk}}
.bi .ck{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;width:${Math.round(bSize * 1.25)}px;height:${Math.round(bSize * 1.25)}px;border-radius:50%;background:${esc(copy.accent)};color:#fff;font-size:${Math.round(bSize * 0.74)}px;font-weight:700}
.cta{align-self:${zone === 'right' ? 'flex-end' : 'flex-start'};margin-top:${Math.round(h * 0.04)}px;background:${esc(copy.accent)};color:#fff;font-family:'Inter',sans-serif;font-weight:600;font-size:${Math.round(w * 0.021)}px;padding:${Math.round(h * 0.019)}px ${Math.round(w * 0.032)}px;border-radius:999px}
</style></head><body><div class="card"><img class="bg" src="${bgDataUrl}"><div class="scrim"></div>${brandScrim}${brand}<div class="c">${
    copy.kicker ? `<div class="kick">${esc(copy.kicker)}</div>` : ''
  }${copy.headline ? `<div class="h">${escMultiline(copy.headline)}</div>` : ''}${copy.sub ? `<div class="sub">${esc(copy.sub)}</div>` : ''}${bulletsHtml}${
    copy.cta ? `<span class="cta">${esc(copy.cta)}</span>` : ''
  }</div></div></body></html>`;
}

const NEG = 'absolutely no text, no words, no letters, no typography, no captions, no labels, no logos, no watermark, no UI, no charts';

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Strip the COPY out of the imagery prompt so the image model can't try to render it as
 * (garbled) text in the background — the #1 cause of a bad creative. Models routinely cram
 * the headline/CTA into `prompt`; this removes the literal copy fields, any quoted strings,
 * and "text that says…" lead-ins, leaving only the scene description. Pure (unit-tested).
 */
export function scrubImageryPrompt(prompt: string, copy: CreativeCopy): string {
  let p = ` ${prompt} `;
  const phrases = [copy.headline, copy.sub, copy.cta, copy.kicker, ...(copy.bullets ?? [])]
    .map((s) => (s ?? '').trim())
    .filter((s) => s.length >= 3)
    .sort((a, b) => b.length - a.length); // remove longer phrases first
  for (const ph of phrases) p = p.replace(new RegExp(escapeRegExp(ph), 'gi'), ' ');
  // quoted strings (straight + curly + guillemets) are almost always literal copy
  p = p.replace(/["“”'‘’«»][^"“”'‘’«»]{0,140}["“”'‘’«»]/g, ' ');
  // copy-injection lead-ins ("with the text …", "that says …", "headline reading …")
  p = p.replace(
    /\b(?:with (?:the )?(?:text|headline|caption|words?|copy|title|slogan|tagline)|that says|which says|reading|labell?ed|captioned|overla(?:y|id|ying)(?:ed)? text|text overlay)\b[:,]?/gi,
    ' ',
  );
  p = p
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/^[\s,.;:–—-]+|[\s,.;:–—-]+$/g, '')
    .trim();
  return p || prompt.trim(); // never return empty — fall back to the original
}

async function genBackground(prompt: string, genRatio: string, signal: AbortSignal, hard = false): Promise<Buffer> {
  // On a re-gen after text leaked into the image, lead with an emphatic no-text directive.
  const lead = hard
    ? 'CRITICAL: a purely VISUAL image with ABSOLUTELY ZERO text, letters, words or numbers anywhere. '
    : '';
  const res = await fetch(`${config.minimaxBaseUrl.replace(/\/$/, '')}/image_generation`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.minimaxApiKey}`, 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({ model: config.minimaxImageModel, prompt: `${lead}${prompt}. Leave generous clean empty negative space for a text overlay. Editorial, premium, high-end advertising. ${NEG}`, aspect_ratio: genRatio, n: 1, response_format: 'url' }),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`image_generation HTTP ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
  const url: string | undefined = data?.data?.image_urls?.[0] ?? data?.data?.images?.[0];
  if (!url) throw new Error(`no image returned: ${JSON.stringify(data).slice(0, 200)}`);
  const img = await fetch(url, { signal });
  if (!img.ok) throw new Error(`could not download the generated image (HTTP ${img.status})`);
  return Buffer.from(await img.arrayBuffer());
}

async function visionPlan(buf: Buffer, signal: AbortSignal): Promise<{ zone: Zone; textColor: 'light' | 'dark'; hasText: boolean; clutter: number }> {
  const dataUrl = `data:${sniffMime(buf)};base64,${buf.toString('base64')}`;
  const r = await analyzeImage(
    dataUrl,
    'You are a senior art director placing a headline + subhead + button over this image. Reply with ONLY compact JSON, no prose: ' +
      '{"zone":"top|bottom|left|right","textColor":"light|dark","hasText":true|false,"clutter":0-10}. ' +
      'zone = the calmest, emptiest region with room for the copy. textColor = what reads cleanly THERE. hasText = are there ANY rendered words/letters in the image. clutter = how busy the chosen zone is (0 clean … 10 busy).',
    signal,
  );
  const fallback = { zone: 'bottom' as Zone, textColor: 'light' as const, hasText: false, clutter: 3 };
  if (!r.ok || !r.text) return fallback;
  const m = r.text.match(/\{[\s\S]*\}/);
  if (!m) return fallback;
  try {
    const j = JSON.parse(m[0]);
    const zone: Zone = ['top', 'bottom', 'left', 'right'].includes(j.zone) ? j.zone : 'bottom';
    return { zone, textColor: j.textColor === 'dark' ? 'dark' : 'light', hasText: !!j.hasText, clutter: Number(j.clutter) || 0 };
  } catch {
    return fallback;
  }
}

async function renderToImage(html: string, w: number, h: number, absOut: string, format: 'png' | 'jpeg'): Promise<void> {
  let pw: any;
  try {
    pw = await import('playwright');
  } catch {
    throw new Error('image rendering needs Playwright/Chromium, which is not available here');
  }
  const browser = await pw.chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.setContent(html, { waitUntil: 'load', timeout: 30_000 });
    // string form so the server tsconfig (no DOM lib) doesn't try to resolve `document`
    await page.evaluate('document.fonts && document.fonts.ready').catch(() => {});
    await page.waitForTimeout(180);
    await page.screenshot(format === 'jpeg' ? { path: absOut, type: 'jpeg', quality: 90 } : { path: absOut, type: 'png' });
  } finally {
    try {
      await browser.close();
    } catch {}
  }
}

export interface CreativeResult {
  ok: boolean;
  files: { path: string }[];
  error?: string;
  notes: string;
  costUsd: number;
}

/** Full pipeline. `repoDir` is the workspace root; output lands in images/. */
export async function composeCreative(
  opts: {
    prompt: string;
    aspect: string;
    copy: CreativeCopy;
    format: 'png' | 'jpeg';
    textColor: 'auto' | 'light' | 'dark';
    zone: Zone | 'auto';
    logoAbsPath?: string | null;
    logoPlaceholder?: boolean;
  },
  repoDir: string,
  signal: AbortSignal,
): Promise<CreativeResult> {
  const size = CREATIVE_SIZES[opts.aspect] ?? CREATIVE_SIZES['1:1'];
  let cost = 0;
  const log: string[] = [];
  // Optional uploaded logo → data URL (fail-soft: a bad path just omits the logo).
  let logoDataUrl: string | undefined;
  let logoIsSvg = false;
  if (opts.logoAbsPath) {
    try {
      const lb = fs.readFileSync(opts.logoAbsPath);
      const ext = path.extname(opts.logoAbsPath).toLowerCase();
      logoIsSvg = ext === '.svg';
      const mt = ext === '.png' ? 'image/png' : ext === '.svg' ? 'image/svg+xml' : ext === '.webp' ? 'image/webp' : ext === '.gif' ? 'image/gif' : 'image/jpeg';
      logoDataUrl = `data:${mt};base64,${lb.toString('base64')}`;
    } catch {
      log.push('logo could not be read — omitted');
    }
  }
  try {
    // 1) background (with one regeneration if it came back cluttered or with text).
    // Scrub the copy out of the imagery prompt FIRST so the model can't render garbled
    // text into the background (the #1 failure mode — copy crammed into `prompt`).
    const imagery = scrubImageryPrompt(opts.prompt, opts.copy);
    if (imagery !== opts.prompt.trim()) log.push('scrubbed copy out of the imagery prompt');
    let buf = await genBackground(imagery, size.gen, signal);
    cost += config.minimaxImageCost;
    let plan = await visionPlan(buf, signal);
    cost += config.minimaxVisionCost;
    if (plan.hasText || plan.clutter >= 7) {
      log.push(`regenerated background (${plan.hasText ? 'text in image' : `cluttered ${plan.clutter}/10`})`);
      buf = await genBackground(imagery, size.gen, signal, plan.hasText); // hard no-text on a text leak
      cost += config.minimaxImageCost;
      plan = await visionPlan(buf, signal);
      cost += config.minimaxVisionCost;
    }
    let zone: Zone = opts.zone === 'auto' ? plan.zone : opts.zone;
    // a top-left brand mark is present → keep the text out of the top so they don't collide
    const hasBrand = !!logoDataUrl || !!opts.logoPlaceholder;
    if (hasBrand && zone === 'top') zone = 'bottom';
    let textColor: 'light' | 'dark' = opts.textColor === 'auto' ? plan.textColor : opts.textColor;

    // 2) composite + render
    const dir = path.join(repoDir, 'images');
    fs.mkdirSync(dir, { recursive: true });
    const ext = opts.format === 'jpeg' ? 'jpg' : 'png';
    const name = `creative-${Date.now()}.${ext}`;
    const absOut = path.join(dir, name);
    const bgDataUrl = `data:${sniffMime(buf)};base64,${buf.toString('base64')}`;
    await renderToImage(buildCreativeHtml({ bgDataUrl, zone, textColor, copy: opts.copy, w: size.w, h: size.h, logoDataUrl, logoPlaceholder: opts.logoPlaceholder, logoIsSvg }), size.w, size.h, absOut, opts.format);

    // 3) vision QC; one corrective pass on a contrast/legibility complaint (flip the text colour)
    const finalBuf = fs.readFileSync(absOut);
    const qc = await analyzeImage(
      `data:image/${ext === 'jpg' ? 'jpeg' : 'png'};base64,${finalBuf.toString('base64')}`,
      'Is the headline text crisp and perfectly legible, and is it sitting in clear space (not fighting the imagery)? Answer with one short sentence then a verdict on its own: SHIP or REVISE.',
      signal,
    );
    cost += config.minimaxVisionCost;
    if (qc.ok && /\bREVISE\b/i.test(qc.text ?? '') && /legib|contrast|hard to read|washed|blends|low.?contrast/i.test(qc.text ?? '') && opts.textColor === 'auto') {
      textColor = textColor === 'light' ? 'dark' : 'light';
      log.push(`flipped text to ${textColor} for legibility`);
      await renderToImage(buildCreativeHtml({ bgDataUrl, zone, textColor, copy: opts.copy, w: size.w, h: size.h, logoDataUrl, logoPlaceholder: opts.logoPlaceholder, logoIsSvg }), size.w, size.h, absOut, opts.format);
    }

    const notes = `zone=${zone}, text=${textColor}, ${opts.aspect} ${size.w}×${size.h}${log.length ? ' · ' + log.join('; ') : ''}`;
    return { ok: true, files: [{ path: `images/${name}` }], notes, costUsd: cost };
  } catch (e: any) {
    return { ok: false, files: [], error: String(e?.message ?? e), notes: log.join('; '), costUsd: cost };
  }
}
