import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../../config';
import { resolveInWorkspace, type ToolDef } from './common';

// Editorial identity (same typefaces as the reports): Source Serif 4 for the
// display/headings, Inter for body. Embedded into the .docx so it renders that
// way everywhere — Word/LibreOffice honour the embed; Google Docs substitutes
// but the bold flags below keep the hierarchy intact. Falls back to a clean
// system stack if the TTFs are ever missing, so generation never breaks.
const DOC_FONTS_DIR = path.join(repoRoot, 'server', 'assets', 'report-fonts');
function loadEmbedFonts(): { fonts: Array<{ name: string; data: Buffer }>; display: string; body: string } {
  try {
    const inter = fs.readFileSync(path.join(DOC_FONTS_DIR, 'Inter-Regular.ttf'));
    const serif = fs.readFileSync(path.join(DOC_FONTS_DIR, 'SourceSerif4-Regular.ttf'));
    return {
      fonts: [
        { name: 'Inter', data: inter },
        { name: 'Source Serif 4', data: serif },
      ],
      display: 'Source Serif 4',
      body: 'Inter',
    };
  } catch {
    return { fonts: [], display: 'Georgia', body: 'Calibri' };
  }
}

type BlockType = 'heading' | 'subheading' | 'paragraph' | 'bullets' | 'numbered' | 'table' | 'quote' | 'spacer';
interface Block {
  type: BlockType;
  text?: string;
  items?: string[];
  header?: string[];
  rows?: string[][];
}

/** Normalise "#4f46e5"/"4f46e5" to a 6-hex docx colour (no leading #). */
function hex6(c: string | undefined, fallback: string): string {
  const h = String(c || '').replace('#', '').trim();
  return /^[0-9a-fA-F]{6}$/.test(h) ? h.toUpperCase() : fallback;
}

/**
 * Generate a clean, editable Word (.docx) document from a high-level block spec,
 * styled to match ArksAI's minimal/typographic aesthetic (clear hierarchy, brand
 * accent on headings, real tables). For when the user wants an editable document
 * rather than a print-locked PDF.
 */
