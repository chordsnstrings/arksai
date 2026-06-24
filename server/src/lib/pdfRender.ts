import fs from 'node:fs';
import path from 'node:path';

/**
 * Render a PDF's pages to images so the (multimodal) agent can READ a scanned / tabular PDF by
 * sight — the fix for `pdf-parse` returning garbage on scanned documents (e.g. bank challans),
 * which silently destroys the 2-D table structure and makes the model guess. Reuses the same
 * native-ESM `mupdf` import trick as deliverableCheck (server is CJS; mupdf is ESM + TLA).
 */
const nativeImport: (s: string) => Promise<any> = new Function('s', 'return import(s)') as any;

export const PAGE_RENDER_RE = /\.pdf\.page-\d+\.png$/i;

/**
 * Rasterize up to `maxPages` of a PDF to `<dir>/<pdfName>.page-N.png` (2× scale so small print
 * stays legible). Returns the basenames written. Fail-soft → []. `pdfName` is the on-disk file
 * name of the PDF (e.g. "foo.pdf") so the renders pair back to it by prefix.
 */
export async function rasterizePdfPages(absPdf: string, outDir: string, pdfName: string, maxPages = 12): Promise<string[]> {
  try {
    const mupdf: any = await nativeImport('mupdf');
    const doc = mupdf.Document.openDocument(fs.readFileSync(absPdf), 'application/pdf');
    const n = Math.min(doc.countPages(), maxPages);
    const out: string[] = [];
    for (let i = 0; i < n; i++) {
      const page = doc.loadPage(i);
      const pix = page.toPixmap(mupdf.Matrix.scale(2.0, 2.0), mupdf.ColorSpace.DeviceRGB, false, true);
      const name = `${pdfName}.page-${i + 1}.png`;
      fs.writeFileSync(path.join(outDir, name), Buffer.from(pix.asPNG()));
      out.push(name);
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Does a PDF's extracted text look UNRELIABLE for data (scanned / image-only / garbled), so we
 * should render the pages and read them by sight instead of trusting the text layer? Pure +
 * unit-tested. Calibrated on real files: born-digital PDFs score density ~0.12+; scanned bank
 * challans (whose line-item tables don't survive extraction) score ~0.055, and empty/near-empty
 * extracts are obviously unreliable.
 */
export function textLooksUnreliable(text: string | null | undefined): boolean {
  const t = (text || '').trim();
  if (t.length < 40) return true; // empty / a stub → definitely need the images
  const sz = t.replace(/\s/g, '').length;
  const words4 = (t.match(/[A-Za-z]{4,}/g) || []).length;
  const nums = (t.match(/\d{2,}/g) || []).length;
  const density = (words4 + nums) / Math.max(sz, 1);
  return density < 0.09;
}
