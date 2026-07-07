import fs from 'node:fs';
import path from 'node:path';

const EXTRACT_CAP = 200_000; // chars

// Linear prose/document formats get a plain-text sidecar (read_file). Spreadsheets do
// NOT — a flat text dump silently drops sheets (a multi-sheet workbook lost 23 of 26
// sheets to the char cap), so they're read structurally via the read_spreadsheet tool.
export const EXTRACTABLE = new Set(['.pdf', '.docx']);
export const SPREADSHEET = new Set(['.xlsx', '.xls', '.csv']);
// PowerPoint is a binary zip (OOXML) — a flat-text extract is garbage, so it's read
// structurally via the read_presentation tool (NOT a text sidecar, NOT read_file).
export const PRESENTATION = new Set(['.pptx']);

/**
 * Extract readable text from a prose/document file (PDF/DOCX) so the (text-only)
 * model can work with it via read_file. Spreadsheets are NOT extracted here (use the
 * read_spreadsheet tool — flat extraction loses sheets). Returns null for anything
 * else; failures are a short error string rather than thrown.
 */
export async function extractText(absPath: string): Promise<string | null> {
  const ext = path.extname(absPath).toLowerCase();
  if (!EXTRACTABLE.has(ext)) return null;
  try {
    if (ext === '.pdf') {
      const { PDFParse } = await import('pdf-parse');
      const parser = new PDFParse({ data: fs.readFileSync(absPath) });
      const result = await parser.getText();
      return String(result.text ?? '').slice(0, EXTRACT_CAP);
    }
    if (ext === '.docx') {
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ path: absPath });
      return String(result.value ?? '').slice(0, EXTRACT_CAP);
    }
  } catch (err: any) {
    return `[extraction failed: ${String(err?.message ?? err).slice(0, 200)}]`;
  }
  return null;
}

const IMAGE_RE = /\.(png|jpe?g|webp|gif|bmp)$/i;
// Page images we render from a scanned PDF (named "<file>.pdf.page-N.png"); routed to see_image,
// not treated as a standalone uploaded image.
const PAGE_RENDER_RE = /\.pdf\.page-\d+\.png$/i;

/**
 * Build the per-run "the user just uploaded …" note injected for the (text-only)
 * agent so it AUTOMATICALLY uses an uploaded file without the user re-instructing.
 * Pure + testable. `files` are workspace-relative paths (e.g. "uploads/data.csv"),
 * excluding the derived ".extracted.txt" sidecars. Returns null if there's nothing
 * to note. Images route to see_image; office/data files route to their extracted
 * sidecar; anything else is read directly with read_file.
 */
