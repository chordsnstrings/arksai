import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';

const EXTRACT_CAP = 200_000; // chars

export const EXTRACTABLE = new Set(['.xlsx', '.xls', '.csv', '.pdf', '.docx']);

/**
 * Extract readable text from an office/document file so the (text-only) model
 * can work with it via read_file. Returns null for unsupported formats;
 * failures are reported as a short error string rather than thrown.
 */
export async function extractText(absPath: string): Promise<string | null> {
  const ext = path.extname(absPath).toLowerCase();
  if (!EXTRACTABLE.has(ext)) return null;
  try {
    if (ext === '.xlsx' || ext === '.xls' || ext === '.csv') {
      const wb = XLSX.read(fs.readFileSync(absPath), { type: 'buffer' });
      const parts: string[] = [];
      for (const name of wb.SheetNames) {
        parts.push(`=== Sheet: ${name} ===`);
        parts.push(XLSX.utils.sheet_to_csv(wb.Sheets[name]));
      }
      return parts.join('\n').slice(0, EXTRACT_CAP);
    }
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

/**
 * Build the per-run "the user just uploaded …" note injected for the (text-only)
 * agent so it AUTOMATICALLY uses an uploaded file without the user re-instructing.
 * Pure + testable. `files` are workspace-relative paths (e.g. "uploads/data.csv"),
 * excluding the derived ".extracted.txt" sidecars. Returns null if there's nothing
 * to note. Images route to see_image; office/data files route to their extracted
 * sidecar; anything else is read directly with read_file.
 */
export function buildUploadNote(files: string[], minimaxAvailable: boolean): string | null {
  if (!files.length) return null;
  const images = files.filter((f) => IMAGE_RE.test(f));
  const docs = files.filter((f) => !IMAGE_RE.test(f) && EXTRACTABLE.has(path.extname(f).toLowerCase()));
  const others = files.filter((f) => !IMAGE_RE.test(f) && !EXTRACTABLE.has(path.extname(f).toLowerCase()));
  const clauses: string[] = [];
  if (docs.length)
    clauses.push(
      `document/data file(s): ${docs.map((f) => `${f} (read its extracted text at ${f}.extracted.txt)`).join('; ')}`,
    );
  if (others.length) clauses.push(`file(s): ${others.join(', ')} (read with read_file)`);
  if (images.length)
    clauses.push(
      minimaxAvailable
        ? `image(s): ${images.join(', ')} (you are text-only — call see_image on each before answering)`
        : `image(s): ${images.join(', ')} (image viewing is unavailable — MINIMAX_API_KEY is not set — so tell the user you can't view them rather than guessing)`,
    );
  return (
    `[System note: the user just uploaded ${clauses.join('; and ')}. ` +
    `Use these to fulfil the request — open/read them now; do NOT ask the user to paste or re-upload, and do not guess their contents.]`
  );
}
