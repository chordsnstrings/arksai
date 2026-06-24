import { analyzeImage } from '../engines/minimax';
import { config } from '../config';

export interface UiCheckResult {
  ran: boolean; // did the browser check actually run?
  ok: boolean; // no hard failures
  hardFail: boolean;
  title: string;
  renderedTextLen: number;
  domNodes: number;
  blank: boolean;
  consoleErrors: string[];
  pageErrors: string[]; // uncaught exceptions
  failedRequests: string[]; // same-origin 4xx/5xx
  /** Values that leaked into the visible UI ([object Object] / undefined / NaN) */
  leakedValues?: string[];
  /** MiniMax-VL visual judgment of the screenshot, when vision is available */
  visualReview?: string;
  /** Design rubric verdict (visual tasks): gating signal for the design loop */
  designVerdict?: 'pass' | 'revise' | 'unknown';
  designDefects?: string[];
  detail: string;
}

/**
 * Detect values that leaked into the rendered UI — "[object Object]", or a standalone
 * "undefined"/"NaN" as visible text — almost always a template/render bug (an unset
 * variable, an unlabelled chart series, a bad computation shown to the user). Pure +
 * unit-tested; returns one actionable line per kind found.
 */
export function detectLeakedValues(visibleText: string): string[] {
  const out: string[] = [];
  const t = String(visibleText || '');
  if (/\[object Object\]/.test(t)) out.push('"[object Object]" is rendered on the page — an object is being shown instead of its value.');
  if (/\bundefined\b/.test(t)) out.push('"undefined" appears as visible text — an unset value leaked into the UI (e.g. an unlabelled chart series or a missing field).');
  if (/\bNaN\b/.test(t)) out.push('"NaN" appears as visible text — a bad numeric computation leaked into the UI.');
  return out;
}

/**
 * Decide whether a mobile hamburger/menu toggle is broken. Pure (unit-testable): given
 * whether a menu toggle exists on the phone layout, how many nav links were visible before
 * tapping it, and how many after — a toggle that reveals NO navigation is the single most
 * common "the menu doesn't work" defect on phones (the desktop interaction pass can't see it,
 * because the hamburger is hidden and the links show inline at desktop width). One actionable
 * line, or '' when there's nothing wrong / nothing to verify.
 */
export function judgeMobileNav(p: { hasToggle: boolean; before: number; after: number }): string {
  if (!p.hasToggle) return ''; // no hamburger pattern → nothing to verify
  if (p.before > 1) return ''; // nav links already visible at mobile → no toggle needed
  if (p.after > p.before) return ''; // tapping it revealed navigation → it works
  return (
    'Broken mobile menu — the phone layout has a menu/hamburger button, but tapping it does not ' +
    'reveal the navigation (no nav links become visible). Wire the toggle to actually open the menu: ' +
    'on click, flip an open state (toggle a class / aria-expanded) and SHOW the nav panel ' +
    '(display / transform / max-height), and make sure the panel’s links are visible and tappable when ' +
    'open. Verify by tapping the ☰ at 390px wide — the links must appear.'
  );
}

const VISION_PROMPT =
  'You are reviewing a screenshot of a web app under automated test. Is the UI rendered ' +
  'correctly and visually coherent? Check for: a blank/empty page, broken or unstyled layout, ' +
  'overlapping or cut-off elements, visible error messages, or missing images. Answer "OK" if it ' +
  'looks fine, otherwise briefly list the visual problems, one per line.';

export const DESIGN_RUBRIC_PROMPT =
  'You are a senior design director reviewing a screenshot of a UI a junior built. Judge it against ' +
  'this rubric: typography-FIRST (a real modular scale, strong but quiet hierarchy, a refined font pairing, ' +
  'readable measure), spacing & alignment (consistent rhythm on a grid, generous whitespace, not cramped or ' +
  'sparsely empty), visual hierarchy, colour (a DISTINCTIVE confident palette — flag the generic default ' +
  'blue/indigo-on-white "AI look" — ONE accent used sparingly), LEGIBILITY (flag ANY text you struggle to ' +
  'read — washed-out muted/secondary text that nearly vanishes into the background, or light text on a busy ' +
  'image/photo with no scrim; every line of copy must be clearly readable), component polish & ' +
  'considered states, and overall "does this look like a top-tier product a senior designer shipped, not a template". ' +
  'Respond EXACTLY in this format and nothing else:\n' +
  'First line: "VERDICT: PASS" if it already looks genuinely well-designed, or "VERDICT: REVISE" if a ' +
  'competent designer would change something.\n' +
  'Then up to 5 lines, each one SHORT, concrete, fixable defect (what + where), prefixed "- ". ' +
  'No preamble, no praise.';

