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
  /** MiniMax-VL visual judgment of the screenshot, when vision is available */
  visualReview?: string;
  /** Design rubric verdict (visual tasks): gating signal for the design loop */
  designVerdict?: 'pass' | 'revise' | 'unknown';
  designDefects?: string[];
  detail: string;
}

const VISION_PROMPT =
  'You are reviewing a screenshot of a web app under automated test. Is the UI rendered ' +
  'correctly and visually coherent? Check for: a blank/empty page, broken or unstyled layout, ' +
  'overlapping or cut-off elements, visible error messages, or missing images. Answer "OK" if it ' +
  'looks fine, otherwise briefly list the visual problems, one per line.';

const DESIGN_RUBRIC_PROMPT =
  'You are a senior design director reviewing a screenshot of a UI a junior built. Judge it against ' +
  'this rubric: typography (clear scale & hierarchy, readable), spacing & alignment (consistent rhythm, ' +
  'on a grid, not cramped or sparsely empty), visual hierarchy, colour (restrained, strong contrast, ' +
  'accent used sparingly), component polish & states, and overall "does this look professionally designed". ' +
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

    const docFailed = !resp || resp.status() >= 400;
    const ce = dedupe(consoleErrors);
    const pe = dedupe(pageErrors);
    const fr = dedupe(failedRequests);
    const hardFail = docFailed || blank || pe.length > 0 || fr.length > 0;

    // True visual judgment: if vision is configured, actually LOOK at the page
    // (the text-only model can't). For visual tasks run the DESIGN RUBRIC (gating
    // signal); otherwise the lightweight "is it broken" check.
    let visualReview: string | undefined;
    let designVerdict: 'pass' | 'revise' | 'unknown' | undefined;
    let designDefects: string[] | undefined;
    if (config.minimaxApiKey && !signal.aborted) {
      try {
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
        }
      } catch {
        /* vision is additive here — never let it break verification */
      }
    }

    const lines: string[] = [
      `Loaded in headless Chromium — title="${info.title}", ${domNodes} DOM nodes, ${renderedTextLen} chars visible.`,
    ];
    if (docFailed) lines.push(`✗ Document failed to load (status ${resp ? resp.status() : 'no response'}).`);
    if (blank) lines.push('✗ The page rendered blank (no visible content).');
    if (pe.length) lines.push(`✗ Uncaught JS errors:\n  - ${pe.join('\n  - ')}`);
    if (fr.length) lines.push(`✗ Failed requests (same-origin):\n  - ${fr.join('\n  - ')}`);
    if (ce.length) lines.push(`⚠ Console errors:\n  - ${ce.join('\n  - ')}`);
    if (interacted) lines.push('• Interaction pass ran (seeded inputs, submitted a form, clicked primary actions).');
    if (!hardFail && !ce.length) lines.push('✓ UI rendered cleanly — no errors, no failed requests.');
    if (designVerdict === 'revise' && designDefects?.length) {
      lines.push(`👁 Design review — REVISE:\n  - ${designDefects.join('\n  - ')}`);
    } else if (designVerdict === 'pass') {
      lines.push('👁 Design review — PASS (looks well designed).');
    } else if (visualReview) {
      lines.push(`👁 Visual review: ${visualReview}`);
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
