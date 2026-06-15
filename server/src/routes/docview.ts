import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import type { FastifyInstance } from 'fastify';
import * as store from '../sessions/store';
import { repoDir } from '../sessions/workspace';
import { resolveInWorkspace } from '../agent/tools/common';

/** A clean, on-brand HTML shell so spreadsheet/doc previews look designed. */
export const SHELL = (body: string, title = 'Preview') => `<!doctype html><html><head><meta charset="utf-8">
<title>${title}</title><style>
:root{--ink:#16181d;--muted:#6b7280;--line:#e7e6e2;--surface:#f7f7f5;--accent:#4f46e5}
*{box-sizing:border-box}
body{margin:0;padding:26px;background:#fff;color:var(--ink);font-size:14px;line-height:1.55;
  font-family:'Inter',-apple-system,'Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased}
h1{font-size:24px} h2{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:20px 0 8px}
p,li{max-width:72ch}
table{border-collapse:collapse;width:100%;margin:0 0 18px;font-size:13px}
table td,table th{border:1px solid var(--line);padding:6px 10px;text-align:left;font-variant-numeric:tabular-nums}
table tr:first-child td{background:var(--surface);font-weight:600}
table tbody tr:nth-child(even){background:#fafaf9}
img{max-width:100%}
</style></head><body>${body}</body></html>`;

/**
 * Render a workspace .xlsx/.csv/.docx file to a styled HTML string (SheetJS / mammoth),
 * or null for an unsupported type. Shared by the docview HTTP route AND the deliverable
 * visual-QC module (so a doc/sheet can be screenshotted + design-reviewed). Throws on a
 * corrupt file (the caller decides how to surface it).
 */
export async function renderDocHtml(abs: string): Promise<{ html: string; title: string } | null> {
  const ext = path.extname(abs).toLowerCase();
  const title = path.basename(abs);
  if (ext === '.xlsx' || ext === '.xls' || ext === '.csv') {
    const wb = XLSX.read(fs.readFileSync(abs), { type: 'buffer' });
    const parts = wb.SheetNames.map((n) => `<h2>${n}</h2>` + XLSX.utils.sheet_to_html(wb.Sheets[n]));
    return { html: SHELL(parts.join('\n'), title), title };
  }
  if (ext === '.docx') {
    const mammoth = await import('mammoth');
    const convert = (mammoth as any).convertToHtml ?? (mammoth as any).default?.convertToHtml;
    const r = await convert({ path: abs });
    return { html: SHELL(r.value, title), title };
  }
  if (ext === '.pptx') {
    // generate_pptx emits a faithful slide-by-slide HTML mirror alongside the .pptx.
    const preview = abs.replace(/\.pptx$/i, '.preview.html');
    if (fs.existsSync(preview)) return { html: fs.readFileSync(preview, 'utf8'), title };
    return { html: SHELL('<p>Download the .pptx to view it in PowerPoint/Keynote/Slides.</p>', title), title };
  }
  return null;
}

export function registerDocviewRoutes(app: FastifyInstance) {
  app.get('/api/sessions/:id/docview/*', async (req, reply) => {
    const { id } = req.params as { id: string };
    const rel = (req.params as Record<string, string>)['*'] ?? '';
    if (!(await store.getSession(id))) return reply.code(404).send({ error: 'Not found' });
    let abs: string;
    try {
      abs = resolveInWorkspace(repoDir(id), rel);
    } catch {
      return reply.code(403).send('Forbidden');
    }
    if (!fs.existsSync(abs)) return reply.code(404).type('text/html').send(SHELL('<p>File not found.</p>'));
    try {
      const rendered = await renderDocHtml(abs);
      if (!rendered) {
        return reply
          .code(415)
          .type('text/html')
          .send(SHELL('<p>No inline preview for this file type — download it instead.</p>'));
      }
      return reply.type('text/html').send(rendered.html);
    } catch (e: any) {
      return reply.type('text/html').send(SHELL(`<p>Could not render preview: ${String(e?.message ?? e)}</p>`));
    }
  });
}