export const generateDocTool: ToolDef = {
  name: 'generate_doc',
  description:
    'Create a polished, editable Word (.docx) document from a high-level block spec — title, headings, ' +
    'paragraphs, bullet/numbered lists, tables and quotes — with consistent typography and a brand ' +
    'accent on headings. Use this when the deliverable is an editable document (vs a print-locked PDF ' +
    'via render_report). The file is offered to the user as a download and can be previewed in the canvas. ' +
    'DESIGN STANDARDS (editorial, not "office default"): the editorial typefaces are embedded for you ' +
    '(Source Serif 4 display + Inter body) — lean on a clear hierarchy (kicker/subheading → heading → body), ' +
    'accent on headings ONLY, generous spacing, real structured tables (not walls of text), and a comfortable ' +
    'reading measure. The output is re-opened + design-reviewed — a sloppy/blind document is sent back to fix.',
  parameters: {
    type: 'object',
    properties: {
      output: { type: 'string', description: 'Output filename, e.g. "brief.docx". Default document.docx.' },
      title: { type: 'string', description: 'Document title (rendered as the cover heading).' },
      subtitle: { type: 'string', description: 'Optional subtitle / byline under the title.' },
      accent: { type: 'string', description: 'Accent colour as hex (e.g. "#4f46e5"); used on headings.' },
      blocks: {
        type: 'array',
        description: 'Ordered content blocks.',
        items: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              enum: ['heading', 'subheading', 'paragraph', 'bullets', 'numbered', 'table', 'quote', 'spacer'],
            },
            text: { type: 'string', description: 'Text for heading/subheading/paragraph/quote.' },
            items: { type: 'array', items: { type: 'string' }, description: 'Items for bullets/numbered.' },
            header: { type: 'array', items: { type: 'string' }, description: 'Table header cells.' },
            rows: {
              type: 'array',
              items: { type: 'array', items: { type: 'string' } },
              description: 'Table body rows (each an array of cell strings).',
            },
          },
          required: ['type'],
        },
      },
    },
    required: ['blocks'],
  },
  modes: ['code', 'report'],
  summarize: (a) => `doc ${String(a.output ?? 'document.docx')}`,
  async run(args, ctx) {
    const outName = String(args.output || 'document.docx').replace(/[^a-zA-Z0-9._-]/g, '-');
    const finalName = outName.toLowerCase().endsWith('.docx') ? outName : `${outName}.docx`;
    const blocks: Block[] = Array.isArray(args.blocks) ? args.blocks : [];
    if (!blocks.length && !args.title) return 'Error: provide a title and/or at least one content block.';

    let absOut: string;
    try {
      absOut = resolveInWorkspace(ctx.repoDir, finalName);
    } catch (e: any) {
      return `Error: ${e?.message ?? e}`;
    }

    let docx: any;
    try {
      docx = await import('docx');
    } catch {
      return 'Error: the docx library is not available in this environment.';
    }
    const {
      Document,
      Packer,
      Paragraph,
      TextRun,
      HeadingLevel,
      AlignmentType,
      Table,
      TableRow,
      TableCell,
      WidthType,
      BorderStyle,
      ShadingType,
    } = docx;

    const accent = hex6(args.accent, '4F46E5');
    const { fonts: embedFonts, display: DISPLAY, body: BODY } = loadEmbedFonts();
    const children: any[] = [];

    if (args.title) {
      children.push(
        new Paragraph({
          spacing: { after: args.subtitle ? 60 : 240 },
          children: [new TextRun({ text: String(args.title), bold: true, size: 52, font: DISPLAY, color: '16181D' })],
        }),
      );
      if (args.subtitle) {
        children.push(
          new Paragraph({
            spacing: { after: 280 },
            children: [new TextRun({ text: String(args.subtitle), size: 24, font: BODY, color: '6B7280' })],
          }),
        );
      }
    }

    const para = (text: string, opts: any = {}) =>
      new Paragraph({
        spacing: { after: 140, line: 300 },
        children: [new TextRun({ text, font: BODY, size: 22, color: '16181D', ...opts })],
      });

    for (const b of blocks) {
      switch (b.type) {
        case 'heading':
          children.push(
            new Paragraph({
              heading: HeadingLevel.HEADING_1,
              spacing: { before: 260, after: 120 },
              children: [new TextRun({ text: String(b.text || ''), bold: true, size: 30, font: DISPLAY, color: accent })],
            }),
          );
          break;
        case 'subheading':
          children.push(
            new Paragraph({
              heading: HeadingLevel.HEADING_2,
              spacing: { before: 180, after: 90 },
              children: [new TextRun({ text: String(b.text || ''), bold: true, size: 24, font: DISPLAY, color: '16181D' })],
            }),
          );
          break;
        case 'paragraph':
          children.push(para(String(b.text || '')));
          break;
        case 'quote':
          children.push(
            new Paragraph({
              spacing: { before: 120, after: 160, line: 300 },
              indent: { left: 360 },
              border: { left: { style: BorderStyle.SINGLE, size: 18, space: 12, color: accent } },
              children: [new TextRun({ text: String(b.text || ''), italics: true, size: 22, font: BODY, color: '374151' })],
            }),
          );
          break;
        case 'bullets':
        case 'numbered':
          for (const item of b.items || []) {
            children.push(
              new Paragraph({
                spacing: { after: 70, line: 290 },
                bullet: b.type === 'bullets' ? { level: 0 } : undefined,
                numbering: b.type === 'numbered' ? { reference: 'arksai-num', level: 0 } : undefined,
                children: [new TextRun({ text: String(item), font: BODY, size: 22, color: '16181D' })],
              }),
            );
          }
          break;
        case 'table': {
          const header = b.header || [];
          const rows = b.rows || [];
          const cell = (txt: string, kind: 'head' | 'plain' | 'zebra') =>
            new TableCell({
              shading:
                kind === 'head'
                  ? { type: ShadingType.SOLID, color: accent, fill: accent }
                  : kind === 'zebra'
                    ? { type: ShadingType.SOLID, color: 'F7F7F5', fill: 'F7F7F5' }
                    : undefined,
              margins: { top: 60, bottom: 60, left: 100, right: 100 },
              children: [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: String(txt ?? ''),
                      font: BODY,
                      size: 20,
                      bold: kind === 'head',
                      color: kind === 'head' ? 'FFFFFF' : '16181D',
                    }),
                  ],
                }),
              ],
            });
          const trs: any[] = [];
          if (header.length) trs.push(new TableRow({ tableHeader: true, children: header.map((h) => cell(h, 'head')) }));
          rows.forEach((r, i) => {
            const values = header.length ? header.map((_h, ci) => r[ci] ?? '') : r;
            const kind = i % 2 === 1 ? 'zebra' : 'plain';
            trs.push(new TableRow({ children: values.map((c) => cell(String(c), kind)) }));
          });
          children.push(
            new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              borders: {
                top: { style: BorderStyle.SINGLE, size: 2, color: 'E7E6E2' },
                bottom: { style: BorderStyle.SINGLE, size: 2, color: 'E7E6E2' },
                left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
                right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
                insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: 'EDEDEA' },
                insideVertical: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
              },
              rows: trs,
            }),
          );
          children.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
          break;
        }
        case 'spacer':
          children.push(new Paragraph({ spacing: { after: 160 }, children: [] }));
          break;
      }
    }

    try {
      const doc = new Document({
        creator: 'ArksAI',
        ...(embedFonts.length ? { fonts: embedFonts } : {}),
        numbering: {
          config: [
            {
              reference: 'arksai-num',
              levels: [{ level: 0, format: 'decimal', text: '%1.', alignment: AlignmentType.START }],
            },
          ],
        },
        sections: [{ properties: { page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } }, children }],
      });
      const buf = await Packer.toBuffer(doc);
      fs.writeFileSync(absOut, buf);
    } catch (e: any) {
      return `Error: failed to build the document — ${e?.message ?? e}`;
    }

    // Validate: confirm it's a non-trivial OOXML (zip) file.
    try {
      const buf = fs.readFileSync(absOut);
      if (buf.length < 500 || buf[0] !== 0x50 || buf[1] !== 0x4b) {
        return `Error: the written .docx looks invalid (${buf.length} bytes).`;
      }
    } catch (e: any) {
      return `Error: wrote the file but could not validate it — ${e?.message ?? e}`;
    }

    const sz = fs.statSync(absOut).size;
    return `Generated ${finalName} (${Math.round(sz / 1024)} KB) — styled and editable. Offered as a download; the canvas can preview it.`;
  },
};
