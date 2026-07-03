import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execBash } from '../lib/exec';

/**
 * Product-ad engine (operator directive 2026-07-03): a product video must (1) FOCUS on the
 * product — identify it in ANY photo and lift it off its background — and (2) know what KIND
 * of product it is, with expert ad templates per category (skincare shows application on
 * skin, food shows the pour/steam, jewellery the macro sparkle…).
 *
 * Three parts:
 *  - PRODUCT_CATEGORIES: the researched per-category ad-template catalog (pure data).
 *  - productAdBrief(): compiles category + template + backdrop into the timed, director-grade
 *    shot plan Seedance responds to best (pure, tested).
 *  - isolateProduct() + composeProductFrame(): background removal (rembg, graceful degrade)
 *    and a staged first-frame composited in headless Chromium — so the video OPENS on the
 *    product cleanly staged, whatever mess was behind it in the source photo.
 */

import {
  PRODUCT_CATEGORIES,
  UNIVERSAL_TEMPLATES,
  HERO,
  findCategory,
  findTemplate,
  templatesFor,
  BACKDROP_CSS,
  type AdBeat,
  type AdTemplate,
  type ProductCategory,
} from '../../../shared/productAds';

// Re-exported so existing server imports keep working; the data itself lives in shared/
// (the client Video studio renders the same catalog).
export { PRODUCT_CATEGORIES, UNIVERSAL_TEMPLATES, findCategory, findTemplate, templatesFor, BACKDROP_CSS };
export type { AdBeat, AdTemplate, ProductCategory };

/** Compile the timed, director-grade product-ad shot plan (pure). */
export function productAdBrief(opts: {
  productName: string;
  productDesc?: string;
  categoryId?: string;
  templateKey?: string;
  backdropPhrase?: string;
  tagline?: string;
  durationS?: number;
}): string {
  const cat = opts.categoryId ? findCategory(opts.categoryId) : null;
  // A template key resolves against the category's bespoke styles first, then the universal
  // set — so "unboxing" works for any product, category chosen or not.
  const tpl = (opts.templateKey && findTemplate(cat?.id ?? '', opts.templateKey)) || cat?.templates[0] || null;
  const beats = tpl?.beats ?? [HERO, { motion: 'gentle push in', view: 'label and details crisp' }, { motion: 'settle to a static hero pose', view: 'the product centered, poster-clean' }];
  const dur = Math.max(4, Math.min(15, opts.durationS ?? 12));
  const per = dur / beats.length;
  const lines = beats.map((b, i) => {
    const from = Math.round(i * per);
    const to = i === beats.length - 1 ? dur : Math.round((i + 1) * per);
    return `${from}–${to}s: ${b.motion} — ${b.view}.`;
  });
  return [
    `A premium ${cat ? cat.label.toLowerCase() : 'product'} commercial for "${opts.productName}"${opts.productDesc ? ` (${opts.productDesc})` : ''}.`,
    `The video OPENS on the exact product photo (first frame) — the product must stay exactly as photographed: same shape, label, colours; never redesign it.`,
    opts.backdropPhrase ? `Set: ${opts.backdropPhrase}.` : '',
    `Shot plan (one move per beat):`,
    ...lines,
    `Lighting: ${tpl?.light ?? 'clean soft studio light with a gentle rim'}.`,
    `Audio: ${tpl?.audio ?? 'minimal premium score, subtle product foley'}${opts.tagline ? `; a warm voiceover says: "${opts.tagline}"` : ''}.`,
    `Style: premium commercial grade, shallow depth of field, no on-screen text or captions.`,
    `Avoid: ${tpl?.negatives ?? 'no text, no warped shapes'}; no flicker; the product never morphs.`,
  ].filter(Boolean).join('\n');
}

/* ── Background removal + staged first frame ─────────────────────────────── */

/** CSS scenes for the composited first frame — one per studio backdrop id. The video model
 *  re-lights the scene from the prompt, so these only need to stage the product cleanly. */

/**
 * Warm rembg's import path at boot (fire-and-forget). The FIRST `from rembg import …` after
 * a deploy JIT-compiles its numba dependencies (~45s measured on the droplet); subsequent
 * imports are ~2.5s. Warming once at startup means no user's first product video ever pays
 * that tax. Silent no-op when python/rembg is absent.
 */
export function warmBackgroundRemoval(): void {
  execBash(`python3 -P -c "from rembg import remove, new_session" 2>/dev/null || true`, {
    cwd: os.tmpdir(), timeoutMs: 180_000,
  }).catch(() => { /* absent or failed → isolateProduct degrades gracefully anyway */ });
}

/**
 * Lift the product off its background with rembg (U2Net). Graceful degrade: if python/rembg
 * is unavailable or segmentation fails/empties, report ok:false — the caller uses the
 * original photo (today's behaviour) and says so honestly.
 */
