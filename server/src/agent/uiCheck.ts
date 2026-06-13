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
  detail: string;
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
export async function browserSmokeTest(url: string, signal: AbortSignal): Promise<UiCheckResult> {
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
    const docFailed = !resp || resp.status() >= 400;
    const ce = dedupe(consoleErrors);
    const pe = dedupe(pageErrors);
    const fr = dedupe(failedRequests);
    const hardFail = docFailed || blank || pe.length > 0 || fr.length > 0;

    const lines: string[] = [
      `Loaded in headless Chromium — title="${info.title}", ${domNodes} DOM nodes, ${renderedTextLen} chars visible.`,
    ];
    if (docFailed) lines.push(`✗ Document failed to load (status ${resp ? resp.status() : 'no response'}).`);
    if (blank) lines.push('✗ The page rendered blank (no visible content).');
    if (pe.length) lines.push(`✗ Uncaught JS errors:\n  - ${pe.join('\n  - ')}`);
    if (fr.length) lines.push(`✗ Failed requests (same-origin):\n  - ${fr.join('\n  - ')}`);
    if (ce.length) lines.push(`⚠ Console errors:\n  - ${ce.join('\n  - ')}`);
    if (!hardFail && !ce.length) lines.push('✓ UI rendered cleanly — no errors, no failed requests.');

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