/** Parse the design-director response into a verdict + concrete defects. Pure. */
export function parseDesignVerdict(text: string): { verdict: 'pass' | 'revise' | 'unknown'; defects: string[] } {
  const lines = String(text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const m = String(text || '').match(/verdict\s*:\s*(pass|revise)/i);
  const verdict = m ? (m[1].toLowerCase() as 'pass' | 'revise') : 'unknown';
  const defects = lines
    .filter((l) => /^[-*•]/.test(l))
    .map((l) => l.replace(/^[-*•]\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 5);
  return { verdict, defects };
}

const base: UiCheckResult = {
  ran: false,
  ok: true,
  hardFail: false,
  title: '',
  renderedTextLen: 0,
  domNodes: 0,
  blank: false,
  consoleErrors: [],
  pageErrors: [],
  failedRequests: [],
  detail: '',
};

const dedupe = (a: string[]) => [...new Set(a)].slice(0, 8);

/**
 * Load a running web app in headless Chromium and report whether the UI
 * actually renders — the signals a text-only model can reason about and fix:
 * uncaught JS errors, console errors, failed asset/API requests, and a
 * blank-page check. Degrades gracefully (ran=false) when Playwright/Chromium
 * isn't available, so it never breaks a run.
 */
export async function browserSmokeTest(
  url: string,
  signal: AbortSignal,
  opts?: { visual?: boolean },
): Promise<UiCheckResult> {
  if (signal.aborted) return { ...base, detail: 'Browser check skipped: aborted.' };

  let pw: any;
  try {
    pw = await import('playwright');
  } catch {
    return { ...base, detail: 'Browser check skipped: Playwright not installed.' };
  }

  let browser: any;
  try {
    browser = await pw.chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
  } catch (e: any) {
    return { ...base, detail: `Browser check skipped: could not launch Chromium (${e?.message ?? e}).` };
  }

  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];
  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const origin = new URL(url).origin;
    page.on('console', (m: any) => {
      if (m.type() === 'error') consoleErrors.push(String(m.text()).slice(0, 300));
    });
    page.on('pageerror', (e: any) => pageErrors.push(String(e?.message ?? e).slice(0, 300)));
    page.on('response', (r: any) => {
      try {
        const u = r.url();
        if (u.startsWith(origin) && r.status() >= 400) {
          failedRequests.push(`${r.status()} ${u.slice(origin.length) || '/'}`);
        }
      } catch {}
    });

    const resp = await page.goto(url, { waitUntil: 'load', timeout: 15_000 }).catch(() => null);
    await page.waitForTimeout(1200); // let SPAs hydrate/render
    const info = await page
      .evaluate(() => {
        // Runs in the browser; reference DOM via globalThis so the Node
        // tsconfig (no DOM lib) doesn't try to type-check `document`.
        const d: any = (globalThis as any).document;
        return {
          title: d?.title || '',
          text: (d?.body?.innerText || '').trim(),
          nodes: d?.querySelectorAll('*').length ?? 0,
        };
      })
      .catch(() => ({ title: '', text: '', nodes: 0 }));

    const renderedTextLen = info.text.length;
    const domNodes = info.nodes;
    const blank = renderedTextLen < 1 && domNodes < 15; // nothing meaningful rendered

    // Interaction pass: a real user clicks things. Seed visible inputs, submit
    // the first visible form, and click a few non-destructive primary buttons —
    // then the error listeners below capture any client-side errors that only
    // fire on interaction (the class of bug a static load never reveals).
    let interacted = false;
    if (!blank && !signal.aborted) {
      try {
        interacted = await page.evaluate(() => {
          const d: any = (globalThis as any).document;
          const vis = (el: any) => el && !el.disabled && el.offsetParent !== null;
          let did = false;
          for (const el of Array.from(d.querySelectorAll('input,textarea')) as any[]) {
            const t = (el.type || 'text').toLowerCase();
            if (!vis(el) || ['hidden', 'submit', 'button', 'file', 'checkbox', 'radio', 'range', 'color'].includes(t))
              continue;
            el.value = t === 'email' ? 'verify@arksai.test' : t === 'number' ? '1' : 'ArksAIVerify';
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            did = true;
          }
          const form = (Array.from(d.querySelectorAll('form')) as any[]).find(vis);
          if (form && typeof form.requestSubmit === 'function') {
            try {
              form.requestSubmit();
              did = true;
            } catch {}
          }
          const danger = /delete|remove|sign\s*out|log\s*out|reset|clear|cancel|destroy/i;
          const btns = (Array.from(d.querySelectorAll('button,[role="button"],input[type="submit"]')) as any[])
            .filter((b) => vis(b) && !danger.test(String(b.innerText || b.value || '')))
            .slice(0, 3);
          for (const b of btns) {
            try {
              b.click();
              did = true;
            } catch {}
          }
          return did;
        });
        if (interacted) await page.waitForTimeout(900); // let handlers run / re-render
      } catch {
        /* interaction is best-effort; never let it break the check */
      }
    }

    // Deterministic "a value leaked into the UI" check (post-interaction): a rendered
    // "[object Object]", or a standalone "undefined"/"NaN", is almost always a
    // template/render bug (an unset variable or a bad computation shown to the user).
    // Surfaced as a warning the agent can self-correct — not a hard fail (rare legit text).
    let leaked: string[] = [];
    if (!blank) {
      try {
        const txt = String(await page.evaluate(() => (globalThis as any).document?.body?.innerText || '').catch(() => ''));
        leaked = detectLeakedValues(txt);
      } catch {
        /* best-effort */
      }
    }

    // RESPONSIVE (deterministic, no vision): a real product must not overflow
    // horizontally on a phone. Render at 390px wide and measure content vs viewport;
    // a layout wider than the screen is a hard responsiveness defect. Reset to desktop
    // after so the visual design review (below) still sees the desktop composition.
    let responsiveIssue = '';
    let mobileNavIssue = '';
    if (!blank) {
      try {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForTimeout(450);
        const ov: any = await page
          .evaluate(() => {
            const d: any = (globalThis as any).document;
            const w: any = globalThis as any;
            const sw = Math.max(d?.documentElement?.scrollWidth || 0, d?.body?.scrollWidth || 0);
            return { scrollW: sw, innerW: w.innerWidth || 390 };
          })
          .catch(() => ({ scrollW: 0, innerW: 390 }));
        const over = Math.round((ov.scrollW || 0) - (ov.innerW || 390));
        if (over > 24)
          responsiveIssue = `Not responsive — horizontal overflow at 390px: content is ${over}px wider than the screen (the user has to scroll sideways on a phone). Fix with max-width:100%, flex-wrap, fluid units, image/table containers (overflow-x:auto on the container, not the page), and no fixed pixel widths wider than the viewport.`;

        // MOBILE MENU (deterministic, no vision): the desktop interaction pass can't catch a
        // dead hamburger — at desktop width it's hidden and the nav shows inline. Here, on the
        // phone layout, find a menu/hamburger toggle, count visible nav links, TAP it, and
        // re-count. A toggle that reveals no navigation is a broken mobile menu (a hard defect).
        if (!signal.aborted) {
          const nav: any = await page
            .evaluate(() => {
              const d: any = (globalThis as any).document;
              const w: any = globalThis as any;
              const vh = w.innerHeight || 844;
              // "rendered & laid out" — used for counting nav links (an opened drawer may sit
              // below the fold, so don't require it to be in the viewport vertically).
              const shown = (el: any) => {
                if (!el) return false;
                const cs = w.getComputedStyle(el);
                if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) < 0.1) return false;
                const r = el.getBoundingClientRect();
                return r.width >= 12 && r.height >= 8 && el.offsetParent !== null;
              };
              const countNav = () => {
                const set = new Set<any>();
                d.querySelectorAll(
                  'nav a, [role="navigation"] a, header a, .navbar a, .nav a, .menu a, .navigation a, .nav-links a, [class*="nav"] a, [class*="menu"] a',
                ).forEach((a: any) => {
                  if (shown(a) && (a.innerText || '').trim()) set.add(a);
                });
                return set.size;
              };
              // A control is a menu toggle if it advertises itself as one (aria / class / id),
              // exposes aria-expanded, or its only label is a hamburger glyph / the word "menu".
              const isToggle = (el: any) => {
                const meta = (
                  (el.getAttribute('aria-label') || '') +
                  ' ' +
                  (el.getAttribute('aria-controls') || '') +
                  ' ' +
                  (el.className || '') +
                  ' ' +
                  (el.id || '')
                ).toLowerCase();
                if (el.hasAttribute('aria-expanded')) return true;
                if (/menu|hamburger|navbar-toggl|nav-toggle|nav-open|navtoggle|drawer|burger/.test(meta)) return true;
                const txt = (el.innerText || el.textContent || '').trim();
                if (/^(☰|≡|menu)$/i.test(txt)) return true;
                return false;
              };
              // On-screen at mobile (a real, tappable button up top).
              const visTop = (el: any) => {
                if (!shown(el)) return false;
                const r = el.getBoundingClientRect();
                return r.bottom > 0 && r.top < vh;
              };
              const cands = Array.from(
                d.querySelectorAll('button, a, [role="button"], summary, label, div, span, i, svg'),
              ) as any[];
              let toggle: any = null;
              for (const el of cands) {
                if (!visTop(el)) continue;
                if (el.tagName === 'A') {
                  const h = el.getAttribute('href');
                  if (h && h !== '#' && !h.startsWith('#') && !isToggle(el)) continue; // a real nav link, not a toggle
                }
                if (isToggle(el)) {
                  toggle = el;
                  break;
                }
              }
              if (toggle) {
                const clickable = toggle.closest('button,a,[role="button"],summary,label') || toggle;
                clickable.setAttribute('data-arks-navtoggle', '1');
              }
              return { hasToggle: !!toggle, before: countNav() };
            })
            .catch(() => ({ hasToggle: false, before: 0 }));

          let after = nav.before;
          if (nav.hasToggle && nav.before <= 1) {
            await page
              .evaluate(() => {
                const el: any = (globalThis as any).document.querySelector('[data-arks-navtoggle]');
                if (el) el.click();
              })
              .catch(() => {});
            await page.waitForTimeout(550); // let the menu open / animate
            after = await page
              .evaluate(() => {
                const d: any = (globalThis as any).document;
                const w: any = globalThis as any;
                const shown = (el: any) => {
                  if (!el) return false;
                  const cs = w.getComputedStyle(el);
                  if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) < 0.1) return false;
                  const r = el.getBoundingClientRect();
                  return r.width >= 12 && r.height >= 8 && el.offsetParent !== null;
                };
                const set = new Set<any>();
                d.querySelectorAll(
                  'nav a, [role="navigation"] a, header a, .navbar a, .nav a, .menu a, .navigation a, .nav-links a, [class*="nav"] a, [class*="menu"] a',
                ).forEach((a: any) => {
                  if (shown(a) && (a.innerText || '').trim()) set.add(a);
                });
                return set.size;
              })
              .catch(() => nav.before);
          }
          mobileNavIssue = judgeMobileNav({ hasToggle: nav.hasToggle, before: nav.before, after });
        }

        await page.setViewportSize({ width: 1280, height: 800 });
        await page.waitForTimeout(250);
      } catch {
        /* best-effort */
      }
    }

    // LEGIBLE TEXT (deterministic, no vision): every block of text must contrast with its
    // background. Muted/secondary text is fine for hierarchy, but washed-out near-background
    // text (a recurring defect) is illegible — measure WCAG contrast on real text vs its
    // solid background and flag anything clearly under the legibility floor.
    let contrastIssues: string[] = [];
    if (!blank) {
      try {
        contrastIssues = (await page.evaluate(() => {
          const d: any = (globalThis as any).document;
          const w: any = globalThis as any;
          const parse = (s: string) => {
            const m = String(s).match(/rgba?\(([^)]+)\)/);
            if (!m) return null;
            const p = m[1].split(',').map((x: string) => parseFloat(x));
            return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] };
          };
          const lum = (c: any) => {
            const f = (v: number) => {
              v /= 255;
              return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
            };
            return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
          };
          const ratio = (a: any, b: any) => {
            const l1 = lum(a),
              l2 = lum(b);
            return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
          };
          const bgOf = (el: any): any => {
            let e = el;
            while (e) {
              const cs = w.getComputedStyle(e);
              if (cs.backgroundImage && cs.backgroundImage !== 'none') return null; // over an image — can't measure
              const bg = parse(cs.backgroundColor);
              if (bg && bg.a > 0.5) return bg;
              e = e.parentElement;
            }
            return { r: 255, g: 255, b: 255, a: 1 };
          };
          const bad: string[] = [];
          const seen: Record<string, boolean> = {};
          // Include <div> — copy is often placed directly in a div (heroes, cards, bands),
          // and that text was the gap the legibility gate kept missing.
          const els = d.querySelectorAll(
            'p,li,span,a,button,h1,h2,h3,h4,h5,h6,small,label,td,th,blockquote,figcaption,div,strong,em,dt,dd,summary',
          );
          for (const el of els) {
            let direct = '';
            for (const n of el.childNodes) if (n.nodeType === 3) direct += n.textContent;
            direct = direct.trim();
            if (direct.length < 12) continue; // only leaf elements with real direct text
            const cs = w.getComputedStyle(el);
            if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) < 0.4) continue;
            const rect = el.getBoundingClientRect();
            if (rect.width < 10 || rect.height < 6) continue;
            // Only judge text actually in the viewport's first ~3 screens (visible, real copy).
            if (rect.bottom < 0 || rect.top > 3000) continue;
            const fg = parse(cs.color);
            if (!fg || fg.a < 0.4) continue;
            const bg = bgOf(el);
            if (!bg) continue; // text over an image — vision review handles those
            const cr = ratio(fg, bg);
            const size = parseFloat(cs.fontSize) || 16;
            const large = size >= 24 || (size >= 18.66 && parseInt(cs.fontWeight) >= 600);
            const floor = large ? 3.0 : 4.5;
            // Tighter slack (0.25) so borderline-illegible copy is caught, not waved through;
            // 0.5 used to let washed-out text and low-contrast CTAs pass.
            if (cr < floor - 0.25) {
              const key = direct.slice(0, 38);
              if (seen[key]) continue;
              seen[key] = true;
              bad.push(`"${key}…" — contrast ${cr.toFixed(1)}:1 (needs ≥${floor}:1, ${size}px)`);
            }
            if (bad.length >= 6) break;
          }
          return bad;
        })) as string[];
      } catch {
        /* best-effort */
      }
    }
    const contrastIssue = contrastIssues.length
      ? `Illegible text — these blocks don't contrast with their background (muted text taken too far). Use a readable ink for ALL text (muted ≈ 55–65% black, never a near-background tint); every text must meet WCAG AA (4.5:1 body, 3:1 large). Offenders:\n  - ${contrastIssues.join('\n  - ')}`
      : '';

    // INTERACTION-STATE LEGIBILITY (deterministic): a button/link whose background
    // changes on :hover but whose text colour does NOT (or vice-versa) goes
    // unreadable in the hover state — a real, reported defect the static pass can't
    // see. Hover each control (real mouse → :hover + CSS vars resolve), measure WCAG
    // contrast at REST and on HOVER, and flag only a genuine hover REGRESSION (hover
    // ends below AA *and* is meaningfully worse than rest) — so we catch the
    // vanishing label without re-flagging resting low-contrast (the static pass's job).
    let hoverIssues: string[] = [];
    if (!blank && !signal.aborted) {
      // Kill transitions/animations so each hovered state is measured at its FINAL
      // value, not mid-fade (a mid-transition read gives false numbers).
      await page.addStyleTag({ content: '*{transition-duration:0s !important;animation-duration:0s !important}' }).catch(() => {});
      // Measures the element's text-vs-background WCAG contrast in its current state.
      const measure = (el: any) => {
        const w: any = globalThis as any;
        const parse = (s: string) => {
          const m = String(s).match(/rgba?\(([^)]+)\)/);
          if (!m) return null;
          const p = m[1].split(',').map((x: string) => parseFloat(x));
          return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] };
        };
        const lum = (c: any) => {
          const f = (v: number) => {
            v /= 255;
            return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
          };
          return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
        };
        const ratio = (a: any, b: any) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
        const bgOf = (node: any): any => {
          let e = node;
          while (e) {
            const cs = w.getComputedStyle(e);
            if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;
            const bg = parse(cs.backgroundColor);
            if (bg && bg.a > 0.5) return bg;
            e = e.parentElement;
          }
          return { r: 255, g: 255, b: 255, a: 1 };
        };
        const cs = w.getComputedStyle(el);
        const fg = parse(cs.color);
        if (!fg || fg.a < 0.4) return null;
        const bg = bgOf(el);
        if (!bg) return null;
        const size = parseFloat(cs.fontSize) || 16;
        const large = size >= 24 || (size >= 18.66 && parseInt(cs.fontWeight) >= 600);
        return { cr: Math.round(ratio(fg, bg) * 10) / 10, floor: large ? 3.0 : 4.5 };
      };
      try {
        const handles = await page.$$(
          'a,button,[role="button"],input[type="submit"],input[type="button"],summary,.btn,.cta,.button',
        );
        let checked = 0;
        const seenTxt: Record<string, boolean> = {};
        for (const h of handles) {
          if (checked >= 24 || hoverIssues.length >= 5 || signal.aborted) break;
          // No vertical cap — scrollIntoViewIfNeeded brings a deep control (e.g. a
          // subscribe button low on the page) into view to hover it. Filter by
          // visibility + a sane size; skip logos/wordmarks (exempt from text contrast);
          // dedupe identical labels (footer link lists).
          const info = (await h
            .evaluate((el: any) => {
              const w: any = globalThis as any;
              const cs = w.getComputedStyle(el);
              if (cs.visibility === 'hidden' || cs.display === 'none' || el.offsetParent === null) return null;
              const r = el.getBoundingClientRect();
              if (r.width < 16 || r.height < 10) return null;
              const cls = String(el.className || '');
              if (/\b(brand|logo|wordmark)\b/i.test(cls) || el.querySelector('img,svg[role="img"]')) return null;
              const txt = String(el.innerText || el.value || '').trim();
              if (txt.length < 2 || txt.length > 60) return null; // a real control label, not a whole card
              return { txt: txt.slice(0, 38) };
            })
            .catch(() => null)) as { txt: string } | null;
          if (!info) continue;
          if (seenTxt[info.txt]) continue;
          seenTxt[info.txt] = true;
          checked++;
          const rest = (await h.evaluate(measure).catch(() => null)) as { cr: number; floor: number } | null;
          try {
            await h.scrollIntoViewIfNeeded({ timeout: 600 });
            await h.hover({ timeout: 700, force: true });
          } catch {
            continue;
          }
          await page.waitForTimeout(60);
          const hov = (await h.evaluate(measure).catch(() => null)) as { cr: number; floor: number } | null;
          try {
            await page.mouse.move(2, 2); // un-hover before the next control
          } catch {}
          // Flag a true hover regression: the hovered label ends below AA AND lost
          // meaningful contrast versus its resting state (so the hover is what broke it).
          if (hov && rest && hov.cr < hov.floor - 0.25 && hov.cr < rest.cr - 0.5)
            hoverIssues.push(
              `"${info.txt}…" — contrast drops to ${hov.cr.toFixed(1)}:1 on hover (was ${rest.cr.toFixed(1)}:1 at rest; needs ≥${hov.floor}:1)`,
            );
        }
      } catch {
        /* best-effort */
      }
    }
    const hoverIssue = hoverIssues.length
      ? `Illegible on hover — these controls lose contrast in their hover state (the background changes but the text colour doesn't, or vice-versa), so the label gets hard to read when a user points at it. Set BOTH the hover background AND the hover text colour together and keep WCAG AA (4.5:1 body, 3:1 large) in EVERY state — default, hover, focus, active. Offenders:\n  - ${hoverIssues.join('\n  - ')}`
      : '';

    const docFailed = !resp || resp.status() >= 400;
    const ce = dedupe(consoleErrors);
    const pe = dedupe(pageErrors);
    const fr = dedupe(failedRequests);
    const hardFail =
      docFailed ||
      blank ||
      pe.length > 0 ||
      fr.length > 0 ||
      !!responsiveIssue ||
      !!mobileNavIssue ||
      !!contrastIssue ||
      !!hoverIssue;

    // True visual judgment: if vision is configured, actually LOOK at the page
    // (the text-only model can't). For visual tasks run the DESIGN RUBRIC (gating
    // signal); otherwise the lightweight "is it broken" check.
    let visualReview: string | undefined;
    let designVerdict: 'pass' | 'revise' | 'unknown' | undefined;
    let designDefects: string[] | undefined;
    let visionUnavailable = '';
    if (config.minimaxApiKey && !signal.aborted) {
      try {
        // Reveal any scroll-in [data-reveal] content so the visual review sees the
        // full page, not blank below-the-fold sections it never scrolled to.
        await page
          .evaluate(() => {
            const d: any = (globalThis as any).document;
            d?.querySelectorAll('[data-reveal]').forEach((e: any) => { e.classList.add('in'); e.classList.remove('reveal-hidden'); });
          })
          .catch(() => {});
        const shot = (await page.screenshot({ type: 'png', fullPage: !!opts?.visual })) as Buffer;
        const dataUrl = `data:image/png;base64,${shot.toString('base64')}`;
        const prompt = opts?.visual ? DESIGN_RUBRIC_PROMPT : VISION_PROMPT;
        const r = await analyzeImage(dataUrl, prompt, signal);
        if (r.ok && r.text) {
          visualReview = r.text.trim();
          if (opts?.visual) {
            const v = parseDesignVerdict(r.text);
            designVerdict = v.verdict;
            designDefects = v.defects;
          }
        } else {
          visionUnavailable = r.error || 'no result';
        }
      } catch (e: any) {
        // Vision is additive — never let it break verification — but don't fail SILENTLY:
        // record why so the design gate's absence is visible, not invisible.
        visionUnavailable = String(e?.message ?? e);
      }
    }

    const lines: string[] = [
      `Loaded in headless Chromium — title="${info.title}", ${domNodes} DOM nodes, ${renderedTextLen} chars visible.`,
    ];
    if (docFailed) lines.push(`✗ Document failed to load (status ${resp ? resp.status() : 'no response'}).`);
    if (blank) lines.push('✗ The page rendered blank (no visible content).');
    if (pe.length) lines.push(`✗ Uncaught JS errors:\n  - ${pe.join('\n  - ')}`);
    if (fr.length) lines.push(`✗ Failed requests (same-origin):\n  - ${fr.join('\n  - ')}`);
    if (responsiveIssue) lines.push(`✗ ${responsiveIssue}`);
    if (mobileNavIssue) lines.push(`✗ ${mobileNavIssue}`);
    if (contrastIssue) lines.push(`✗ ${contrastIssue}`);
    if (hoverIssue) lines.push(`✗ ${hoverIssue}`);
    if (ce.length) lines.push(`⚠ Console errors:\n  - ${ce.join('\n  - ')}`);
    if (leaked.length) lines.push(`⚠ Value leaked into the UI:\n  - ${leaked.join('\n  - ')}`);
    if (interacted) lines.push('• Interaction pass ran (seeded inputs, submitted a form, clicked primary actions).');
    if (!hardFail && !ce.length) lines.push('✓ UI rendered cleanly — no errors, no failed requests.');
    if (designVerdict === 'revise' && designDefects?.length) {
      lines.push(`👁 Design review — REVISE:\n  - ${designDefects.join('\n  - ')}`);
    } else if (designVerdict === 'pass') {
      lines.push('👁 Design review — PASS (looks well designed).');
    } else if (visualReview) {
      lines.push(`👁 Visual review: ${visualReview}`);
    }
    if (visionUnavailable) {
      lines.push(`⚠ Visual design review unavailable (MiniMax vision: ${visionUnavailable.slice(0, 100)}) — shipped without the visual gate.`);
    }

    return {
      ran: true,
      ok: !hardFail,
      hardFail,
      title: info.title,
      renderedTextLen,
      domNodes,
      blank,
      consoleErrors: ce,
      pageErrors: pe,
      failedRequests: fr,
      leakedValues: leaked,
      visualReview,
      designVerdict,
      designDefects,
      detail: lines.join('\n'),
    };
  } catch (e: any) {
    // An infra hiccup in the check itself shouldn't fail the user's build.
    return { ...base, ran: true, detail: `Browser check inconclusive: ${e?.message ?? e}` };
  } finally {
    try {
      await browser.close();
    } catch {}
  }
}