export async function isolateProduct(absIn: string, absOut: string, signal?: AbortSignal): Promise<{ ok: boolean; reason?: string }> {
  try {
    if (/\.png$/i.test(absIn)) {
      // A PNG may already carry transparency — probe cheaply: rembg is still more reliable
      // than guessing, so only skip when rembg is absent.
    }
    const script = `
import os, sys, glob
try:
    from rembg import remove, new_session
except Exception as e:
    print("NO_REMBG:" + str(e)); sys.exit(0)
from PIL import Image, ImageOps
# Model choice: REMBG_MODEL env (default u2net). new_session downloads weights on first
# use; if that fails (restricted egress) fall back to ANY model already cached on disk
# so an offline server with pre-seeded weights still works.
model = os.environ.get('REMBG_MODEL', 'u2net')
try:
    session = new_session(model)
except Exception as e:
    cached = sorted(glob.glob(os.path.join(os.environ.get('U2NET_HOME', os.path.expanduser('~/.u2net')), '*.onnx')))
    names = [os.path.splitext(os.path.basename(p))[0] for p in cached]
    session = None
    for n in names:
        if n == model: continue
        try:
            session = new_session(n); break
        except Exception: pass
    if session is None:
        print("NO_MODEL:" + str(e)[:200]); sys.exit(0)
im = Image.open(sys.argv[1])
im = ImageOps.exif_transpose(im)  # honor camera orientation
if max(im.size) < 300:
    print("TOO_SMALL"); sys.exit(0)
out = remove(im, session=session)
# Empty-mask guard: if almost nothing survived, segmentation failed.
alpha = out.getchannel('A')
coverage = sum(1 for p in alpha.getdata() if p > 40) / (out.size[0] * out.size[1])
if coverage < 0.02:
    print("EMPTY_MASK"); sys.exit(0)
bbox = out.getbbox()
if bbox: out = out.crop(bbox)
out.save(sys.argv[2])
print("OK")
`;
    const tmp = path.join(path.dirname(absOut), `.rembg-${Date.now()}.py`);
    fs.writeFileSync(tmp, script);
    try {
      const r = await execBash(`python3 -P ${JSON.stringify(tmp)} ${JSON.stringify(absIn)} ${JSON.stringify(absOut)}`, {
        cwd: path.dirname(absOut), timeoutMs: 120_000, signal,
      });
      const out = r.output.trim();
      if (out.includes('OK') && fs.existsSync(absOut)) return { ok: true };
      if (out.includes('NO_REMBG')) return { ok: false, reason: 'background removal is not installed on this server (pip3 install rembg onnxruntime pillow)' };
      if (out.includes('NO_MODEL')) return { ok: false, reason: 'the background-removal model could not be downloaded (server egress) and no cached model was found' };
      if (out.includes('TOO_SMALL')) return { ok: false, reason: 'the photo is too small (under 300px) — a larger photo cuts out much better' };
      if (out.includes('EMPTY_MASK')) return { ok: false, reason: 'the product could not be separated from this photo (low contrast with the background) — a photo with clearer separation works better' };
      return { ok: false, reason: out.slice(-160) || 'segmentation failed' };
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  } catch (e: any) {
    return { ok: false, reason: String(e?.message ?? e).slice(0, 160) };
  }
}

/** The staged-first-frame HTML: backdrop scene + centered product with shadow/reflection (pure). */
export function buildProductFrameHtml(opts: { imgDataUrl: string; backdropId: string; w: number; h: number; isolated: boolean }): string {
  const scene = BACKDROP_CSS[opts.backdropId] || BACKDROP_CSS['studio-white'];
  const dark = /dark-luxury|neon-night|tech|festive|stone-slate|smoke-mist|industrial/.test(opts.backdropId);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;width:${opts.w}px;height:${opts.h}px;overflow:hidden}
  .scene{position:relative;width:100%;height:100%;${scene}}
  .floor{position:absolute;left:0;right:0;bottom:0;height:34%;background:linear-gradient(180deg,transparent,rgba(0,0,0,${dark ? 0.5 : 0.14}))}
  .p{position:absolute;left:50%;top:52%;transform:translate(-50%,-50%);max-width:62%;max-height:66%;
     filter:drop-shadow(0 ${Math.round(opts.h * 0.03)}px ${Math.round(opts.h * 0.05)}px rgba(0,0,0,${dark ? 0.65 : 0.35}));}
  .r{position:absolute;left:50%;top:85%;transform:translate(-50%,0) scaleY(-1);max-width:62%;max-height:30%;
     opacity:${opts.isolated ? 0.16 : 0};-webkit-mask-image:linear-gradient(180deg,transparent 30%,rgba(0,0,0,.8));}
  </style></head><body><div class="scene">
    <div class="floor"></div>
    <img class="r" src="${opts.imgDataUrl}">
    <img class="p" src="${opts.imgDataUrl}">
  </div></body></html>`;
}

/**
 * The staged LINE-UP first frame: several products (a range) shoulder to shoulder on one
 * backdrop — hero variant center at full size, siblings flanking slightly smaller (pure).
 * Powers the family-lineup ad style for brands with a product range.
 */
export function buildLineupFrameHtml(opts: { items: { imgDataUrl: string; isolated: boolean }[]; backdropId: string; w: number; h: number }): string {
  const scene = BACKDROP_CSS[opts.backdropId] || BACKDROP_CSS['studio-white'];
  const dark = /dark-luxury|neon-night|tech|festive|stone-slate|smoke-mist|industrial/.test(opts.backdropId);
  const n = opts.items.length;
  // Hero (first item) center; the rest alternate right/left so the row stays balanced.
  const left: number[] = [];
  const right: number[] = [];
  for (let i = 1; i < n; i++) (i % 2 ? right : left).push(i);
  const row = [...left.reverse(), 0, ...right];
  // Explicit pixel slot widths — percentage max-widths inside shrink-to-fit flex slots
  // resolve circularly and render the products tiny (found by eyeballing a real raster).
  const gap = Math.round(opts.w * 0.012);
  const slotW = Math.floor((opts.w * 0.88 - gap * (n - 1)) / n);
  const imgs = row
    .map((idx) => {
      const it = opts.items[idx];
      const hero = idx === 0;
      return `
    <div class="slot" style="z-index:${hero ? 3 : 2}">
      <img class="r" style="opacity:${it.isolated ? 0.14 : 0}" src="${it.imgDataUrl}">
      <img class="p" style="transform:scale(${hero ? 1 : 0.82});" src="${it.imgDataUrl}">
    </div>`;
    })
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;width:${opts.w}px;height:${opts.h}px;overflow:hidden}
  .scene{position:relative;width:100%;height:100%;${scene}}
  .floor{position:absolute;left:0;right:0;bottom:0;height:34%;background:linear-gradient(180deg,transparent,rgba(0,0,0,${dark ? 0.5 : 0.14}))}
  .row{position:absolute;left:50%;top:52%;transform:translate(-50%,-50%);display:flex;align-items:flex-end;justify-content:center;gap:${gap}px}
  .slot{position:relative;width:${slotW}px;display:flex;flex-direction:column;align-items:center}
  .p{display:block;max-width:100%;max-height:${Math.round(opts.h * 0.56)}px;transform-origin:bottom center;
     filter:drop-shadow(0 ${Math.round(opts.h * 0.025)}px ${Math.round(opts.h * 0.04)}px rgba(0,0,0,${dark ? 0.6 : 0.32}));}
  .r{position:absolute;top:100%;left:50%;transform:translate(-50%,0) scaleY(-1);max-height:${Math.round(opts.h * 0.18)}px;max-width:88%;
     -webkit-mask-image:linear-gradient(180deg,transparent 30%,rgba(0,0,0,.8));}
  </style></head><body><div class="scene">
    <div class="floor"></div>
    <div class="row">${imgs}</div>
  </div></body></html>`;
}

