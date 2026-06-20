import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';
import { analyzeImage } from '../engines/minimax';
import { DESIGN_RUBRIC_PROMPT, parseDesignVerdict } from './uiCheck';
import { renderDocHtml } from '../routes/docview';

/**
 * Universal deliverable visual-QC. Given a produced file, RENDER it to image(s), run a
 * per-type functional check ("does it actually work") and the design-director rubric
 * ("does it look genuinely designed"), and return a verdict the agent loop can gate on —
 * the same render→see→critique→revise guarantee web apps get, extended to every type.
 *
 * Graceful + LOUD: if a renderer / vision is unavailable it returns ran:false with the
 * reason in `detail` (never throws into the caller, never silently passes).
 */

export type DeliverableKind = 'pdf' | 'xlsx' | 'docx' | 'pptx' | 'html';

export interface DeliverableQC {
  ran: boolean; // did rendering + vision actually run?
  functionalOk: boolean; // re-open / validity (HARD gate)
  functionalDetail: string;
  designVerdict?: 'pass' | 'revise' | 'unknown';
  designDefects?: string[];
  pages: number;
  visionCalls: number;
  detail: string; // human summary for the timeline
}

const MAX_PAGES = 6; // cap rasterized pages (cost/latency)

/** Per-kind framing prepended to the shared design rubric so the critique is type-aware. */
const KIND_PREAMBLE: Record<DeliverableKind, string> = {
  pdf:
    'This is ONE page of a print-quality PDF report/deck. In ADDITION to the rubric, flag as REVISE: any ' +
    'chart/figure/table/bar-list SPLIT across the page edge or cut off; a heading stranded at the page bottom; ' +
    'text running edge-to-edge (margins too tight); a lonely near-empty page; overused accent; low-contrast text. ',
  xlsx:
    'This is a spreadsheet rendered to HTML. Judge it as a finance/data professional: clear header styling, ' +
    'consistent number/currency/percent formatting and alignment, readable row banding, sensible column widths, ' +
    'no overflow or raw error codes. Does it look like a clean, trustworthy model? ',
  docx:
    'This is a Word document rendered to HTML. Judge editorial quality: typographic hierarchy, comfortable ' +
    'measure and spacing, readable tables, a considered (not "office default") look. ',
  pptx:
    'This is ONE presentation slide. Judge: one clear idea per slide, strong title hierarchy, not crowded, ' +
    'on-palette flat charts, generous margins, legible from the back of a room. ',
  html: '',
};

// ---------------------------------------------------------------- renderers

/** Fraction of "content ink" pixels (luminance < 200) on a rasterized pixmap. Cheap
 *  sampling. Paper/ivory backgrounds (~234+) and faint gridlines don't count, so a
 *  near-empty page reads near 0 while a full page is materially higher. */
function inkCoverage(pix: any): number {
  try {
    const px: Uint8Array = pix.getPixels();
    const comps: number = pix.getNumberOfComponents(); // e.g. 4 = RGBA
    if (!px?.length || comps < 3) return 1;
    let ink = 0;
    let seen = 0;
    // sample every 4th pixel for speed
    for (let i = 0; i + comps <= px.length; i += comps * 4) {
      const lum = (px[i] + px[i + 1] + px[i + 2]) / 3;
      if (lum < 200) ink++;
      seen++;
    }
    return seen ? ink / seen : 1;
  } catch {
    return 1; // never block on a measurement failure
  }
}

/** Vertical extent of content: the fraction of page HEIGHT at which the last row
 *  carrying real ink sits. A full page reads ~0.95; a page whose content stops a
 *  third of the way down (a stranded short section + a big blank bottom) reads ~0.3.
 *  This is what catches an UNDER-FILLED page that inkCoverage alone misses (dense
 *  top, empty bottom can still have moderate overall coverage). */
