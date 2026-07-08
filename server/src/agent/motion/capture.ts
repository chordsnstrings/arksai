import fs from 'node:fs';
import path from 'node:path';
import { frameCount, frameName, overlayFrameName } from './encode';

/**
 * Deterministic frame capture — the Remotion move, on our stack.
 *
 * A scene page (motion-kit) exposes window.__seek(ms): all animations are PAUSED and time
 * is set explicitly, so a frame at t renders identically regardless of machine speed. We
 * load the page from file:// (relative fonts/assets/charts resolve), inject the scene
 * duration, then step-and-screenshot.
 *
 * Chromium gotchas copied from creative.ts/uiCheck.ts: --no-sandbox --disable-dev-shm-usage
 * on the droplet; STRING-form page.evaluate ONLY (esbuild keepNames injects __name helpers
 * into serialized closures that don't exist in-browser); dynamic import('playwright') and
 * degrade with a plain-language error when absent.
 */

export interface CaptureResult {
  frames: number;
  msPerFrame: number;
}

export async function captureScene(
  htmlAbs: string,
  opts: { width: number; height: number; fps: number; durationMs: number; framesDir: string },
  signal: AbortSignal,
): Promise<CaptureResult> {
  let pw: typeof import('playwright');
  try {
    pw = await import('playwright');
  } catch {
    throw new Error('Playwright/Chromium is not installed in this environment — frame capture unavailable.');
  }
  fs.mkdirSync(opts.framesDir, { recursive: true });
  const total = frameCount(opts.durationMs, opts.fps);
  const browser = await pw.chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const started = Date.now();
  try {
    const ctx = await browser.newContext({
      viewport: { width: opts.width, height: opts.height },
      deviceScaleFactor: 1, // the viewport IS the output resolution
    });
    const page = await ctx.newPage();
    await page.goto(`file://${htmlAbs}`, { waitUntil: 'load', timeout: 30_000 });
    await page.evaluate('document.fonts && document.fonts.ready').catch(() => {});
    // motion.js must be present — a scene without the runtime cannot be seeked.
    const ready = await page.evaluate('!!(window.__seek && window.__motionReady)').catch(() => false);
    if (!ready) {
      throw new Error(
        `${path.basename(htmlAbs)} did not load the motion-kit runtime (motion-kit/motion.js) — link it with a relative <script> tag.`,
      );
    }
    await page.evaluate(`__setSceneMs(${Math.round(opts.durationMs)})`);
    for (let i = 0; i < total; i++) {
      if (signal.aborted) throw new Error('capture aborted');
      const t = Math.round((i * 1000) / opts.fps);
      await page.evaluate(`__seek(${t})`);
      await page.screenshot({ path: path.join(opts.framesDir, frameName(i)), type: 'jpeg', quality: 92 });
    }
    await ctx.close();
  } finally {
    await browser.close().catch(() => {});
  }
  return { frames: total, msPerFrame: (Date.now() - started) / total };
}

/**
 * Capture a TRANSPARENT overlay scene as a PNG frame sequence (o00000.png …) for compositing
 * over a generative clip. Identical seek-driven determinism to captureScene, but the page has a
 * transparent body and we screenshot with `omitBackground: true` so only the crisp text/callouts
 * carry an alpha channel — everything else is transparent and the clip shows through underneath.
 * PNG (not JPEG) because alpha is the whole point.
 */