const FRAME_SIZES: Record<string, { w: number; h: number }> = { '16:9': { w: 1280, h: 720 }, '9:16': { w: 720, h: 1280 }, '1:1': { w: 1024, h: 1024 } };

function imageDataUrl(p: string): string {
  const mime = /\.png$/i.test(p) ? 'image/png' : /\.webp$/i.test(p) ? 'image/webp' : 'image/jpeg';
  return `data:${mime};base64,${fs.readFileSync(p).toString('base64')}`;
}

export async function rasterizeFrame(html: string, w: number, h: number, outPath: string): Promise<void> {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    await page.setContent(html, { waitUntil: 'load' });
    await page.waitForTimeout(120);
    await page.screenshot({ path: outPath, type: 'jpeg', quality: 92 });
  } finally {
    await browser.close();
  }
}

/** Rasterize the staged frame with headless Chromium (same pattern as creative.ts). */
export async function composeProductFrame(opts: {
  productImagePath: string; // cutout PNG (preferred) or the original photo
  backdropId: string;
  outPath: string;
  aspect?: '16:9' | '9:16' | '1:1';
  isolated: boolean;
}): Promise<void> {
  const { w, h } = FRAME_SIZES[opts.aspect ?? '16:9'];
  const html = buildProductFrameHtml({ imgDataUrl: imageDataUrl(opts.productImagePath), backdropId: opts.backdropId, w, h, isolated: opts.isolated });
  await rasterizeFrame(html, w, h, opts.outPath);
}

/** Rasterize a multi-product LINE-UP frame (the family-lineup ad style). */
export async function composeProductLineup(opts: {
  items: { productImagePath: string; isolated: boolean }[];
  backdropId: string;
  outPath: string;
  aspect?: '16:9' | '9:16' | '1:1';
}): Promise<void> {
  const { w, h } = FRAME_SIZES[opts.aspect ?? '16:9'];
  const html = buildLineupFrameHtml({
    items: opts.items.map((it) => ({ imgDataUrl: imageDataUrl(it.productImagePath), isolated: it.isolated })),
    backdropId: opts.backdropId,
    w,
    h,
  });
  await rasterizeFrame(html, w, h, opts.outPath);
}