function contentBottomExtent(pix: any): number {
  try {
    const px: Uint8Array = pix.getPixels();
    const comps: number = pix.getNumberOfComponents();
    const w: number = pix.getWidth();
    const h: number = pix.getHeight();
    const stride: number = typeof pix.getStride === 'function' ? pix.getStride() : w * comps;
    if (!px?.length || comps < 3 || !h || !w) return 1;
    let lastInkRow = 0;
    for (let y = 0; y < h; y++) {
      let ink = 0;
      let seen = 0;
      const base = y * stride;
      for (let x = 0; x < w; x += 4) {
        const i = base + x * comps;
        if (i + 2 >= px.length) break;
        const lum = (px[i] + px[i + 1] + px[i + 2]) / 3;
        if (lum < 200) ink++;
        seen++;
      }
      // a row "has content" if >0.3% of its sampled pixels are ink (ignore stray specks)
      if (seen && ink / seen > 0.003) lastInkRow = y;
    }
    return (lastInkRow + 1) / h;
  } catch {
    return 1; // never block on a measurement failure
  }
}

async function rasterizePdf(abs: string): Promise<{ pngs: Buffer[]; pages: number; coverage: number[]; extent: number[] }> {
  // mupdf is ESM with top-level await. Our server is CommonJS, so a normal `import()` gets
  // transpiled to require() and fails ("require() cannot be used on an ESM graph with
  // top-level await"). A Function-constructed import() stays a TRUE dynamic import that
  // Node runs natively, loading the ESM module from CJS. (TS also skips type-resolving it.)
  const nativeImport: (s: string) => Promise<any> = new Function('s', 'return import(s)') as any;
  const mupdf: any = await nativeImport('mupdf');
  const doc = mupdf.Document.openDocument(fs.readFileSync(abs), 'application/pdf');
  const pages = doc.countPages();
  const pngs: Buffer[] = [];
  const coverage: number[] = [];
  const extent: number[] = [];
  for (let i = 0; i < Math.min(pages, MAX_PAGES); i++) {
    const page = doc.loadPage(i);
    const pix = page.toPixmap(mupdf.Matrix.scale(1.6, 1.6), mupdf.ColorSpace.DeviceRGB, false, true);
    coverage.push(inkCoverage(pix));
    extent.push(contentBottomExtent(pix));
    pngs.push(Buffer.from(pix.asPNG()));
  }
  return { pngs, pages, coverage, extent };
}

/**
 * Deterministic, model-free structural pre-check from per-page ink coverage: flag a
 * near-empty interior page (a lonely "Verdict" / one-line page — the recurring report
 * bug) so the revise round can fix it instantly without spending a vision call. Pure +
 * exported for unit tests. Conservative threshold so intentionally-sparse pages and the
 * cover (page 1, which can be light by design) are never falsely flagged.
 */
export function detectEmptyPages(coverage: number[], threshold = 0.006): string[] {
  const out: string[] = [];
  for (let i = 0; i < coverage.length; i++) {
    if (i === 0) continue; // never flag the cover
    if (coverage[i] < threshold) {
      out.push(
        `p${i + 1}: near-empty page (almost no content) — don't strand a lonely heading/line on its own ` +
          `page; let the surrounding sections FLOW to fill it or merge it into the previous page.`,
      );
    }
  }
  return out;
}

/**
 * Deterministic under-fill check: flag an INTERIOR page whose content stops well
 * before the bottom (a short stranded section + a large blank lower region) — the
 * "≥60% page fill" rule the user asked for, which inkCoverage misses (a dense top +
 * empty bottom still has moderate coverage). The cover (page 1) and the LAST page (a
 * report legitimately ends partway down its final page) are exempt. Pure + tested.
 */
export function detectUnderfilledPages(extent: number[], minFill = 0.6): string[] {
  const out: string[] = [];
  const last = extent.length - 1;
  for (let i = 0; i < extent.length; i++) {
    if (i === 0 || i === last) continue; // skip cover + final page
    const e = extent[i];
    // 0.08..minFill = a real (not blank) page that nonetheless ends high, leaving a big gap.
    if (e >= 0.08 && e < minFill) {
      out.push(
        `p${i + 1}: under-filled — content ends at ~${Math.round(e * 100)}% of the page height, leaving a large ` +
          `blank lower band. Every interior page must be ≥~60% filled: pull the next section up so it FLOWS onto ` +
          `this page, lengthen the section, or rebalance so a short section doesn't strand a half-empty page.`,
      );
    }
  }
  return out;
}

