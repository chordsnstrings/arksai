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
export const CREATIVE_SIZES: Record<string, { w: number; h: number; gen: string }> = {
  '1:1': { w: 1080, h: 1080, gen: '1:1' },
  '4:5': { w: 1080, h: 1350, gen: '9:16' },
  '9:16': { w: 1080, h: 1920, gen: '9:16' },
  '16:9': { w: 1280, h: 720, gen: '16:9' },
  '1.91:1': { w: 1200, h: 628, gen: '16:9' },
};

export type Zone = 'top' | 'bottom' | 'left' | 'right';
export interface CreativeCopy {
  kicker?: string;
  headline: string;
  sub?: string;
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
  fontsCss?: string;
}): string {
  const { bgDataUrl, zone, textColor, copy, w, h, logoDataUrl } = opts;
  const light = textColor !== 'dark';
  const ink = light ? '#ffffff' : '#1b1813';
  const subInk = light ? 'rgba(255,255,255,0.86)' : 'rgba(27,24,19,0.72)';
  const scrimRGB = light ? '16,14,12' : '245,241,233';
  const dir = { bottom: 'to top', top: 'to bottom', left: 'to right', right: 'to left' }[zone];
  const scrim = `linear-gradient(${dir}, rgba(${scrimRGB},${light ? 0.68 : 0.88}) 0%, rgba(${scrimRGB},${light ? 0.3 : 0.52}) 40%, rgba(${scrimRGB},0) 70%)`;
  const pos: Record<Zone, string> = {
    bottom: 'left:0;right:0;bottom:0;padding:0 8% 8.5%;justify-content:flex-end;align-items:flex-start;text-align:left',
    top: 'left:0;right:0;top:0;padding:8.5% 8% 0;justify-content:flex-start;align-items:flex-start;text-align:left',
    left: 'left:0;top:0;bottom:0;width:64%;padding:0 0 0 8%;justify-content:center;align-items:flex-start;text-align:left',
    right: 'right:0;top:0;bottom:0;width:64%;padding:0 8% 0 0;justify-content:center;align-items:flex-end;text-align:right',
  };
  const wide = w >= h;
  const hSize = Math.round(w * (wide ? 0.07 : 0.082));
  const shadow = light ? 'text-shadow:0 1px 26px rgba(0,0,0,0.32)' : 'none';
  return `<!doctype html><html><head><meta charset="utf8"><style>${opts.fontsCss ?? fontsCss()}
*{margin:0;box-sizing:border-box}html,body{width:100%;height:100%}
.card{position:relative;width:${w}px;height:${h}px;overflow:hidden;background:#0d0c0b;font-family:'Inter',system-ui,sans-serif}
.bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.scrim{position:absolute;inset:0;background:${scrim}}
.c{position:absolute;display:flex;flex-direction:column;gap:0;${pos[zone]}}
.kick{font-family:'Space Grotesk',sans-serif;font-weight:500;font-size:${Math.round(w * 0.0185)}px;letter-spacing:0.2em;text-transform:uppercase;color:${light ? '#fff' : copy.accent};opacity:${light ? 0.92 : 1};margin-bottom:${Math.round(h * 0.022)}px}
.h{font-family:'Source Serif 4',Georgia,serif;font-weight:600;font-size:${hSize}px;line-height:0.99;letter-spacing:-0.02em;color:${ink};${shadow}}
.sub{font-family:'Inter',sans-serif;font-weight:400;font-size:${Math.round(w * 0.0235)}px;line-height:1.4;color:${subInk};margin-top:${Math.round(h * 0.03)}px;max-width:19em}
.cta{align-self:${zone === 'right' ? 'flex-end' : 'flex-start'};margin-top:${Math.round(h * 0.042)}px;background:${esc(copy.accent)};color:#fff;font-family:'Inter',sans-serif;font-weight:600;font-size:${Math.round(w * 0.021)}px;padding:${Math.round(h * 0.019)}px ${Math.round(w * 0.032)}px;border-radius:999px}
.logo{height:${Math.round(h * 0.062)}px;max-width:46%;object-fit:contain;object-position:${zone === 'right' ? 'right' : 'left'} center;margin-bottom:${Math.round(h * 0.032)}px}
</style></head><body><div class="card"><img class="bg" src="${bgDataUrl}"><div class="scrim"></div><div class="c">${
    logoDataUrl ? `<img class="logo" src="${logoDataUrl}">` : ''
  }${copy.kicker ? `<div class="kick">${esc(copy.kicker)}</div>` : ''}<div class="h">${escMultiline(copy.headline)}</div>${
    copy.sub ? `<div class="sub">${esc(copy.sub)}</div>` : ''
  }${copy.cta ? `<span class="cta">${esc(copy.cta)}</span>` : ''}</div></div></body></html>`;
}