export function buildUploadNote(files: string[], minimaxAvailable: boolean, paletteAvailable = false): string | null {
  if (!files.length) return null;
  const ext = (f: string) => path.extname(f).toLowerCase();
  // Page renders of a scanned PDF are handled WITH their PDF (read by sight), not as loose images.
  const pageRenders = files.filter((f) => PAGE_RENDER_RE.test(f));
  const rest = files.filter((f) => !PAGE_RENDER_RE.test(f));
  const rendersFor = (pdf: string) => {
    const pre = `${path.basename(pdf)}.page-`;
    return pageRenders.filter((p) => path.basename(p).startsWith(pre));
  };
  const images = rest.filter((f) => IMAGE_RE.test(f));
  const sheets = rest.filter((f) => !IMAGE_RE.test(f) && SPREADSHEET.has(ext(f)));
  const decks = rest.filter((f) => !IMAGE_RE.test(f) && PRESENTATION.has(ext(f)));
  const docs = rest.filter((f) => !IMAGE_RE.test(f) && EXTRACTABLE.has(ext(f)));
  const others = rest.filter(
    (f) => !IMAGE_RE.test(f) && !SPREADSHEET.has(ext(f)) && !PRESENTATION.has(ext(f)) && !EXTRACTABLE.has(ext(f)),
  );
  // A PDF with page renders is SCANNED → read by sight; the rest read their text sidecar.
  const scannedPdfs = docs.filter((d) => ext(d) === '.pdf' && rendersFor(d).length > 0);
  const textDocs = docs.filter((d) => !(ext(d) === '.pdf' && rendersFor(d).length > 0));
  const clauses: string[] = [];
  if (sheets.length)
    clauses.push(
      `spreadsheet(s): ${sheets.join(', ')} — call read_spreadsheet on each (NOT read_file) to list every sheet ` +
        `and read exact values; for totals / P&L / pivots / charts, crunch the raw file with Python (pandas/openpyxl) in code mode` +
        (sheets.length > 1
          ? `. To MERGE/COMBINE these into ONE workbook (bank statements, expense exports…) call combine_spreadsheets with ALL the paths in one call — it cleans, maps, de-duplicates and reconciles deterministically; do NOT pre-read or script the merge`
          : ''),
    );
  if (decks.length)
    clauses.push(
      `presentation(s): ${decks.join(', ')} — call read_presentation on each (NOT read_file) to read every slide + speaker notes`,
    );
  if (textDocs.length)
    clauses.push(
      `document file(s): ${textDocs.map((f) => `${f} (read its extracted text at ${f}.extracted.txt)`).join('; ')}`,
    );
  if (scannedPdfs.length) {
    const parts = scannedPdfs.map((d) => `${d} → page images: ${rendersFor(d).join(', ')}`);
    clauses.push(
      `SCANNED PDF(s) whose text layer is UNRELIABLE — do NOT trust ${scannedPdfs.map((d) => `${d}.extracted.txt`).join('/')}; instead READ THE PAGE IMAGES with see_image (one call per page) and transcribe every table row exactly: ${parts.join('; ')}. ` +
        `For tabular / financial data: (1) transcribe EVERY line item — read each row's OWN date/month column, never infer it — and tag which source document each row came from; (2) build the spreadsheet from that line-item list (keep an audit-trail sheet); (3) RECONCILE each document's extracted total to its printed total and flag any mismatch; (4) DE-DUPE identical documents. Missing a row, a supplier, or a month is a failure — cross-check totals before finishing.`,
    );
  }
  if (others.length) clauses.push(`file(s): ${others.join(', ')} (read with read_file)`);
  if (images.length) {
    // When extract_palette is in the toolset (onboarding/code/report), a LOGO's brand
    // colours can be read deterministically with NO vision model — so the agent should
    // never claim it "can't view" an uploaded logo.
    const list = images.join(', ');
    let imgClause: string;
    if (paletteAvailable) {
      imgClause = minimaxAvailable
        ? `image(s): ${list} (if it's a LOGO/brand mark, call extract_palette on it to read the brand colours as exact hex; to read what is IN an image, call see_image — treat the image as fully readable)`
        : `image(s): ${list} (if it's a LOGO/brand mark, call extract_palette on it to read the brand colours as exact hex — works without a vision model, so treat the logo as fully readable)`;
    } else {
      // Vision is available in every mode — always look; treat images as fully readable.
      imgClause = `image(s): ${list} (call see_image with the path to LOOK at each before answering — treat every image as fully readable)`;
    }
    clauses.push(imgClause);
  }
  // When several files and/or several kinds were uploaded, make it explicit that EVERY
  // one must be processed (every sheet of each spreadsheet, every slide of each deck, and
  // every image looked at) — the operator's "multiple excels + multiple images" must just work.
  const everyFile =
    files.length > 1 || clauses.length > 1
      ? ' Open/read EACH of these — every sheet of each spreadsheet, every slide of each deck, and LOOK at every image — before answering; do not stop after the first.'
      : '';
  return (
    `[System note: the user just uploaded ${clauses.join('; and ')}. ` +
    `Use these to fulfil the request — open/read them now; do NOT ask the user to paste or re-upload, and do not guess their contents.${everyFile}]`
  );
}