export async function captureOverlay(
  htmlAbs: string,
  opts: { width: number; height: number; fps: number; durationMs: number; framesDir: string },
  signal: AbortSignal,
): Promise<CaptureResult> {
  let pw: typeof import('playwright');
  try {
    pw = await import('playwright');
  } catch {
    throw new Error('Playwright/Chromium is not installed in this environment — overlay capture unavailable.');
  }
  fs.mkdirSync(opts.framesDir, { recursive: true });
  const total = frameCount(opts.durationMs, opts.fps);
  const browser = await pw.chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const started = Date.now();
  try {
    const ctx = await browser.newContext({
      viewport: { width: opts.width, height: opts.height },
      deviceScaleFactor: 1,
    });
    const page = await ctx.newPage();
    await page.goto(`file://${htmlAbs}`, { waitUntil: 'load', timeout: 30_000 });
    await page.evaluate('document.fonts && document.fonts.ready').catch(() => {});
    const ready = await page.evaluate('!!(window.__seek && window.__motionReady)').catch(() => false);
    if (!ready) {
      throw new Error(
        `${path.basename(htmlAbs)} did not load the motion-kit runtime (motion-kit/motion.js) — link it with a relative <script> tag.`,
      );
    }
    await page.evaluate(`__setSceneMs(${Math.round(opts.durationMs)})`);
    for (let i = 0; i < total; i++) {
      if (signal.aborted) throw new Error('overlay capture aborted');
      const t = Math.round((i * 1000) / opts.fps);
      await page.evaluate(`__seek(${t})`);
      await page.screenshot({ path: path.join(opts.framesDir, overlayFrameName(i)), type: 'png', omitBackground: true });
    }
    await ctx.close();
  } finally {
    await browser.close().catch(() => {});
  }
  return { frames: total, msPerFrame: (Date.now() - started) / total };
}