const NEG = 'absolutely no text, no words, no letters, no typography, no captions, no labels, no logos, no watermark, no UI, no charts';

async function genBackground(prompt: string, genRatio: string, signal: AbortSignal): Promise<Buffer> {
  const res = await fetch(`${config.minimaxBaseUrl.replace(/\/$/, '')}/image_generation`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.minimaxApiKey}`, 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({ model: config.minimaxImageModel, prompt: `${prompt}. Leave generous clean empty negative space for a text overlay. Editorial, premium, high-end advertising. ${NEG}`, aspect_ratio: genRatio, n: 1, response_format: 'url' }),
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
  },
  repoDir: string,
  signal: AbortSignal,
): Promise<CreativeResult> {
  const size = CREATIVE_SIZES[opts.aspect] ?? CREATIVE_SIZES['1:1'];
  let cost = 0;
  const log: string[] = [];
  // Optional uploaded logo → data URL (fail-soft: a bad path just omits the logo).
  let logoDataUrl: string | undefined;
  if (opts.logoAbsPath) {
    try {
      const lb = fs.readFileSync(opts.logoAbsPath);
      const ext = path.extname(opts.logoAbsPath).toLowerCase();
      const mt = ext === '.png' ? 'image/png' : ext === '.svg' ? 'image/svg+xml' : ext === '.webp' ? 'image/webp' : ext === '.gif' ? 'image/gif' : 'image/jpeg';
      logoDataUrl = `data:${mt};base64,${lb.toString('base64')}`;
    } catch {
      log.push('logo could not be read — omitted');
    }
  }
  try {
    // 1) background (with one regeneration if it came back cluttered or with text)
    let buf = await genBackground(opts.prompt, size.gen, signal);
    cost += config.minimaxImageCost;
    let plan = await visionPlan(buf, signal);
    cost += config.minimaxVisionCost;
    if (plan.hasText || plan.clutter >= 7) {
      log.push(`regenerated background (${plan.hasText ? 'text in image' : `cluttered ${plan.clutter}/10`})`);
      buf = await genBackground(opts.prompt, size.gen, signal);
      cost += config.minimaxImageCost;
      plan = await visionPlan(buf, signal);
      cost += config.minimaxVisionCost;
    }
    const zone: Zone = opts.zone === 'auto' ? plan.zone : opts.zone;
    let textColor: 'light' | 'dark' = opts.textColor === 'auto' ? plan.textColor : opts.textColor;

    // 2) composite + render
    const dir = path.join(repoDir, 'images');
    fs.mkdirSync(dir, { recursive: true });
    const ext = opts.format === 'jpeg' ? 'jpg' : 'png';
    const name = `creative-${Date.now()}.${ext}`;
    const absOut = path.join(dir, name);
    const bgDataUrl = `data:${sniffMime(buf)};base64,${buf.toString('base64')}`;
    await renderToImage(buildCreativeHtml({ bgDataUrl, zone, textColor, copy: opts.copy, w: size.w, h: size.h, logoDataUrl }), size.w, size.h, absOut, opts.format);

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
      await renderToImage(buildCreativeHtml({ bgDataUrl, zone, textColor, copy: opts.copy, w: size.w, h: size.h, logoDataUrl }), size.w, size.h, absOut, opts.format);
    }

    const notes = `zone=${zone}, text=${textColor}, ${opts.aspect} ${size.w}×${size.h}${log.length ? ' · ' + log.join('; ') : ''}`;
    return { ok: true, files: [{ path: `images/${name}` }], notes, costUsd: cost };
  } catch (e: any) {
    return { ok: false, files: [], error: String(e?.message ?? e), notes: log.join('; '), costUsd: cost };
  }
}
