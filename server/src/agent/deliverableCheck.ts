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

async function rasterizePdf(abs: string): Promise<{ pngs: Buffer[]; pages: number }> {
  // mupdf is ESM with top-level await. Our server is CommonJS, so a normal `import()` gets
  // transpiled to require() and fails ("require() cannot be used on an ESM graph with
  // top-level await"). A Function-constructed import() stays a TRUE dynamic import that
  // Node runs natively, loading the ESM module from CJS. (TS also skips type-resolving it.)
  const nativeImport: (s: string) => Promise<any> = new Function('s', 'return import(s)') as any;
  const mupdf: any = await nativeImport('mupdf');
  const doc = mupdf.Document.openDocument(fs.readFileSync(abs), 'application/pdf');
  const pages = doc.countPages();
  const pngs: Buffer[] = [];
  for (let i = 0; i < Math.min(pages, MAX_PAGES); i++) {
    const page = doc.loadPage(i);
    const pix = page.toPixmap(mupdf.Matrix.scale(1.6, 1.6), mupdf.ColorSpace.DeviceRGB, false, true);
    pngs.push(Buffer.from(pix.asPNG()));
  }
  return { pngs, pages };
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

  // 2) Render to PNG(s).
  let pngs: Buffer[] = [];
  let renderNote = '';
  try {
    if (kind === 'pdf') {
      const r = await rasterizePdf(abs);
      pngs = r.pngs;
      base.pages = r.pages;
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
    return {
      ...base,
      ran: false,
      detail: `✓ ${kind} valid (${fn.detail}) — but could not render it for a visual review${renderNote}; shipped without the design gate.`,
    };
  }

  // 3) Vision design rubric per page; aggregate.
  if (!config.minimaxApiKey || signal.aborted) {
    return { ...base, ran: false, detail: `✓ ${kind} valid (${fn.detail}); visual gate skipped (no vision model).` };
  }
  const prompt = (KIND_PREAMBLE[kind] || '') + DESIGN_RUBRIC_PROMPT;
  const defects: string[] = [];
  let verdict: 'pass' | 'revise' | 'unknown' = 'unknown';
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
