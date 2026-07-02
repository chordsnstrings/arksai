import { analyzeImage } from '../engines/minimax';
import { config } from '../config';

/**
 * On-demand UI diagnosis — what a developer does when a user complains: open the app in a real
 * browser, LOOK at it (mobile + desktop), click the thing that "doesn't work", and read the DOM /
 * console / network to find the CAUSE — not just the symptom. The agent is text-only and edits
 * code blind; this gives it the same evidence a person has, for ANY complaint (a dead button, a
 * broken layout, an invisible element, a 404), and lets it verify its own fix by re-inspecting.
 */

export interface InteractionResult {
  label: string;
  effect: 'changed' | 'navigated' | 'no-effect' | 'error';
  detail: string;
}
export interface FocusFact {
  query: string;
  matches: number;
  detail: string;
}
export interface UiInspection {
  ran: boolean;
  url: string;
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
  overflowMobile: string;
  interactions: InteractionResult[];
  focus: FocusFact | null;
  mobileVisual: string;
  desktopVisual: string;
  detail: string;
}

const base: UiInspection = {
  ran: false,
  url: '',
  consoleErrors: [],
  pageErrors: [],
  failedRequests: [],
  overflowMobile: '',
  interactions: [],
  focus: null,
  mobileVisual: '',
  desktopVisual: '',
  detail: '',
};

/** Classify what a click did, from a before/after page fingerprint. Pure + unit-tested.
 *  `theme`/`bg`/`pressed` catch STATE flips with no structural delta (a theme toggle swapping
 *  data-theme/class on <html>, an aria-pressed toggle) — previously reported as dead controls,
 *  which sent the builder chasing false positives for many turns (a real $6 run). */
export function judgeInteraction(
  before: { url: string; nodes: number; visible: number; text: number; expanded: number; dialogs: number; theme?: string; bg?: string; pressed?: number },
  after: { url: string; nodes: number; visible: number; text: number; expanded: number; dialogs: number; theme?: string; bg?: string; pressed?: number },
  errored: boolean,
): { effect: InteractionResult['effect']; detail: string } {
  if (errored) return { effect: 'error', detail: 'clicking it threw a JavaScript error (check the console output below)' };
  if (after.url !== before.url) return { effect: 'navigated', detail: `it navigated to ${after.url}` };
  if ((after.theme ?? '') !== (before.theme ?? '') || (after.bg ?? '') !== (before.bg ?? '')) {
    return { effect: 'changed', detail: 'the page state changed (theme/appearance flipped)' };
  }
  if ((after.pressed ?? 0) !== (before.pressed ?? 0)) {
    return { effect: 'changed', detail: 'a toggle state changed (aria-pressed flipped)' };
  }
  const changed =
    Math.abs(after.visible - before.visible) > 1 ||
    after.dialogs !== before.dialogs ||
    after.expanded !== before.expanded ||
    Math.abs(after.text - before.text) > 24 ||
    Math.abs(after.nodes - before.nodes) > 1;
  if (changed) return { effect: 'changed', detail: 'the UI updated (a panel/menu/content opened or changed)' };
  return {
    effect: 'no-effect',
    detail:
      'nothing observable changed on screen — likely a dead control (no click handler / submit / link). ' +
      'If you have DIRECTLY verified this control works, treat this as a probe blind spot, note it once, and move on.',
  };
}

const VISION_PROMPT =
  'You are a senior front-end engineer looking at a screenshot of a web page a user complained about. ' +
  'Describe concretely what you SEE that looks wrong or broken (layout, spacing, overlap, cut-off or ' +
  'invisible/low-contrast text, a broken/empty section, an obviously off element), and where on the page ' +
  'it is. If it looks fine, say "looks fine". Be specific and brief — bullet points, no preamble.';

