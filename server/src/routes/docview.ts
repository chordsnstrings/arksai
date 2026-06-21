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
:root{--ink:#1a1c22;--soft:#3a3d44;--muted:#5c6270;--line:#e7e6e2;--surface:#f7f7f5;--accent:#44566a}
*{box-sizing:border-box}
body{margin:0;padding:40px 44px;background:#fff;color:var(--ink);font-size:15px;line-height:1.6;
  font-family:'Inter',-apple-system,'Segoe UI','Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased;
  max-width:1100px;margin-inline:auto}
/* Prose gets a comfortable measure; tables (esp. wide sheets) stay full width. */
.docview-body > p,.docview-body > ul,.docview-body > ol,.docview-body > blockquote{max-width:74ch}
h1{font-family:Georgia,'Source Serif 4',serif;font-size:30px;line-height:1.15;letter-spacing:-.01em;margin:0 0 14px;color:#16140f}
h2{font-family:Georgia,'Source Serif 4',serif;font-size:21px;line-height:1.25;margin:30px 0 10px}
h3{font-size:12px;letter-spacing:.09em;text-transform:uppercase;color:var(--muted);font-weight:600;margin:24px 0 8px}
p,li{color:var(--soft)}
p{margin:0 0 14px}
ul,ol{margin:0 0 14px;padding-left:22px}
li{margin:0 0 5px}
strong{color:var(--ink)}
a{color:var(--accent)}
hr{border:0;border-top:1px solid var(--line);margin:24px 0}
table{border-collapse:collapse;width:100%;margin:8px 0 22px;font-size:13.5px}
table td,table th{border:1px solid var(--line);padding:7px 11px;text-align:left;font-variant-numeric:tabular-nums;vertical-align:top}
table th,table tr:first-child td{background:var(--surface);font-weight:600;color:var(--ink)}
table tbody tr:nth-child(even){background:#fafaf9}
img{max-width:100%;border-radius:8px;margin:8px 0}
blockquote{margin:0 0 16px;padding:2px 0 2px 16px;border-left:3px solid var(--accent);color:var(--muted)}
</style></head><body><div class="docview-body">${body}</div></body></html>`;

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
