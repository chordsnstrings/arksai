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
      // import the inner module to dodge pdf-parse's debug-mode file read
      const pdfParse = require('pdf-parse/lib/pdf-parse.js');
      const data = await pdfParse(fs.readFileSync(absPath));
      return String(data.text ?? '').slice(0, EXTRACT_CAP);
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