/** Capture ONE frame at a given time (QC spot frames) into outAbs (jpeg). */
export async function captureSpotFrame(
  htmlAbs: string,
  opts: { width: number; height: number; durationMs: number; atMs: number; outAbs: string },
  signal: AbortSignal,
): Promise<void> {
  let pw: typeof import('playwright');
  try {
    pw = await import('playwright');
  } catch {
    throw new Error('Playwright/Chromium is not installed in this environment.');
  }
  const browser = await pw.chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const ctx = await browser.newContext({ viewport: { width: opts.width, height: opts.height }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(`file://${htmlAbs}`, { waitUntil: 'load', timeout: 30_000 });
    await page.evaluate('document.fonts && document.fonts.ready').catch(() => {});
    const ready = await page.evaluate('!!(window.__seek && window.__motionReady)').catch(() => false);
    if (!ready) throw new Error(`${path.basename(htmlAbs)} did not load motion-kit/motion.js`);
    await page.evaluate(`__setSceneMs(${Math.round(opts.durationMs)})`);
    await page.evaluate(`__seek(${Math.round(opts.atMs)})`);
    if (signal.aborted) throw new Error('capture aborted');
    fs.mkdirSync(path.dirname(opts.outAbs), { recursive: true });
    await page.screenshot({ path: opts.outAbs, type: 'jpeg', quality: 92 });
    await ctx.close();
  } finally {
    await browser.close().catch(() => {});
  }
}

/**
 * DETERMINISTIC GEOMETRY AUDIT (operator audit 2026-07-05: labels/callouts clipping off
 * the 9:16 frame edge in every style, and a literal "HOOK" slot leaking on screen — the
 * vision QC reads content, not geometry). Loads the scene, seeks to ~60%, and measures
 * every visible text element's bounding box in the DOM: anything crossing the frame edge
 * is a HARD defect naming the element — unless it (or an ancestor) is a sanctioned bleed
 * (echo/texture type, hero props, grounds). Also screens on-screen text for structural
 * meta-words that should never render.
 */
const GEOMETRY_AUDIT_JS = `(() => {
  const W = window.innerWidth, H = window.innerHeight;
  const BLEED = ['mg-echo','mg-prop-hero','mg-numeral','mg-hills','mg-hill','mg-plate','mg-wash','mg-grain','mg-vignette','mg-particles','mg-dot','mg-plate-scrim','mg-kenburns','mg-cutout','mg-duotone','mg-tape'];
  const sanctioned = (el) => { for (let n = el; n && n.classList; n = n.parentElement) { if (BLEED.some((c) => n.classList.contains(c))) return true; } return false; };
  const offenders = [];
  const seen = new Set();
  for (const el of document.querySelectorAll('body *')) {
    if (offenders.length >= 6) break;
    const hasOwnText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!hasOwnText) continue;
    const st = getComputedStyle(el);
    if (st.visibility === 'hidden' || st.display === 'none' || Number(st.opacity) < 0.05) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const text = (el.textContent || '').trim().slice(0, 40);
    if (/^(hook|scene ?\\d*|placeholder|todo|tbd|lorem)$/i.test(text) && !seen.has('meta:' + text)) {
      seen.add('meta:' + text);
      offenders.push('structural meta-word rendered on screen: "' + text + '" — slot text must be real content');
      continue;
    }
    if (/\\*[^*]{1,40}\\*/.test(text) && !seen.has('emph:' + text)) {
      seen.add('emph:' + text);
      offenders.push('literal *asterisk* emphasis markup rendered on screen: "' + text + '" — the markup only works in SCAFFOLD slots; in bespoke HTML use <span class="mg-emph"> or remove the asterisks');
      continue;
    }
    if (sanctioned(el)) continue;
    const over = r.left < -2 || r.top < -2 || r.right > W + 2 || r.bottom > H + 2;
    if (over && !seen.has(text)) {
      seen.add(text);
      const cls = (el.className && String(el.className).split(' ')[0]) || el.tagName.toLowerCase();
      offenders.push('"' + text + '" (' + cls + ') clips off the frame edge (box ' + Math.round(r.left) + ',' + Math.round(r.top) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' vs ' + W + 'x' + H + ')');
    }
  }
  return offenders;
})()`;

/** Measure layout geometry at ~60% of the scene; returns human-readable offenders. */
export async function auditSceneGeometry(
  htmlAbs: string,
  opts: { width: number; height: number; durationMs: number },
  signal: AbortSignal,
): Promise<string[]> {
  let pw: typeof import('playwright');
  try {
    pw = await import('playwright');
  } catch {
    return []; // no Chromium → the capture itself will fail loudly; don't double-report
  }
  const browser = await pw.chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const ctx = await browser.newContext({ viewport: { width: opts.width, height: opts.height }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(`file://${htmlAbs}`, { waitUntil: 'load', timeout: 30_000 });
    await page.evaluate('document.fonts && document.fonts.ready').catch(() => {});
    await page.evaluate(`__setSceneMs(${Math.round(opts.durationMs)})`).catch(() => {});
    await page.evaluate(`__seek(${Math.round(opts.durationMs * 0.6)})`).catch(() => {});
    if (signal.aborted) throw new Error('audit aborted');
    const offenders = (await page.evaluate(GEOMETRY_AUDIT_JS)) as string[];
    await ctx.close();
    return Array.isArray(offenders) ? offenders : [];
  } catch {
    return []; // geometry audit is a guard, not a point of failure itself
  } finally {
    await browser.close().catch(() => {});
  }
}

/** Deterministic pre-flight on a scene file: self-contained + runtime present. Pure. */
export function auditSceneHtml(html: string): string[] {
  const problems: string[] = [];
  if (!/motion-kit\/motion\.js/.test(html)) problems.push('missing <script src="motion-kit/motion.js">');
  if (!/motion-kit\/motion\.css/.test(html)) problems.push('missing <link> to motion-kit/motion.css');
  const external = html.match(/(?:src|href)\s*=\s*["']https?:\/\/[^"']+/gi);
  if (external?.length) problems.push(`external http(s) references (must be self-contained): ${external.slice(0, 3).join(', ')}`);
  if (/requestAnimationFrame|setInterval\s*\(|Date\.now\s*\(/.test(html))
    problems.push('wall-clock JS detected (requestAnimationFrame/setInterval/Date.now) — motion must be seek-driven');
  return problems;
}