// In-browser fingerprint used to detect whether a click changed anything. Stringified into evaluate.
const FINGERPRINT = `() => {
  const d = document, w = window;
  let visible = 0;
  const all = d.querySelectorAll('*');
  for (const e of all) {
    const cs = w.getComputedStyle(e); if (cs.visibility==='hidden'||cs.display==='none'||parseFloat(cs.opacity)<0.05) continue;
    const r = e.getBoundingClientRect(); if (r.width>1 && r.height>1) visible++;
  }
  return {
    url: location.href,
    nodes: all.length,
    visible,
    text: (d.body && d.body.innerText || '').length,
    expanded: d.querySelectorAll('[aria-expanded="true"]').length,
    dialogs: d.querySelectorAll('[role="dialog"],dialog[open],.modal.open,.modal-overlay.active,.menu.open,.nav__menu.open,.open[role="menu"]').length,
    theme: (d.documentElement.getAttribute('data-theme')||'') + '|' + d.documentElement.className + '|' + (d.body ? d.body.className : ''),
    bg: w.getComputedStyle(d.body||d.documentElement).backgroundColor + '|' + w.getComputedStyle(d.body||d.documentElement).color,
    pressed: d.querySelectorAll('[aria-pressed="true"]').length,
  };
}`;

/**
 * Drive a real headless browser to diagnose the running app. Degrades gracefully (ran=false) if
 * Playwright/Chromium is unavailable. `focus` is the user's words about what's wrong (used to target
 * which control to click + which element to inspect).
 */
