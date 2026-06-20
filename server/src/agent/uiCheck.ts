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
          const els = d.querySelectorAll('p,li,span,a,button,h1,h2,h3,h4,h5,h6,small,label,td,th,blockquote,figcaption');
          for (const el of els) {
            let direct = '';
            for (const n of el.childNodes) if (n.nodeType === 3) direct += n.textContent;
            direct = direct.trim();
            if (direct.length < 15) continue; // only leaf elements with real text
            const cs = w.getComputedStyle(el);
            if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) < 0.35) continue;
            const rect = el.getBoundingClientRect();
            if (rect.width < 10 || rect.height < 6) continue;
            const fg = parse(cs.color);
            if (!fg || fg.a < 0.4) continue;
            const bg = bgOf(el);
            if (!bg) continue; // text over an image — vision review handles those
            const cr = ratio(fg, bg);
            const size = parseFloat(cs.fontSize) || 16;
            const large = size >= 24 || (size >= 18.66 && parseInt(cs.fontWeight) >= 600);
            const floor = large ? 3.0 : 4.5;
            if (cr < floor - 0.5)
              bad.push(`"${direct.slice(0, 38)}…" — contrast ${cr.toFixed(1)}:1 (needs ≥${floor}:1, ${size}px)`);
            if (bad.length >= 4) break;
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

    const docFailed = !resp || resp.status() >= 400;
    const ce = dedupe(consoleErrors);
    const pe = dedupe(pageErrors);
    const fr = dedupe(failedRequests);
    const hardFail = docFailed || blank || pe.length > 0 || fr.length > 0 || !!responsiveIssue || !!contrastIssue;

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
    if (contrastIssue) lines.push(`✗ ${contrastIssue}`);
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