/** Screenshot an HTML string (full page) in headless Chromium. */
async function screenshotHtml(html: string, isUrl = false): Promise<Buffer | null> {
  let pw: any;
  try {
    pw = await import('playwright');
  } catch {
    return null;
  }
  let browser: any;
  try {
    browser = await pw.chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const page = await (await browser.newContext({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 2 })).newPage();
    if (isUrl) await page.goto(html, { waitUntil: 'load', timeout: 20_000 });
    else await page.setContent(html, { waitUntil: 'load', timeout: 20_000 });
    await page.waitForTimeout(600);
    return (await page.screenshot({ type: 'png', fullPage: true })) as Buffer;
  } catch {
    return null;
  } finally {
    try {
      await browser?.close();
    } catch {}
  }
}

/** Optional higher-fidelity path: LibreOffice → PDF → raster. Returns null if soffice is absent/fails. */
async function renderViaSoffice(abs: string): Promise<{ pngs: Buffer[]; pages: number } | null> {
  try {
    const { execFileSync } = await import('node:child_process');
    const os = await import('node:os');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dlv-'));
    execFileSync('soffice', ['--headless', '--convert-to', 'pdf', '--outdir', tmp, abs], {
      timeout: 60_000,
      stdio: 'ignore',
    });
    const pdf = fs.readdirSync(tmp).find((f) => f.toLowerCase().endsWith('.pdf'));
    if (!pdf) return null;
    return await rasterizePdf(path.join(tmp, pdf));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- functional checks

async function functionalCheck(abs: string, kind: DeliverableKind): Promise<{ ok: boolean; detail: string; pages?: number }> {
  try {
    if (kind === 'xlsx') {
      const XLSX: any = await import('xlsx');
      const wb = XLSX.read(fs.readFileSync(abs), { type: 'buffer' });
      let formulas = 0;
      const errors: string[] = [];
      const errRe = /^#(REF|DIV\/0|VALUE|NAME|N\/A|NULL|NUM)[!?]/;
      for (const name of wb.SheetNames) {
        const sh = wb.Sheets[name];
        for (const addr of Object.keys(sh)) {
          if (addr[0] === '!') continue;
          const c = sh[addr];
          if (c.f) formulas++;
          if (c.t === 'e' || (typeof c.v === 'string' && errRe.test(c.v))) errors.push(`${name}!${addr}`);
        }
      }
      if (!wb.SheetNames.length) return { ok: false, detail: 'workbook has no sheets' };
      if (errors.length) return { ok: false, detail: `formula error cells: ${errors.slice(0, 6).join(', ')}` };
      return { ok: true, detail: `re-opened OK — ${wb.SheetNames.length} sheet(s), ${formulas} formula cells, no error values` };
    }
    if (kind === 'docx') {
      const mammoth: any = await import('mammoth');
      const convert = mammoth.convertToHtml ?? mammoth.default?.convertToHtml;
      const r = await convert({ path: abs });
      const text = String(r.value || '').replace(/<[^>]+>/g, '').trim();
      const JSZip: any = (await import('jszip')).default ?? (await import('jszip'));
      const zip = await JSZip.loadAsync(fs.readFileSync(abs));
      const fontEmbedded = !!zip.file('word/fontTable.xml');
      if (text.length < 40) return { ok: false, detail: `document has too little text (${text.length} chars)` };
      return { ok: true, detail: `re-opened OK — ${text.length} chars${fontEmbedded ? ', fonts embedded' : ''}` };
    }
    if (kind === 'pptx') {
      const JSZip: any = (await import('jszip')).default ?? (await import('jszip'));
      const zip = await JSZip.loadAsync(fs.readFileSync(abs));
      const slides = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
      if (!zip.file('ppt/presentation.xml') || !slides.length) return { ok: false, detail: 'not a valid .pptx (missing presentation/slides)' };
      return { ok: true, detail: `re-opened OK — ${slides.length} slide(s)`, pages: slides.length };
    }
    // pdf / html functional validity is covered by the render (page count / load).
    return { ok: true, detail: '' };
  } catch (e: any) {
    return { ok: false, detail: `re-open failed: ${String(e?.message ?? e).slice(0, 120)}` };
  }
}

// ---------------------------------------------------------------- formula audit

// A row label that names a DERIVED number (one that should be computed, not typed).
const DERIVED_LABEL_RE =
  /\b(total|subtotal|sum|net|gross|cumulative|balance|ending|opening|margin|growth|profit|ebitda|runway|burn|variance|roi|irr|npv|payback|ratio)\b/i;
// A sheet whose values are meant to FEED other sheets' calculations.
const MODEL_SHEET_RE = /assumption|driver|input/i;

/** "A1" → { col: 0-based index, row: 1-based } (or null for a non-cell key). */
function parseAddr(addr: string): { col: number; row: number } | null {
  const m = /^([A-Z]+)(\d+)$/.exec(addr);
  if (!m) return null;
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col: col - 1, row: parseInt(m[2], 10) };
}

/**
 * Heuristic: is this workbook a financial/calculation MODEL that was built with hard-coded
 * numbers instead of live formulas? The vision design gate can't catch this — it renders
 * COMPUTED VALUES (SheetJS sheet_to_html), so a `=SUM()` and a typed-in literal look identical.
 * This reads `cell.f` (which only the functional parse can see) and flags ONLY when the whole
 * workbook has ZERO formulas AND it clearly shows derived numbers: a "Total/Net/Ending Balance/
 * Growth…" ROW carrying numbers, or a multi-sheet model with an Assumptions/Drivers tab feeding
 * a numeric grid. Plain data tables (no derived rows, no assumptions sheet) are never flagged.
 * Pure + synchronous so it's trivially unit-testable. Takes an already-parsed SheetJS workbook.
 */
export function auditFormulaModel(wb: any): { isModel: boolean; reason: string } {
  let formulas = 0;
  let numericTotal = 0;
  let derivedWithNumbers = ''; // a derived row carrying numbers (0-formula case, ≥1)
  let derivedAllLiteral = ''; // a derived row whose numbers are ALL typed-in literals (≥2, none formulas)
  const names: string[] = Array.isArray(wb?.SheetNames) ? wb.SheetNames : [];
  for (const name of names) {
    const sh = wb?.Sheets?.[name];
    if (!sh) continue;
    // Group cells by row so we can read each row's label + whether its numbers are formulas.
    const rows = new Map<number, { label?: string; labelCol: number; numCells: number; numFormulaCells: number }>();
    for (const addr of Object.keys(sh)) {
      if (addr[0] === '!') continue;
      const c = sh[addr];
      if (c?.f) formulas++;
      const p = parseAddr(addr);
      if (!p) continue;
      let r = rows.get(p.row);
      if (!r) {
        r = { labelCol: Infinity, numCells: 0, numFormulaCells: 0 };
        rows.set(p.row, r);
      }
      const isNum = c?.t === 'n' && typeof c?.v === 'number';
      if (isNum) {
        numericTotal++;
        r.numCells++;
        if (c?.f) r.numFormulaCells++;
      }
      const isText = (c?.t === 's' || c?.t === 'str') && typeof c?.v === 'string' && c.v.trim();
      if (isText && p.col < r.labelCol) {
        r.labelCol = p.col;
        r.label = String(c.v);
      }
    }
    // An assumptions/driver/input sheet is SUPPOSED to be hard-coded numbers — never treat
    // its rows as "should-be-computed" derived rows (that's a false positive).
    const isInputSheet = MODEL_SHEET_RE.test(name);
    for (const r of rows.values()) {
      if (!r.label || !DERIVED_LABEL_RE.test(r.label)) continue;
      if (!derivedWithNumbers && r.numCells >= 1) derivedWithNumbers = r.label.trim();
      // On a CALCULATION sheet, a derived row with ≥2 numbers that are ALL literals (no
      // formulas) was typed in, not computed.
      if (!derivedAllLiteral && !isInputSheet && r.numCells >= 2 && r.numFormulaCells === 0)
        derivedAllLiteral = r.label.trim();
    }
  }
  // Partial hard-coding: a derived row (Total/Growth/Margin/…) is literals while the rest of
  // the model uses formulas — it should have been computed. Flag whether or not formulas exist.
  if (derivedAllLiteral && formulas > 0)
    return { isModel: true, reason: `the "${derivedAllLiteral}" row is hard-coded literals while the model uses formulas elsewhere — it should be a formula` };
  // Whole model hard-coded (0 formulas) but clearly showing derived numbers.
  if (formulas === 0 && derivedWithNumbers)
    return { isModel: true, reason: `the "${derivedWithNumbers}" row is hard-coded, 0 formulas` };
  if (formulas > 0) return { isModel: false, reason: `${formulas} formula cells` };
  const hasAssumptions = names.some((n) => MODEL_SHEET_RE.test(n));
  if (names.length >= 2 && hasAssumptions && numericTotal >= 30)
    return { isModel: true, reason: `multi-sheet model with an assumptions sheet but 0 formulas (${numericTotal} hard-coded numbers)` };
  return { isModel: false, reason: '' };
}

// ---------------------------------------------------------------- main

export async function checkDeliverable(abs: string, kind: DeliverableKind, signal: AbortSignal): Promise<DeliverableQC> {
  const base: DeliverableQC = {
    ran: false,
    functionalOk: true,
    functionalDetail: '',
    pages: 0,
    visionCalls: 0,
    designVerdict: 'unknown',
    detail: '',
  };
  if (!fs.existsSync(abs)) return { ...base, functionalOk: false, functionalDetail: 'file not found', detail: 'file not found' };

  // 1) Functional check first — a broken file shouldn't be design-reviewed.
  const fn = await functionalCheck(abs, kind);
  base.functionalOk = fn.ok;
  base.functionalDetail = fn.detail;
  if (fn.pages) base.pages = fn.pages;
  if (!fn.ok) return { ...base, ran: true, designVerdict: 'unknown', detail: `✗ ${kind} validation: ${fn.detail}` };

  // 1b) Spreadsheet formula enforcement — independent of the vision gate. The vision review
  // renders COMPUTED VALUES, so it can't tell a =SUM() from a typed-in literal; this reads
  // cell.f directly and flags a calculation MODEL that was built with hard-coded numbers.
  // Seeded into designDefects BEFORE the render/vision early-returns so it's enforced even
  // when no vision model is available (MiniMax egress is flaky).
  const seedDefects: string[] = [];
  if (kind === 'xlsx') {
    try {
      const XLSX: any = await import('xlsx');
      const wb = XLSX.read(fs.readFileSync(abs), { type: 'buffer' });
      const audit = auditFormulaModel(wb);
      if (audit.isModel) {
        seedDefects.push(
          `This spreadsheet is a financial/calculation model but every derived value is hard-coded (${audit.reason}). ` +
            `Re-run generate_spreadsheet with LIVE formulas for every derived cell — totals as =SUM(...), and ` +
            `growth/balances/ratios referencing the assumption cells, e.g. {"f":"C5*(1+Assumptions!B5)","v":<result>} — ` +
            `so changing one assumption flows through. Keep the same structure and styling; include the cached result ` +
            `"v" so the preview shows numbers.`,
        );
        base.designVerdict = 'revise';
        base.designDefects = [...seedDefects];
      }
    } catch {
      /* formula audit is best-effort — never block the gate on it */
    }
  }

  // 2) Render to PNG(s).
  let pngs: Buffer[] = [];
  let renderNote = '';
  try {
    if (kind === 'pdf') {
      const r = await rasterizePdf(abs);
      pngs = r.pngs;
      base.pages = r.pages;
      // Deterministic, model-free structural pre-check: flag lonely near-empty
      // interior pages AND under-filled pages (content stops high, big blank bottom —
      // the ≥60% fill rule) instantly (no vision call) so they're caught even when the
      // vision model is unavailable and so a revise round can fix them cheaply.
      const structural = [...detectEmptyPages(r.coverage), ...detectUnderfilledPages(r.extent)];
      if (structural.length) {
        seedDefects.push(...structural);
        base.designVerdict = 'revise';
        base.designDefects = [...seedDefects];
      }
    } else if (kind === 'html') {
      const shot = await screenshotHtml(`file://${abs}`, true);
      if (shot) pngs = [shot];
    } else if (kind === 'xlsx' || kind === 'docx') {
      const rendered = await renderDocHtml(abs);
      if (rendered) {
        const shot = await screenshotHtml(rendered.html, false);
        if (shot) pngs = [shot];
      }
    } else if (kind === 'pptx') {
      // soffice→pdf→raster (true fidelity) if available; else the sibling .preview.html.
      const sof = await renderViaSoffice(abs);
      if (sof && sof.pngs.length) {
        pngs = sof.pngs;
        renderNote = ' (rendered via LibreOffice)';
      } else {
        const preview = abs.replace(/\.pptx$/i, '.preview.html');
        if (fs.existsSync(preview)) {
          const shot = await screenshotHtml(`file://${preview}`, true);
          if (shot) {
            pngs = [shot];
            renderNote = ' (rendered via preview HTML)';
          }
        }
      }
    }
  } catch (e: any) {
    renderNote = ` (render failed: ${String(e?.message ?? e).slice(0, 80)})`;
  }

  if (!pngs.length) {
    const seedNote = seedDefects.length ? ' ⚠ issues flagged for revise.' : '';
    return {
      ...base,
      ran: false,
      detail: `✓ ${kind} valid (${fn.detail}) — but could not render it for a visual review${renderNote}; shipped without the design gate.${seedNote}`,
    };
  }

  // 3) Vision design rubric per page; aggregate. Even with no vision model, the
  // deterministic seedDefects (formula audit + structural near-empty pages) still gate.
  if (!config.minimaxApiKey || signal.aborted) {
    const seedNote = seedDefects.length ? ' ⚠ issues flagged for revise.' : '';
    return {
      ...base,
      ran: false,
      designDefects: seedDefects.length ? [...seedDefects].slice(0, 5) : base.designDefects,
      detail: `✓ ${kind} valid (${fn.detail}); visual gate skipped (no vision model).${seedNote}`,
    };
  }
  const prompt = (KIND_PREAMBLE[kind] || '') + DESIGN_RUBRIC_PROMPT;
  // Seed with the spreadsheet formula finding (if any) so vision defects APPEND rather than
  // overwrite it, and a vision "pass" can't downgrade the formula "revise".
  const defects: string[] = [...seedDefects];
  let verdict: 'pass' | 'revise' | 'unknown' = base.designVerdict === 'revise' ? 'revise' : 'unknown';
  let visionFails = 0;
  for (let i = 0; i < pngs.length; i++) {
    if (signal.aborted) break;
    const dataUrl = `data:image/png;base64,${pngs[i].toString('base64')}`;
    const r = await analyzeImage(dataUrl, prompt, signal);
    base.visionCalls++;
    if (!r.ok || !r.text) {
      visionFails++;
      continue;
    }
    const v = parseDesignVerdict(r.text);
    if (v.verdict === 'revise') {
      verdict = 'revise';
      for (const d of v.defects) defects.push(pngs.length > 1 ? `p${i + 1}: ${d}` : d);
    } else if (v.verdict === 'pass' && verdict !== 'revise') {
      verdict = 'pass';
    }
  }
  base.designVerdict = verdict;
  base.designDefects = [...new Set(defects)].slice(0, 5);
  base.ran = base.visionCalls > visionFails;

  const lines = [`Rendered ${pngs.length} page(s)${renderNote}; functional: ${fn.detail}.`];
  if (verdict === 'revise' && base.designDefects.length) lines.push(`👁 Design review — REVISE:\n  - ${base.designDefects.join('\n  - ')}`);
  else if (verdict === 'pass') lines.push('👁 Design review — PASS (looks well designed).');
  if (visionFails) lines.push(`⚠ ${visionFails}/${pngs.length} page(s) could not be vision-reviewed.`);
  base.detail = lines.join('\n');
  return base;
}
