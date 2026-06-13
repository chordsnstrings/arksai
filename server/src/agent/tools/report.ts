import fs from 'node:fs';
import { resolveInWorkspace, type ToolDef } from './common';

/**
 * Render a self-contained HTML report file to a print-quality PDF with headless
 * Chromium. This is how Report mode turns a designed HTML/CSS document into a
 * polished, downloadable PDF (far better looking than a low-level PDF library).
 */
export const renderReportTool: ToolDef = {
  name: 'render_report',
  description:
    'Render an HTML file in the workspace to a polished, print-quality PDF using headless ' +
    'Chromium. Author the report as a single self-contained HTML file (embedded CSS, inline ' +
    'SVG charts) first, then call this. Use layout "document" for a portrait A4/Letter report ' +
    'or "slides" for a landscape 16:9 deck. The PDF is saved in the workspace and offered to ' +
    'the user as a download. Tip: control exact page size from CSS @page in your HTML.',
  parameters: {
    type: 'object',
    properties: {
      html_path: { type: 'string', description: 'Workspace path to the self-contained HTML file.' },
      output: { type: 'string', description: 'Output PDF filename (e.g. "investor-update.pdf"). Default report.pdf.' },
      layout: {
        type: 'string',
        enum: ['document', 'slides'],
        description: 'document = portrait page; slides = 16:9 landscape deck. Default document.',
      },
      page_size: { type: 'string', enum: ['A4', 'Letter'], description: 'Page size for document layout (default A4).' },
    },
    required: ['html_path'],
  },
  modes: ['report', 'code'],
  summarize: (a) => `render ${String(a.html_path ?? '')}`,
  async run(args, ctx) {
    let absHtml: string;
    let absOut: string;
    const outName = String(args.output || 'report.pdf').replace(/[^a-zA-Z0-9._-]/g, '-');
    const finalName = outName.toLowerCase().endsWith('.pdf') ? outName : `${outName}.pdf`;
    try {
      absHtml = resolveInWorkspace(ctx.repoDir, String(args.html_path ?? ''));
      absOut = resolveInWorkspace(ctx.repoDir, finalName);
    } catch (e: any) {
      return `Error: ${e?.message ?? e}`;
    }
    if (!fs.existsSync(absHtml)) return `Error: ${args.html_path} not found in the workspace.`;

    let pw: any;
    try {
      pw = await import('playwright');
    } catch {
      return 'Error: PDF rendering needs Playwright/Chromium, which is not available here.';
    }
    let browser: any;
    try {
      browser = await pw.chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
      const ctxb = await browser.newContext();
      const page = await ctxb.newPage();
      await page.goto(`file://${absHtml}`, { waitUntil: 'networkidle', timeout: 30_000 });
      const slides = args.layout === 'slides';
      const pdfOpts: any = { path: absOut, printBackground: true, preferCSSPageSize: true };
      if (slides) {
        pdfOpts.landscape = true;
        pdfOpts.width = '13.333in';
        pdfOpts.height = '7.5in';
      } else {
        pdfOpts.format = args.page_size === 'Letter' ? 'Letter' : 'A4';
      }
      await page.pdf(pdfOpts);
    } catch (e: any) {
      return `Error: render failed — ${e?.message ?? e}`;
    } finally {
      try {
        await browser?.close();
      } catch {}
    }
    const sz = fs.existsSync(absOut) ? fs.statSync(absOut).size : 0;
    if (sz < 1000) return `Error: the rendered PDF looks empty (${sz} bytes) — check the HTML.`;
    return `Rendered ${finalName} (${Math.round(sz / 1024)} KB). Saved in the workspace and offered as a download.`;
  },
};
