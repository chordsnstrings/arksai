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
/** Tier a design-review defect: BLOCKING (functional/accessibility — broken, unreadable,
 *  overflowing, dead, crashing) forces a fix round; everything else is COSMETIC taste and is
 *  delivered as a note, never a loop. Operator doctrine 2026-07-02: a build must never get
 *  stuck fixing things that don't need fixing — when uncertain, a defect is cosmetic. Pure. */
export function isBlockingDefect(line: string): boolean {
  const t = String(line || '');
  return /overflow|scrolls? side|horizontal scroll|unreadable|illegible|invisible|contrast|WCAG|AA\b|broken|dead|does(n't| not) (work|open|respond)|no effect|blank|empty page|crash|exception|uncaught|error\b|cut[- ]?off|clipped|overlap|collid|truncat|failed request|404|500|missing (nav|menu|button|content)|cannot|can't (click|open|read|see)/i.test(t);
}

/** A 4xx from an auth endpoint during the interaction pass is the app REJECTING our seeded
 *  garbage credentials — correct behavior, never a defect. 5xx (a crash) still counts. Pure. */
export function isExpectedAuthRejection(path: string, status: number): boolean {
  if (status < 400 || status >= 500) return false;
  return /log[-_]?in|sign[-_]?in|sign[-_]?up|register|auth|session|password|token|otp|verify/i.test(path);
}

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
  'You are a senior design director reviewing a screenshot of a UI a junior built. ' +
  'FIRST read the TREATMENT the subject calls for (from the locked direction when given, else infer from the ' +
  'content): a UTILITARIAN page (a memo, plan, admin/internal tool, quick widget) is judged on composition, ' +
  'craft and legibility — do NOT demand a hero, a persona or a signature moment there; over-designing a ' +
  'utilitarian page is a defect exactly like under-designing a landing page. For EDITORIAL subjects (a landing ' +
  'page, portfolio, brand site, anything the user keeps or shares) the bar is NOT "clean and competent" — ' +
  'competent-but-generic is a FAIL, because it reads as the default AI look. ' +
  'Judge it against this rubric:\n' +
  '• DISTINCTIVENESS (for editorial subjects, judge this FIRST and hardest): does it look ART-DIRECTED for its ' +
  'subject, or like a ' +
  'template any AI would emit? REVISE if you see an AI-DEFAULT look — (a) generic minimal-muted: a grey/blue ' +
  'desaturated accent on white with a big centered hero + a glowing card and Inter everywhere; (b) cream + a ' +
  'serif + a terracotta/clay accent; (c) black + an acid/neon-green accent; (d) broadsheet-hairlines pastiche; ' +
  '(e) a purple→blue gradient hero on white; (f) everything centered, every element the same rounded-lg radius, ' +
  'or an accent bar/rail on rounded cards; (g) emoji as section markers. ' +
  'Reward a deliberate concept carried through type + colour + structure, a SIGNATURE element that means ' +
  'something (a data/board/spec/stamp keyed to real content, not a decorative gradient box), and a clear ' +
  'point of view. Reward a page that COMMITS to a recognizable modern DIRECTION/archetype and builds its ' +
  'signature — e.g. a product DASHBOARD (a focal metric + stat tiles/charts), an APPLE-BENTO grid, a GLASS ' +
  'stack, a COMMAND-BAR app, a CALENDAR-HEATMAP, an EDITORIAL-LUXURY or BRUTALIST or CYBER/SYNTH look; a build ' +
  'with NO discernible direction — a generic centered hero over a plain list/cards — is templated → REVISE.\n' +
  '• TYPOGRAPHY: a real modular scale, strong quiet hierarchy, and type EMBEDDED (never a plain system fallback). ' +
  'A deliberate, LEGIBLE display face is good — a calm serif (Source Serif/Lora/Newsreader), a clean sans ' +
  '(Inter/DM Sans/Manrope), OR a bolder characterful face (a grotesque like Space Grotesk/Bricolage/Unbounded, or ' +
  'a high-contrast serif like Bodoni) WHEN it is an intentional, on-concept choice that stays even and readable, ' +
  'paired with a mono/data face for labels/figures. FLAG a display face ONLY when it actually hurts legibility or ' +
  'looks unintentional/off-brand — not merely for being bold; and flag a heading rendering in a plain system ' +
  'fallback (no embedded font).\n' +
  '• COLOUR: a distinctive, confident, concept-grounded palette with ONE accent used sparingly — flag generic ' +
  'blue/indigo-on-white.\n' +
  '• SPACING & ALIGNMENT: consistent rhythm on a grid, generous whitespace, not cramped or sparsely empty.\n' +
  '• LEGIBILITY: flag ANY text you struggle to read — washed-out muted/secondary text that nearly vanishes, or ' +
  'light text on a busy image with no scrim; every line of copy must be clearly readable.\n' +
  '• POLISH & STATES: considered components, hover/focus, real states.\n' +
  '• COPY: words are design material — flag system-jargon labels the user wouldn\'t say (a person manages ' +
  '"notifications", not "webhook config"), vague or apologetic error text, and empty states that don\'t say ' +
  'what to do next.\n' +
  'Respond EXACTLY in this format and nothing else:\n' +
  'First line: "VERDICT: PASS" if it meets the bar for ITS treatment — utilitarian: genuinely well-composed, ' +
  'legible and craftful (distinctiveness NOT required); editorial: genuinely art-directed and distinctive ' +
  '(not just tidy). Otherwise "VERDICT: REVISE" — for editorial that includes reading generic/templated OR a ' +
  'competent designer would change something.\n' +
  'Then up to 5 lines, each a SHORT, concrete, fixable defect (what + where), prefixed "- ". The FIRST defect ' +
  'should name the biggest distinctiveness gap (e.g. "generic centered hero — needs the concept\'s signature ' +
  'board"). No preamble, no praise.';

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
/** The scaffold-declared verification manifest (.arksai/verify.json) — when present the gate
 *  verifies DETERMINISTICALLY: the walker signs in with the declared demo account instead of
 *  parsing the page, and every declared route is asserted (works for API-only apps too). */
export interface VerifyManifest {
  demo?: { email: string; password: string };
  routes?: Array<{ method: string; path: string; auth?: boolean; expect: number }>;
  sse?: string;
}

/** Assert the manifest's routes against the running app. Returns defect lines (empty = pass). */
export async function checkManifestRoutes(origin: string, manifest: VerifyManifest, signal: AbortSignal): Promise<string[]> {
  const issues: string[] = [];
  let token = '';
  if (manifest.demo) {
    try {
      const r = await fetch(`${origin}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(manifest.demo),
        signal,
      });
      const d: any = await r.json().catch(() => ({}));
      if (r.ok && d?.token) token = d.token;
      else issues.push(`verify.json: the declared demo login failed (${r.status} ${String(d?.error ?? '')}) — the seeded demo user and the manifest are out of sync.`);
    } catch (e: any) {
      issues.push(`verify.json: demo login request failed — ${e?.message ?? e}`);
    }
  }
  for (const route of manifest.routes || []) {
    try {
      const r = await fetch(origin + route.path, {
        method: route.method || 'GET',
        headers: {
          ...(route.auth && token ? { Authorization: `Bearer ${token}` } : {}),
          ...(route.method === 'POST' ? { 'content-type': 'application/json' } : {}),
        },
        ...(route.method === 'POST' ? { body: '{}' } : {}),
        signal,
      });
      if (r.status !== route.expect) {
        issues.push(`verify.json: ${route.method} ${route.path} returned ${r.status}, the manifest expects ${route.expect} — a declared route is broken (or the manifest is stale; update .arksai/verify.json alongside the route).`);
      }
    } catch (e: any) {
      issues.push(`verify.json: ${route.method} ${route.path} failed — ${e?.message ?? e}`);
    }
  }
  if (manifest.sse) {
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 5000);
      const r = await fetch(origin + manifest.sse, { signal: ac.signal });
      const reader = (r.body as any)?.getReader?.();
      const first = reader ? await reader.read() : null;
      clearTimeout(timer);
      try { reader?.cancel(); } catch {}
      if (!r.ok || !first || first.done) issues.push(`verify.json: the SSE endpoint ${manifest.sse} did not stream an event within 5s.`);
    } catch (e: any) {
      if (!/abort/i.test(String(e?.message))) issues.push(`verify.json: SSE check failed — ${e?.message ?? e}`);
    }
  }
  return issues.slice(0, 6);
}

/**
 * Authenticated page walk (deterministic, ONE bounded pass — never a loop). The first-load
 * checks only ever see the page that loads first: an auth wall hid every inner page from the
 * gate (real live incident — a published app's Members page truncated names to initials and a
 * sidebar chip overlapped every heading on mobile; the gate saw only the login screen and
 * passed). If the page shows a login form AND demo credentials in its text, sign in and visit
 * each nav destination once, at phone + desktop widths, running three layout detectors:
 * clipped-content (visible boxes cut by the viewport edge outside any scroll container),
 * heading-overlap (another element covering >25% of an h1–h3), and truncation clusters
 * (3+ ellipsized fields hiding >30% of their text — names reduced to initials).
 * Best-effort: any failure returns what was found so far; the page ends back at 1280px.
 */
export async function walkPagesAuthenticated(page: any, declaredCreds?: { email: string; password: string }): Promise<string[]> {
  const issues: string[] = [];
  const dbg = (...a: unknown[]) => { if (process.env.ARKS_WALK_DEBUG) console.error('[walk]', ...a); };
  // Fresh entry state: the earlier interaction pass clicked buttons/submitted garbage into the
  // SPA (it may sit on a signup view where the demo credentials aren't shown) — reload first.
  await page.reload({ waitUntil: 'load', timeout: 12_000 }).catch(() => null);
  await page.waitForTimeout(1000);
  // 1 · Demo login: the manifest's declared creds win; else only when the app advertises
  // credentials on the page (we never guess real ones).
  const creds = declaredCreds || await page
    .evaluate(() => {
      const d: any = (globalThis as any).document;
      const text = d?.body?.innerText || '';
      if (!/demo/i.test(text)) return null;
      const m = text.match(/([\w.+-]+@[\w.-]+\.\w{2,})\s*[\/|·:]\s*(\S{4,32})/);
      const hasPassword = !!d.querySelector('input[type="password"]');
      return m && hasPassword ? { email: m[1], password: m[2] } : null;
    })
    .catch(() => null);
  dbg('creds:', JSON.stringify(creds));
  if (!creds) return issues;

  // String-form evaluate: tsx/esbuild keepNames injects __name() helpers into serialized
  // callbacks with inner named functions, which don't exist in the browser — a string body
  // bypasses serialization entirely (same trick as creative.ts's document.fonts evaluate).
  const loggedIn = await page
    .evaluate(
      '((c) => {' +
        'var setNative = function(el, value) {' +
        '  try {' +
        '    var proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;' +
        '    var d = Object.getOwnPropertyDescriptor(proto, "value");' +
        '    if (d && d.set) d.set.call(el, value); else el.value = value;' +
        '  } catch (e) { el.value = value; }' +
        '  el.dispatchEvent(new Event("input", { bubbles: true }));' +
        '  el.dispatchEvent(new Event("change", { bubbles: true }));' +
        '};' +
        'var email = document.querySelector(\'input[type="email"], input[name*="mail" i], input[autocomplete="username"]\');' +
        'var pass = document.querySelector(\'input[type="password"]\');' +
        'if (!email || !pass) return false;' +
        'setNative(email, c.email); setNative(pass, c.password);' +
        'var form = pass.closest("form");' +
        'if (form && form.requestSubmit) form.requestSubmit();' +
        'else { var b = form && form.querySelector(\'button[type="submit"],button\'); if (b) b.click(); }' +
        'return true;' +
      '})(' + JSON.stringify(creds) + ')',
    )
    .catch((e: any) => {
      dbg('login threw:', e?.message ?? e);
      return false;
    });
  dbg('loggedIn:', loggedIn);
  if (!loggedIn) return issues;
  await page.waitForTimeout(1800);
  const authed = await page
    .evaluate(() => !(globalThis as any).document.querySelector('input[type="password"]'))
    .catch(() => false);
  dbg('authed:', authed);
  if (!authed) return issues;

  // 2 · Nav destinations (≤5, by visible label; re-queried per click — SPAs re-render).
  const labels: string[] = await page
    .evaluate(() => {
      const d: any = (globalThis as any).document;
      const out: string[] = [];
      d.querySelectorAll('nav a, nav button, aside a, aside button, [class*="nav-item"], [role="navigation"] a').forEach((el: any) => {
        const t = (el.innerText || el.getAttribute('aria-label') || '').trim();
        if (t && t.length <= 24 && el.offsetParent !== null && !/sign\s*out|log\s*out|delete/i.test(t) && !out.includes(t)) out.push(t);
      });
      return out.slice(0, 5);
    })
    .catch(() => []);

  dbg('labels:', JSON.stringify(labels));
  // 3 · Detectors, run on the CURRENT page at the CURRENT viewport.
  const detect = (where: string) =>
    page.evaluate(
      '((tag) => {' +
        'var found = [];' +
        'var vw = window.innerWidth || 0;' +
        'var vis = function(el) {' +
        '  if (!el || el.offsetParent === null) return false;' +
        '  var cs = getComputedStyle(el);' +
        '  return cs.visibility !== "hidden" && parseFloat(cs.opacity || "1") > 0.1;' +
        '};' +
        'var inScroller = function(el) {' +
        '  var e = el.parentElement;' +
        '  while (e) { var cs = getComputedStyle(e); if (/(auto|scroll)/.test(cs.overflowX)) return true; e = e.parentElement; }' +
        '  return false;' +
        '};' +
        'var all = Array.prototype.slice.call(document.querySelectorAll("body *"), 0, 2500);' +
        // a · clipped content outside any horizontal scroll container
        'for (var i = 0; i < all.length; i++) {' +
        '  var el = all[i];' +
        '  if (!vis(el)) continue;' +
        '  var r = el.getBoundingClientRect();' +
        '  if (r.width < 60 || r.height < 24) continue;' +
        '  if (r.right - vw > 12 && r.left < vw - 20 && !inScroller(el)) {' +
        '    var label = ((el.innerText || "").trim().slice(0, 40)) || (el.className && el.className.toString ? el.className.toString().slice(0, 40) : el.tagName);' +
        '    found.push(tag + ": content is clipped/cut off at the right edge (\\"" + label + "\\") — the box extends " + Math.round(r.right - vw) + "px past the viewport with no scroll container.");' +
        '    break;' +
        '  }' +
        '}' +
        // b · heading overlap
        'var heads = Array.prototype.filter.call(document.querySelectorAll("h1,h2,h3"), vis);' +
        'headloop: for (var hI = 0; hI < heads.length; hI++) {' +
        '  var h = heads[hI]; var hr = h.getBoundingClientRect();' +
        '  if (hr.width < 40 || hr.height < 14) continue;' +
        '  for (var j = 0; j < all.length; j++) {' +
        '    var o = all[j];' +
        '    if (o === h || o.contains(h) || h.contains(o) || !vis(o)) continue;' +
        '    var cs2 = getComputedStyle(o); var bg = cs2.backgroundColor;' +
        '    var solid = bg && bg !== "transparent" && !/rgba?\\([^)]*,\\s*0\\)/.test(bg);' +
        '    if (!solid && !o.querySelector("img,svg")) continue;' +
        '    var r2 = o.getBoundingClientRect();' +
        '    var ix = Math.max(0, Math.min(hr.right, r2.right) - Math.max(hr.left, r2.left));' +
        '    var iy = Math.max(0, Math.min(hr.bottom, r2.bottom) - Math.max(hr.top, r2.top));' +
        '    if (ix * iy > 0.25 * hr.width * hr.height && r2.width * r2.height < 4 * hr.width * hr.height) {' +
        '      found.push(tag + ": the heading \\"" + (h.innerText || "").trim().slice(0, 40) + "\\" is overlapped/covered by another element (" + ((o.className && o.className.toString ? o.className.toString() : o.tagName) || "").slice(0, 40) + ").");' +
        '      break headloop;' +
        '    }' +
        '  }' +
        '}' +
        // c · truncation cluster
        'var bad = [];' +
        'for (var k = 0; k < all.length; k++) {' +
        '  var t = all[k];' +
        '  if (!vis(t)) continue;' +
        '  if (getComputedStyle(t).textOverflow !== "ellipsis") continue;' +
        '  if (t.scrollWidth - t.clientWidth > 6 && t.clientWidth > 0) {' +
        '    var hidden = 1 - t.clientWidth / t.scrollWidth;' +
        '    if (hidden > 0.3) bad.push((t.innerText || "").trim().slice(0, 24));' +
        '  }' +
        '}' +
        'if (bad.length >= 3) {' +
        '  found.push(tag + ": " + bad.length + " text fields are truncated to a fraction of their content (e.g. \\"" + bad[0] + "…\\") — give identity/name columns the flexible space instead of fixed widths.");' +
        '}' +
        'return found;' +
      '})(' + JSON.stringify(where) + ')',
    );

  // 4 · Walk: for each destination, click by label, then detect at 390px and 1280px.
  const seen = new Set<string>();
  for (const label of labels) {
    try {
      const clicked = await page.evaluate((t: string) => {
        const d: any = (globalThis as any).document;
        const els = Array.from(d.querySelectorAll('nav a, nav button, aside a, aside button, [class*="nav-item"], [role="navigation"] a')) as any[];
        const el = els.find((e) => (e.innerText || e.getAttribute('aria-label') || '').trim() === t && e.offsetParent !== null);
        if (el) {
          el.click();
          return true;
        }
        return false;
      }, label);
      dbg('clicked', label, clicked);
      if (!clicked) continue;
      await page.waitForTimeout(900);
      for (const vw of [390, 1280]) {
        await page.setViewportSize({ width: vw, height: vw < 500 ? 844 : 860 });
        await page.waitForTimeout(350);
        const found: string[] = await detect(`Signed-in page "${label}" at ${vw}px`).catch((e: any) => {
          dbg('detect threw:', e?.message ?? e);
          return [];
        });
        dbg('detect', label, vw, JSON.stringify(found));
        for (const iss of found) {
          const key = iss.replace(/at \d+px/, '');
          if (!seen.has(key)) {
            seen.add(key);
            issues.push(iss);
          }
        }
        if (issues.length >= 6) break;
      }
    } catch {
      /* keep walking */
    }
    if (issues.length >= 6) break;
  }
  await page.setViewportSize({ width: 1280, height: 800 }).catch(() => {});
  return issues.slice(0, 6);
}

export async function browserSmokeTest(
  url: string,
  signal: AbortSignal,
  opts?: { visual?: boolean; designBrief?: string; manifest?: VerifyManifest | null },
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
    // Block service workers during the probe: a PWA's SW caches/intercepts requests and can make
    // the headless check see stale/blank content or phantom errors, which used to send the gate into
    // a needless fix loop. A correct PWA is progressive enhancement — it MUST work without the SW —
    // so checking the no-SW path is both correct and stable. PWA assets are validated deterministically.
    const ctx = await browser.newContext({ serviceWorkers: 'block' });
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
          const p = u.slice(origin.length) || '/';
          // Our interaction pass submits GARBAGE credentials into auth forms — a 4xx from an
          // auth endpoint is the app's validation WORKING, not a broken app. Counting it as a
          // failure sent a healthy build into a publish-reject loop (a real live incident).
          if (isExpectedAuthRejection(p, r.status())) return;
          failedRequests.push(`${r.status()} ${p}`);
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
          // React-safe seeding: React controlled inputs IGNORE a plain `el.value = x` (React
          // patches the value property, so its onChange never fires and the submit carries empty
          // state — a healthy app then 400s and the gate wrongly failed it, a real live incident).
          // Setting via the NATIVE prototype setter + dispatching `input` is what React listens to.
          const w: any = (globalThis as any).window;
          const setNative = (el: any, value: string) => {
            try {
              const proto = el.tagName === 'TEXTAREA' ? w.HTMLTextAreaElement.prototype : w.HTMLInputElement.prototype;
              const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
              if (setter) setter.call(el, value);
              else el.value = value;
            } catch {
              el.value = value;
            }
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          };
          for (const el of Array.from(d.querySelectorAll('input,textarea')) as any[]) {
            const t = (el.type || 'text').toLowerCase();
            if (!vis(el) || ['hidden', 'submit', 'button', 'file', 'checkbox', 'radio', 'range', 'color'].includes(t))
              continue;
            setNative(el, t === 'email' ? 'verify@arksai.test' : t === 'number' ? '1' : t === 'password' ? 'ArksAIverify1!' : 'ArksAIVerify');
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

    // RESPONSIVE (deterministic, no vision): a real product must not overflow horizontally on a
    // phone OR a small tablet. Measure content vs viewport at several common widths (320 small
    // phone, 390 phone, 768 tablet); a layout wider than the screen at ANY of them is a hard
    // defect. Reset to desktop after so the visual design review (below) sees the desktop layout.
    let responsiveIssue = '';
    let mobileNavIssue = '';
    if (!blank) {
      try {
        for (const vw of [320, 390, 768]) {
          if (responsiveIssue || signal.aborted) break;
          await page.setViewportSize({ width: vw, height: vw < 500 ? 844 : 1024 });
          await page.waitForTimeout(vw === 320 ? 450 : 350);
          const ov: any = await page
            .evaluate(() => {
              const d: any = (globalThis as any).document;
              const w: any = globalThis as any;
              const sw = Math.max(d?.documentElement?.scrollWidth || 0, d?.body?.scrollWidth || 0);
              return { scrollW: sw, innerW: w.innerWidth || 0 };
            })
            .catch(() => ({ scrollW: 0, innerW: vw }));
          const over = Math.round((ov.scrollW || 0) - (ov.innerW || vw));
          if (over > 24)
            responsiveIssue = `Not responsive — horizontal overflow at ${vw}px: content is ${over}px wider than the screen (the user has to scroll sideways). Fix with max-width:100%, flex-wrap, fluid units, image/table containers (overflow-x:auto on the container, not the page), and no fixed pixel widths wider than the viewport.`;
        }

        // Back to a phone width for the mobile-nav check below.
        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForTimeout(300);

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
        const measureContrast = () => page.evaluate(() => {
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
        }) as Promise<string[]>;
        contrastIssues = await measureContrast();
        // DARK-MODE PASS: a half-baked dark theme — where the text-colour token flips light
        // (prefers-color-scheme:dark) but the page BACKGROUND stays light — is invisible to a
        // light-only check and ships near-invisible text to every dark-mode visitor (a real
        // ship-broken bug we hit). Emulate dark, re-measure, then reset to light for the rest.
        try {
          await page.emulateMedia({ colorScheme: 'dark' });
          await page.waitForTimeout(250);
          const darkBad = await measureContrast();
          await page.emulateMedia({ colorScheme: 'light' });
          const keyOf = (s: string) => s.split(' — contrast')[0];
          const lightKeys = new Set(contrastIssues.map(keyOf));
          for (const b of darkBad) if (!lightKeys.has(keyOf(b))) contrastIssues.push(`(dark mode) ${b}`);
        } catch {
          try {
            await page.emulateMedia({ colorScheme: 'light' });
          } catch {}
        }
      } catch {
        /* best-effort */
      }
    }
    const darkOnly = contrastIssues.length > 0 && contrastIssues.every((s) => s.startsWith('(dark mode)'));
    const contrastIssue = contrastIssues.length
      ? `Illegible text — these blocks don't contrast with their background${darkOnly ? ' IN DARK MODE (the site looks fine in light mode but breaks on a dark-mode device — a huge share of phones)' : ' (muted text taken too far)'}. Use a readable ink for ALL text and meet WCAG AA (4.5:1 body, 3:1 large) in BOTH light and dark. If you ship a prefers-color-scheme:dark theme it must be COMPLETE — switch the background too, not just the text — and the brand accent must actually resolve; otherwise pin the scheme with :root{color-scheme:light} and don't emit a half-done dark block. Offenders:\n  - ${contrastIssues.join('\n  - ')}`
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

    // AUTHENTICATED PAGE WALK: sign in with advertised demo credentials and audit every nav
    // destination at phone + desktop widths (clipped content / covered headings / truncation
    // clusters). One bounded pass; restores the entry page after so the vision review below
    // still judges the first screen.
    let pageAuditIssues: string[] = [];
    if (!blank && !signal.aborted) {
      try {
        pageAuditIssues = await walkPagesAuthenticated(page, opts?.manifest?.demo);
        if (pageAuditIssues.length >= 0) {
          await page.goto(url, { waitUntil: 'load', timeout: 12_000 }).catch(() => null);
          await page.waitForTimeout(700);
        }
      } catch {
        /* best-effort — never break the check */
      }
    }

    // Scaffold-declared verification (deterministic; covers API-only apps the walker can't click).
    let manifestIssues: string[] = [];
    if (opts?.manifest && !signal.aborted) {
      try { manifestIssues = await checkManifestRoutes(new URL(url).origin, opts.manifest, signal); } catch {}
    }

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
      !!hoverIssue ||
      pageAuditIssues.length > 0 ||
      manifestIssues.length > 0;

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
        const prompt =
          opts?.visual
            ? opts.designBrief
              ? `${DESIGN_RUBRIC_PROMPT}\n\nThe build committed to this LOCKED design direction — judge CONCEPT FIDELITY too (REVISE if the page ignores it / reverts to a default look): ${opts.designBrief}`
              : DESIGN_RUBRIC_PROMPT
            : VISION_PROMPT;
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
    if (pageAuditIssues.length) lines.push(`✗ Signed-in page audit found layout defects:\n  - ${pageAuditIssues.join('\n  - ')}`);
    if (manifestIssues.length) lines.push(`✗ Declared verification (verify.json) failed:\n  - ${manifestIssues.join('\n  - ')}`);
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
