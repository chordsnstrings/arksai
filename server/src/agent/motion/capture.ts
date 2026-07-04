import fs from 'node:fs';
import path from 'node:path';
import { frameCount, frameName } from './encode';

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