export async function inspectUi(
  url: string,
  signal: AbortSignal,
  opts?: { focus?: string },
): Promise<UiInspection> {
  if (signal.aborted) return { ...base, detail: 'Inspection skipped: aborted.' };
  let pw: any;
  try {
    pw = await import('playwright');
  } catch {
    return { ...base, detail: 'Inspection skipped: Playwright not installed.' };
  }
  let browser: any;
  try {
    browser = await pw.chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  } catch (e: any) {
    return { ...base, detail: `Inspection skipped: could not launch Chromium (${e?.message ?? e}).` };
  }

  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];
  const focus = (opts?.focus || '').trim();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const origin = new URL(url).origin;
    page.on('console', (m: any) => m.type() === 'error' && consoleErrors.push(String(m.text()).slice(0, 240)));
    page.on('pageerror', (e: any) => pageErrors.push(String(e?.message ?? e).slice(0, 240)));
    page.on('response', (r: any) => {
      try {
        const u = r.url();
        if (r.status() >= 400) failedRequests.push(`${r.status()} ${u.startsWith(origin) ? u.slice(origin.length) || '/' : u}`);
      } catch {}
    });

    await page.goto(url, { waitUntil: 'load', timeout: 15_000 }).catch(() => null);
    await page.waitForTimeout(1000);
    const dedupe = (a: string[]) => [...new Set(a)].slice(0, 8);

    // ---- desktop screenshot + vision ----
    let desktopVisual = '';
    const shotDesk = (await page.screenshot({ type: 'png' }).catch(() => null)) as Buffer | null;
    if (shotDesk && config.minimaxApiKey && !signal.aborted) {
      const r = await analyzeImage(`data:image/png;base64,${shotDesk.toString('base64')}`, VISION_PROMPT, signal).catch(() => null);
      if (r?.ok && r.text) desktopVisual = r.text.trim();
    }

    // ---- interaction probe (the core new capability): click buttons/toggles, report effect ----
    const interactions: InteractionResult[] = [];
    if (!signal.aborted) {
      const danger = /delete|remove|sign\s*out|log\s*out|reset|clear|destroy|cancel|unsubscribe/i;
      // Prefer controls that match the user's complaint; else the visible buttons/toggles.
      const handles = await page
        .$$('button, [role="button"], [data-nav-toggle], summary, input[type="submit"], .btn, .cta, [onclick]')
        .catch(() => []);
      const scored: Array<{ h: any; label: string }> = [];
      for (const h of handles) {
        const info = (await h
          .evaluate((el: any) => {
            const w: any = globalThis as any;
            const cs = w.getComputedStyle(el);
            if (cs.visibility === 'hidden' || cs.display === 'none' || el.offsetParent === null) return null;
            const r = el.getBoundingClientRect();
            if (r.width < 8 || r.height < 8) return null;
            return { label: String(el.innerText || el.value || el.getAttribute('aria-label') || '').trim().slice(0, 48) };
          })
          .catch(() => null)) as { label: string } | null;
        if (!info) continue;
        if (danger.test(info.label)) continue;
        scored.push({ h, label: info.label || '(unlabeled control)' });
      }
      const focusLc = focus.toLowerCase();
      const matchesFocus = (label: string) =>
        focusLc && focusLc.split(/\s+/).some((w) => w.length > 2 && label.toLowerCase().includes(w));
      const ordered = focusLc ? [...scored].sort((a, b) => Number(matchesFocus(b.label)) - Number(matchesFocus(a.label))) : scored;
      const seen = new Set<string>();
      for (const { h, label } of ordered) {
        if (interactions.length >= 6 || signal.aborted) break;
        if (seen.has(label)) continue;
        seen.add(label);
        const before = await page.evaluate(`(${FINGERPRINT})()`).catch(() => null);
        if (!before) continue;
        const errsBefore = consoleErrors.length + pageErrors.length;
        let errored = false;
        try {
          await h.scrollIntoViewIfNeeded({ timeout: 800 });
          await h.click({ timeout: 1500, force: true });
        } catch {
          errored = errored || false; // a click that can't land isn't a JS error
        }
        await page.waitForTimeout(700);
        const after = await page.evaluate(`(${FINGERPRINT})()`).catch(() => before);
        const newErr = consoleErrors.length + pageErrors.length > errsBefore;
        const verdict = judgeInteraction(before, after, newErr);
        interactions.push({ label, effect: verdict.effect, detail: verdict.detail });
        // If it navigated away, go back so the next control is testable.
        if (verdict.effect === 'navigated') {
          await page.goto(url, { waitUntil: 'load', timeout: 15_000 }).catch(() => {});
          await page.waitForTimeout(500);
        }
      }
    }

    // ---- focused element facts (when the user named a thing) ----
    let focusFact: FocusFact | null = null;
    if (focus && !signal.aborted) {
      focusFact = (await page
        .evaluate(
          (q: string) => {
            const w: any = globalThis as any,
              d: any = (globalThis as any).document;
            const STOP = new Set(
              'the a an is are was isnt does doesnt dont do not nothing no it this that my on in to and or of button buttons link links page section element still keeps wont cant when click tap works working broken hidden show showing appears stays still has have looks look not'.split(
                ' ',
              ),
            );
            const words = q
              .toLowerCase()
              .replace(/[^a-z0-9 ]/g, ' ')
              .split(/\s+/)
              .filter((x: string) => x.length > 2 && !STOP.has(x));
            if (!words.length) return { query: q, matches: 0, detail: 'No specific element named in the complaint.' };
            // Only sensible targets — never <html>/<body>; match on the element's OWN label/id/class/direct-text.
            const cands = [
              ...d.querySelectorAll(
                'button, a, [role="button"], input, textarea, select, h1, h2, h3, h4, nav, label, summary, [class*="menu"], [class*="nav"], [class*="btn"], [class*="cta"], [id]',
              ),
            ];
            let best: any = null,
              bestScore = 0,
              count = 0;
            for (const e of cands) {
              const direct = [...e.childNodes].filter((n: any) => n.nodeType === 3).map((n: any) => n.textContent).join(' ');
              const own = `${e.getAttribute('aria-label') || ''} ${e.id || ''} ${e.className || ''} ${direct}`.toLowerCase();
              let s = 0;
              for (const wd of words) if (own.includes(wd)) s++;
              if (s > 0) count++;
              if (s > bestScore) {
                bestScore = s;
                best = e;
              }
            }
            if (!best) return { query: q, matches: 0, detail: 'No element on the page matches that description.' };
            const e = best;
            const cs = w.getComputedStyle(e);
            const r = e.getBoundingClientRect();
            const hidden =
              cs.display === 'none'
                ? 'display:none'
                : cs.visibility === 'hidden'
                ? 'visibility:hidden'
                : parseFloat(cs.opacity) < 0.05
                ? 'opacity:0'
                : r.width < 2 || r.height < 2
                ? 'zero-size'
                : e.offsetParent === null && cs.position !== 'fixed'
                ? 'not rendered (offscreen/detached)'
                : '';
            const facts = `<${String(e.tagName).toLowerCase()} class="${String(e.className).slice(0, 60)}"> — ${
              hidden ? `HIDDEN (${hidden})` : 'visible'
            }; color ${cs.color} on background ${cs.backgroundColor}; font-size ${cs.fontSize}; display ${cs.display}; position ${cs.position}; size ${Math.round(
              r.width,
            )}×${Math.round(r.height)} at (${Math.round(r.left)},${Math.round(r.top)})`;
            return { query: q, matches: count, detail: facts };
          },
          focus,
        )
        .catch(() => null)) as FocusFact | null;
    }

    // ---- mobile pass: screenshot + vision + overflow ----
    let mobileVisual = '';
    let overflowMobile = '';
    if (!signal.aborted) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(500);
      const ov: any = await page
        .evaluate(() => {
          const d: any = (globalThis as any).document,
            w: any = globalThis as any;
          const sw = Math.max(d?.documentElement?.scrollWidth || 0, d?.body?.scrollWidth || 0);
          return { over: sw - (w.innerWidth || 390) };
        })
        .catch(() => ({ over: 0 }));
      if (Math.round(ov.over) > 24) overflowMobile = `Content is ${Math.round(ov.over)}px wider than a 390px phone — it scrolls sideways.`;
      const shotMob = (await page.screenshot({ type: 'png' }).catch(() => null)) as Buffer | null;
      if (shotMob && config.minimaxApiKey) {
        const r = await analyzeImage(`data:image/png;base64,${shotMob.toString('base64')}`, VISION_PROMPT, signal).catch(() => null);
        if (r?.ok && r.text) mobileVisual = r.text.trim();
      }
    }

    const ce = dedupe(consoleErrors),
      pe = dedupe(pageErrors),
      fr = dedupe(failedRequests);
    const lines: string[] = [`Inspected ${url} in a real browser (desktop + 390px mobile).`];
    if (pe.length) lines.push(`✗ Uncaught JS errors:\n  - ${pe.join('\n  - ')}`);
    if (fr.length) lines.push(`✗ Failed requests (broken assets/links/APIs):\n  - ${fr.join('\n  - ')}`);
    if (ce.length) lines.push(`⚠ Console errors:\n  - ${ce.join('\n  - ')}`);
    if (overflowMobile) lines.push(`✗ Mobile overflow — ${overflowMobile}`);
    if (focusFact) lines.push(`🔎 The element you described ("${focusFact.query}", ${focusFact.matches} match${focusFact.matches === 1 ? '' : 'es'}):\n  ${focusFact.detail}`);
    if (interactions.length) {
      const dead = interactions.filter((i) => i.effect === 'no-effect' || i.effect === 'error');
      lines.push(
        `🖱 Clicked ${interactions.length} control(s):\n` +
          interactions.map((i) => `  - "${i.label}" → ${i.effect.toUpperCase()}: ${i.detail}`).join('\n'),
      );
      if (dead.length) lines.push(`   ↳ ${dead.length} control(s) did NOTHING when clicked — start there.`);
    }
    if (desktopVisual) lines.push(`👁 Desktop view:\n  ${desktopVisual.replace(/\n/g, '\n  ')}`);
    if (mobileVisual) lines.push(`👁 Mobile view (390px):\n  ${mobileVisual.replace(/\n/g, '\n  ')}`);
    if (!pe.length && !fr.length && !overflowMobile && !interactions.some((i) => i.effect === 'no-effect' || i.effect === 'error'))
      lines.push('✓ No JS errors, no broken requests, no dead controls, no mobile overflow detected.');

    return {
      ran: true,
      url,
      consoleErrors: ce,
      pageErrors: pe,
      failedRequests: fr,
      overflowMobile,
      interactions,
      focus: focusFact,
      mobileVisual,
      desktopVisual,
      detail: lines.join('\n'),
    };
  } catch (e: any) {
    return { ...base, ran: true, detail: `Inspection inconclusive: ${e?.message ?? e}` };
  } finally {
    try {
      await browser.close();
    } catch {}
  }
}
