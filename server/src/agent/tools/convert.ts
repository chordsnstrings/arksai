import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { resolveInWorkspace, type ToolDef } from './common';

/**
 * Render a self-contained HTML file to PDF with headless Chromium.
 * Chromium renders inline SVG / <img> perfectly — unlike LibreOffice, which
 * mangles embedded raster images on .pptx→pdf (RGBA alpha treated as a mask,
 * PNG/JPEG silently flattened to blank grayscale). So for decks we render the
 * faithful `.preview.html` mirror here instead of shelling out to soffice.
 */
async function htmlToPdf(absHtml: string, absOut: string, slides: boolean, pageSize: string): Promise<string | null> {
  let pw: any;
  try {
    pw = await import('playwright');
  } catch {
    return 'PDF rendering needs Playwright/Chromium, which is not available here.';
  }
  let browser: any;
  try {
    browser = await pw.chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const ctxb = await browser.newContext();
    const page = await ctxb.newPage();
    await page.goto(`file://${absHtml}`, { waitUntil: 'networkidle', timeout: 30_000 });
    const pdfOpts: any = { path: absOut, printBackground: true, preferCSSPageSize: true };
    if (slides) {
      pdfOpts.landscape = true;
      pdfOpts.width = '13.333in';
      pdfOpts.height = '7.5in';
    } else {
      pdfOpts.format = pageSize === 'Letter' ? 'Letter' : 'A4';
    }
    await page.pdf(pdfOpts);
  } catch (e: any) {
    return `render failed — ${e?.message ?? e}`;
  } finally {
    try {
      await browser?.close();
    } catch {}
  }
  return null;
}

/** LibreOffice fallback for plain office docs (text-only docs convert fine). */
function sofficeToPdf(absIn: string, absOut: string): Promise<string | null> {
  return new Promise((resolve) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-conv-'));
    execFile(
      'soffice',
      ['--headless', '--convert-to', 'pdf', '--outdir', tmp, absIn],
      { timeout: 120_000 },
      (err) => {
        if (err) {
          resolve(`LibreOffice conversion failed — ${err.message}`);
          return;
        }
        const produced = path.join(tmp, path.basename(absIn).replace(/\.[^.]+$/, '.pdf'));
        if (!fs.existsSync(produced)) {
          resolve('LibreOffice produced no PDF.');
          return;
        }
        try {
          fs.copyFileSync(produced, absOut);
          fs.rmSync(tmp, { recursive: true, force: true });
          resolve(null);
        } catch (e: any) {
          resolve(`could not move the PDF — ${e?.message ?? e}`);
        }
      },
    );
  });
}

const SOFFICE_EXTS = new Set(['.docx', '.doc', '.xlsx', '.xls', '.csv', '.odt', '.ods', '.odp', '.rtf', '.pptx', '.ppt']);

export const convertDocumentTool: ToolDef = {
  name: 'convert_document',
  description:
    'Convert a workspace document to a print-quality PDF. Routes intelligently for fidelity:\n' +
    '• A deck (.pptx) is converted via its sibling `.preview.html` (the faithful HTML mirror that ' +
    'generate_pptx writes) rendered with headless Chromium — inline-SVG charts and images come out ' +
    'crisp. NEVER shell out to `soffice` for a deck: LibreOffice mangles embedded chart images to blank.\n' +
    '• A self-contained .html file is rendered with Chromium (use layout="slides" for a 16:9 deck HTML, ' +
    'otherwise a portrait document).\n' +
    '• Plain office docs (.docx/.xlsx/.csv) fall back to LibreOffice, which handles text/tables well.\n' +
    'Output PDF is saved in the workspace and offered as a download.',
  parameters: {
    type: 'object',
    properties: {
      input: { type: 'string', description: 'Workspace path to the source file (.pptx, .html, .docx, .xlsx, …).' },
      output: { type: 'string', description: 'Output PDF filename. Defaults to the input name with a .pdf extension.' },
      layout: {
        type: 'string',
        enum: ['auto', 'document', 'slides'],
        description: 'For HTML input: slides = 16:9 landscape deck, document = portrait. auto (default) detects a deck.',
      },
      page_size: { type: 'string', enum: ['A4', 'Letter'], description: 'Document page size (default A4).' },
    },
    required: ['input'],
  },
  modes: ['code', 'report'],
  summarize: (a) => `convert ${String(a.input ?? '')} → pdf`,
  async run(args, ctx) {
    let absIn: string;
    try {
      absIn = resolveInWorkspace(ctx.repoDir, String(args.input ?? ''));
    } catch (e: any) {
      return `Error: ${e?.message ?? e}`;
    }
    if (!fs.existsSync(absIn)) return `Error: ${args.input} not found in the workspace.`;

    const ext = path.extname(absIn).toLowerCase();
    const base = path.basename(absIn).replace(/\.[^.]+$/, '');
    const outName = String(args.output || `${base}.pdf`).replace(/[^a-zA-Z0-9._-]/g, '-');
    const finalName = outName.toLowerCase().endsWith('.pdf') ? outName : `${outName}.pdf`;
    let absOut: string;
    try {
      absOut = resolveInWorkspace(ctx.repoDir, finalName);
    } catch (e: any) {
      return `Error: ${e?.message ?? e}`;
    }
    const pageSize = String(args.page_size || 'A4');
    let usedPath = '';
    let err: string | null = null;

    if (ext === '.html' || ext === '.htm') {
      const slides = args.layout === 'slides' || (args.layout !== 'document' && /\.preview\.html$/i.test(absIn));
      usedPath = 'Chromium (HTML)';
      err = await htmlToPdf(absIn, absOut, slides, pageSize);
    } else if (ext === '.pptx' || ext === '.ppt') {
      // Prefer the faithful preview.html mirror; only soffice if there is none.
      const preview = absIn.replace(/\.pptx?$/i, '.preview.html');
      if (fs.existsSync(preview)) {
        usedPath = 'Chromium (deck preview)';
        err = await htmlToPdf(preview, absOut, true, pageSize);
      } else {
        usedPath = 'LibreOffice (no preview.html found)';
        err = await sofficeToPdf(absIn, absOut);
      }
    } else if (SOFFICE_EXTS.has(ext)) {
      usedPath = 'LibreOffice';
      err = await sofficeToPdf(absIn, absOut);
    } else {
      return `Error: don't know how to convert "${ext}" to PDF. Supported: .pptx, .html, .docx, .xlsx, .csv.`;
    }

    if (err) return `Error: ${err}`;
    const sz = fs.existsSync(absOut) ? fs.statSync(absOut).size : 0;
    if (sz < 1000) return `Error: the converted PDF looks empty (${sz} bytes) — check the source file.`;
    return `Converted ${args.input} → ${finalName} (${Math.round(sz / 1024)} KB) via ${usedPath}. Saved in the workspace and offered as a download.`;
  },
};
