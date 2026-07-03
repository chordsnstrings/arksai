import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../../config';
import { resolveInWorkspace, type ToolDef } from './common';
import { renderChartPng, chartSize, type ChartArgs } from './chart';

// Editorial identity (same typefaces as the reports): Source Serif 4 for the
// display/headings, Inter for body. Embedded into the .docx so it renders that
// way everywhere — Word/LibreOffice honour the embed; Google Docs substitutes
// but the bold flags below keep the hierarchy intact. Falls back to a clean
// system stack if the TTFs are ever missing, so generation never breaks.
const DOC_FONTS_DIR = path.join(repoRoot, 'server', 'assets', 'report-fonts');
function loadEmbedFonts(): { fonts: Array<{ name: string; data: Buffer }>; display: string; body: string; arabic: string } {
  try {
    const inter = fs.readFileSync(path.join(DOC_FONTS_DIR, 'Inter-Regular.ttf'));
    const serif = fs.readFileSync(path.join(DOC_FONTS_DIR, 'SourceSerif4-Regular.ttf'));
    const fonts = [
      { name: 'Inter', data: inter },
      { name: 'Source Serif 4', data: serif },
    ];
    // Arabic face (the legal follow-up: bilingual documents in eloquent MSA). Optional asset —
    // when present, Arabic-script text renders in a real Naskh instead of a substituted glyph
    // soup; when absent, Word/LibreOffice substitute and the bidi flags still hold the layout.
    let arabic = 'Noto Naskh Arabic';
    try {
      fonts.push({ name: arabic, data: fs.readFileSync(path.join(DOC_FONTS_DIR, 'NotoNaskhArabic-Regular.ttf')) });
    } catch {
      arabic = 'Arial'; // universal Arabic-capable fallback
    }
    return { fonts, display: 'Source Serif 4', body: 'Inter', arabic };
  } catch {
    return { fonts: [], display: 'Georgia', body: 'Calibri', arabic: 'Arial' };
  }
}

/** Arabic-script detection (Arabic + supplements + presentation forms). */
export const ARABIC_RE = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
/** Split text into script segments so Arabic spans get the Arabic face + RTL flags while
 *  Latin spans keep the body face — one paragraph can carry both (bilingual legal docs). */
export function scriptSegments(text: string): { text: string; arabic: boolean }[] {
  const out: { text: string; arabic: boolean }[] = [];
  let cur = '';
  let curArabic: boolean | null = null;
  for (const ch of String(text ?? '')) {
    // Neutral characters (spaces, digits, punctuation) stick to the current segment.
    const isAr: boolean | null = ARABIC_RE.test(ch) ? true : /[A-Za-z]/.test(ch) ? false : curArabic;
    const a: boolean = isAr === null ? false : isAr;
    if (curArabic === null) curArabic = a;
    if (a !== curArabic) {
      if (cur) out.push({ text: cur, arabic: curArabic });
      cur = '';
      curArabic = a;
    }
    cur += ch;
  }
  if (cur) out.push({ text: cur, arabic: curArabic ?? false });
  return out;
}

type BlockType =
  | 'heading'
  | 'subheading'
  | 'heading3'
  | 'paragraph'
  | 'bullets'
  | 'numbered'
  | 'table'
  | 'quote'
  | 'callout'
  | 'image'
  | 'chart'
  | 'spacer';
interface Block {
  type: BlockType;
  text?: string;
  title?: string; // callout heading
  items?: string[];
  header?: string[];
  rows?: string[][];
  chart?: ChartArgs;
  caption?: string;
  path?: string; // image: workspace path
  width?: number; // image display width in px (default 480)
}
interface Kpi {
  value: string;
  label: string;
}
interface Cover {
  masthead?: string;
  eyebrow?: string;
  title: string;
  accentLine?: string;
  thesis?: string;
  kpis?: Kpi[];
  meta?: { coverage?: string; source?: string; preparedBy?: string; date?: string };
  confidential?: boolean;
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
    'reading measure. The output is re-opened + design-reviewed — a sloppy/blind document is sent back to fix. ' +
    'For a report/brief, pass a `cover` (masthead + accent title + thesis + a KPI band of headline numbers + ' +
    'a metadata footer) for a designed cover page, and use `chart` blocks ({type:"chart", chart:{…}}) for ' +
    'publication-grade data-viz (dual_axis/heatmap/line/bar) instead of describing numbers in prose. ' +
    'BRAND: if the user provided a LOGO, run extract_palette on it to take the accent from the brand and place the logo on the ' +
    'cover/header; otherwise pick ONE deliberately beautiful palette — consistent with their other deliverables.',
  parameters: {
    type: 'object',
    properties: {
      output: { type: 'string', description: 'Output filename, e.g. "brief.docx". Default document.docx.' },
      title: { type: 'string', description: 'Document title (rendered as the cover heading).' },
      subtitle: { type: 'string', description: 'Optional subtitle / byline under the title.' },
      accent: { type: 'string', description: 'Accent colour as hex (e.g. "#4f46e5"); used on headings.' },
      toc: { type: 'boolean', description: 'Insert a Table of Contents (built from heading/subheading blocks) after the cover — use for any document over ~4 sections.' },
      orientation: { type: 'string', enum: ['portrait', 'landscape'], description: 'Page orientation (default portrait). Landscape for wide tables/schedules.' },
      footer_text: { type: 'string', description: 'Short running footer line (defaults to the title). Page numbers are added automatically on multi-section documents.' },
      logo: { type: 'string', description: 'Workspace path to a logo image — placed at the top of the cover.' },
      cover: {
        type: 'object',
        description: 'Optional DESIGNED COVER PAGE (recommended for reports/briefs): masthead, accent title line, one-line thesis, a KPI band of headline numbers, and a metadata footer — then a page break before the body.',
        properties: {
          masthead: { type: 'string', description: 'A text wordmark / publication line, e.g. "ACME · STRATEGY".' },
          eyebrow: { type: 'string', description: 'Small kicker/eyebrow above the title.' },
          title: { type: 'string', description: 'Cover title.' },
          accentLine: { type: 'string', description: 'Optional second title line, rendered in the accent.' },
          thesis: { type: 'string', description: 'A one-line thesis/positioning statement.' },
          kpis: { type: 'array', items: { type: 'object', properties: { value: { type: 'string' }, label: { type: 'string' } } }, description: '3–5 headline numbers ({value,label}).' },
          meta: { type: 'object', properties: { coverage: { type: 'string' }, source: { type: 'string' }, preparedBy: { type: 'string' }, date: { type: 'string' } }, description: 'Metadata footer fields.' },
          confidential: { type: 'boolean', description: 'Show a CONFIDENTIAL marker.' },
        },
      },
      blocks: {
        type: 'array',
        description: 'Ordered content blocks.',
        items: {
          type: 'object',
          properties: {
            type: {
              type: 'string',
              enum: ['heading', 'subheading', 'heading3', 'paragraph', 'bullets', 'numbered', 'table', 'quote', 'callout', 'image', 'chart', 'spacer'],
            },
            text: { type: 'string', description: 'Text for heading/subheading/heading3/paragraph/quote/callout. Arabic text is detected automatically: it renders right-to-left in an embedded Naskh face (bilingual paragraphs supported), so bilingual legal documents come out properly typeset.' },
            title: { type: 'string', description: 'For a "callout" block: the small bold heading above the callout text.' },
            path: { type: 'string', description: 'For an "image" block: workspace path to a png/jpg to place (centered).' },
            width: { type: 'number', description: 'Image display width in px (default 480).' },
            items: { type: 'array', items: { type: 'string' }, description: 'Items for bullets/numbered.' },
            header: { type: 'array', items: { type: 'string' }, description: 'Table header cells.' },
            rows: {
              type: 'array',
              items: { type: 'array', items: { type: 'string' } },
              description: 'Table body rows (each an array of cell strings).',
            },
            chart: { type: 'object', description: 'For a "chart" block: a render_chart spec — { type:"dual_axis"|"heatmap"|"line"|"bar"|… , data:[…], x, y, y2, series, value, value_labels, title }. Embedded as a publication-grade image.' },
            caption: { type: 'string', description: 'Optional caption shown under a chart block.' },
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
      ImageRun,
      PageBreak,
      Header,
      Footer,
      PageNumber,
      TableOfContents,
      PageOrientation,
    } = docx;

    const accent = hex6(args.accent, '4F46E5');
    const { fonts: embedFonts, display: DISPLAY, body: BODY, arabic: ARABIC } = loadEmbedFonts();
    const children: any[] = [];

    /** Load a workspace image for embedding; returns null (never throws) on any problem. */
    const loadImage = (rel: string): { data: Buffer; type: 'png' | 'jpg'; w: number; h: number } | null => {
      try {
        const abs = resolveInWorkspace(ctx.repoDir, String(rel));
        const data = fs.readFileSync(abs);
        const isPng = data[0] === 0x89 && data[1] === 0x50;
        const isJpg = data[0] === 0xff && data[1] === 0xd8;
        if (!isPng && !isJpg) return null;
        // Dimensions: PNG IHDR / JPEG SOF scan — enough to preserve aspect ratio.
        let w = 480;
        let h = 320;
        if (isPng && data.length > 24) {
          w = data.readUInt32BE(16);
          h = data.readUInt32BE(20);
        } else if (isJpg) {
          for (let i = 2; i + 9 < data.length; ) {
            if (data[i] !== 0xff) break;
            const marker = data[i + 1];
            const len = data.readUInt16BE(i + 2);
            if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
              h = data.readUInt16BE(i + 5);
              w = data.readUInt16BE(i + 7);
              break;
            }
            i += 2 + len;
          }
        }
        return { data, type: isPng ? 'png' : 'jpg', w: Math.max(1, w), h: Math.max(1, h) };
      } catch {
        return null;
      }
    };

    if (args.cover) {
      const cov = args.cover as Cover;
      const COVER_INK = '16181D';
      const noB = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
      // Brand logo above the masthead (scaled to a 42px-high mark).
      if (args.logo) {
        const img = loadImage(String(args.logo));
        if (img) {
          const h = 42;
          const w = Math.max(1, Math.round((img.w / img.h) * h));
          children.push(
            new Paragraph({
              spacing: { after: 160 },
              children: [new ImageRun({ type: img.type === 'png' ? 'png' : 'jpg', data: img.data, transformation: { width: Math.min(w, 220), height: h } })],
            }),
          );
        }
      }
      if (cov.masthead) {
        children.push(
          new Paragraph({
            spacing: { after: 40 },
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, space: 6, color: accent } },
            children: [new TextRun({ text: String(cov.masthead).toUpperCase(), font: BODY, size: 18, bold: true, color: accent, characterSpacing: 30 })],
          }),
        );
      }
      children.push(new Paragraph({ spacing: { after: 520 }, children: [] }));
      if (cov.eyebrow)
        children.push(new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: String(cov.eyebrow).toUpperCase(), font: BODY, size: 20, bold: true, color: accent, characterSpacing: 24 })] }));
      children.push(new Paragraph({ spacing: { after: cov.accentLine ? 20 : 160 }, children: [new TextRun({ text: String(cov.title || ''), font: DISPLAY, size: 60, bold: true, color: COVER_INK })] }));
      if (cov.accentLine)
        children.push(new Paragraph({ spacing: { after: 160 }, children: [new TextRun({ text: String(cov.accentLine), font: DISPLAY, size: 60, bold: true, color: accent })] }));
      if (cov.thesis) children.push(new Paragraph({ spacing: { after: 340 }, children: [new TextRun({ text: String(cov.thesis), font: BODY, size: 26, color: '4B5563' })] }));
      if (cov.kpis?.length) {
        const ks = cov.kpis.slice(0, 5);
        const cells = ks.map(
          (k) =>
            new TableCell({
              width: { size: Math.floor(100 / ks.length), type: WidthType.PERCENTAGE },
              margins: { top: 80, bottom: 40, left: 0, right: 140 },
              borders: { top: { style: BorderStyle.SINGLE, size: 12, color: accent }, bottom: noB, left: noB, right: noB },
              children: [
                new Paragraph({ spacing: { after: 20 }, children: [new TextRun({ text: String(k.value), font: DISPLAY, size: 40, bold: true, color: COVER_INK })] }),
                new Paragraph({ children: [new TextRun({ text: String(k.label).toUpperCase(), font: BODY, size: 16, color: '6B7280', characterSpacing: 16 })] }),
              ],
            }),
        );
        children.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: { top: noB, bottom: noB, left: noB, right: noB, insideHorizontal: noB, insideVertical: noB },
            rows: [new TableRow({ children: cells })],
          }),
        );
      }
      children.push(new Paragraph({ spacing: { after: 1400 }, children: [] }));
      const metaParts = cov.meta
        ? [cov.meta.coverage ? `Coverage ${cov.meta.coverage}` : '', cov.meta.source ? `Source: ${cov.meta.source}` : '', cov.meta.preparedBy ? `Prepared by ${cov.meta.preparedBy}` : '', cov.meta.date || '']
            .filter(Boolean)
            .join('   ·   ')
        : '';
      if (metaParts || cov.confidential) {
        children.push(
          new Paragraph({
            spacing: { before: 80 },
            border: { top: { style: BorderStyle.SINGLE, size: 4, space: 6, color: 'E7E6E2' } },
            children: [
              ...(cov.confidential ? [new TextRun({ text: 'CONFIDENTIAL    ', font: BODY, size: 16, bold: true, color: accent, characterSpacing: 20 })] : []),
              new TextRun({ text: metaParts, font: BODY, size: 16, color: '6B7280' }),
            ],
          }),
        );
      }
      children.push(new Paragraph({ children: [new PageBreak()] }));
    }

    // Table of Contents (built from the heading blocks; Word/LibreOffice populate the field on
    // open — updateFields is enabled on the Document so it fills without a manual refresh).
    if (args.toc === true) {
      children.push(
        new Paragraph({
          spacing: { after: 160 },
          children: [new TextRun({ text: 'Contents', font: DISPLAY, size: 34, bold: true, color: '16181D' })],
        }),
        new TableOfContents('Contents', { hyperlink: true, headingStyleRange: '1-3' }),
        new Paragraph({ children: [new PageBreak()] }),
      );
    }

    if (!args.cover && args.title) {
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

    // Split inline markup into styled runs so the model's <b>/<strong>/<em>/<i> and **bold**
    // become real bold/italic instead of literal tags shown as text (the .docx bug). Any other
    // stray HTML tag is dropped. Arabic-script spans additionally get the embedded Naskh face
    // + right-to-left run flags — one paragraph can be bilingual (the legal-doc requirement).
    const inlineRuns = (text: string, base: any = {}): any[] => {
      const t = String(text ?? "")
        .replace(/<\/?(?:strong|b)\s*>/gi, "[[B]]")
        .replace(/<\/?(?:em|i)\s*>/gi, "[[I]]")
        .replace(/\*\*(.+?)\*\*/g, "[[B]]$1[[B]]")
        .replace(/<[^>]+>/g, "");
      const runs: any[] = [];
      let bold = false, italic = false;
      for (const p of t.split(/(\[\[B\]\]|\[\[I\]\])/)) {
        if (p === "[[B]]") { bold = !bold; continue; }
        if (p === "[[I]]") { italic = !italic; continue; }
        if (!p) continue;
        for (const seg of scriptSegments(p)) {
          runs.push(
            new TextRun({
              font: BODY, size: 22, color: "16181D", ...base,
              text: seg.text,
              bold: bold || !!base.bold,
              italics: italic || !!base.italics,
              ...(seg.arabic ? { font: ARABIC, rightToLeft: true } : {}),
            }),
          );
        }
      }
      return runs.length ? runs : [new TextRun({ font: BODY, size: 22, color: "16181D", ...base, text: "" })];
    };

    // Majority-Arabic text → the PARAGRAPH itself flows right-to-left (alignment + bidi),
    // so an Arabic clause reads correctly instead of left-anchored Latin layout.
    const isRtlText = (text: string): boolean => {
      const s = String(text ?? '');
      const ar = (s.match(new RegExp(ARABIC_RE.source, 'g')) || []).length;
      const latin = (s.match(/[A-Za-z]/g) || []).length;
      return ar > 0 && ar >= latin;
    };
    const rtlProps = (text: string): any => (isRtlText(text) ? { bidirectional: true, alignment: AlignmentType.RIGHT } : {});

    const para = (text: string, opts: any = {}) =>
      new Paragraph({
        spacing: { after: 140, line: 300 },
        ...rtlProps(text),
        children: inlineRuns(text, opts),
      });

    for (const b of blocks) {
      switch (b.type) {
        case 'heading':
          children.push(
            new Paragraph({
              heading: HeadingLevel.HEADING_1,
              spacing: { before: 260, after: 120 },
              ...rtlProps(String(b.text || '')),
              children: inlineRuns(String(b.text || ''), { bold: true, size: 30, font: DISPLAY, color: accent }),
            }),
          );
          break;
        case 'subheading':
          children.push(
            new Paragraph({
              heading: HeadingLevel.HEADING_2,
              spacing: { before: 180, after: 90 },
              ...rtlProps(String(b.text || '')),
              children: inlineRuns(String(b.text || ''), { bold: true, size: 24, font: DISPLAY, color: '16181D' }),
            }),
          );
          break;
        case 'heading3':
          children.push(
            new Paragraph({
              heading: HeadingLevel.HEADING_3,
              spacing: { before: 140, after: 70 },
              ...rtlProps(String(b.text || '')),
              children: inlineRuns(String(b.text || ''), { bold: true, size: 21, font: BODY, color: '374151' }),
            }),
          );
          break;
        case 'callout': {
          // A shaded info box with an accent rule — for key findings / warnings / definitions.
          const inner: any[] = [];
          if (b.title) {
            inner.push(
              new Paragraph({
                spacing: { after: 60 },
                ...rtlProps(String(b.title)),
                children: inlineRuns(String(b.title).toUpperCase(), { bold: true, size: 17, color: accent, characterSpacing: 16 }),
              }),
            );
          }
          inner.push(
            new Paragraph({
              spacing: { line: 290 },
              ...rtlProps(String(b.text || '')),
              children: inlineRuns(String(b.text || ''), { size: 21, color: '1F2937' }),
            }),
          );
          const noBd = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
          children.push(
            new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              borders: { top: noBd, bottom: noBd, right: noBd, insideHorizontal: noBd, insideVertical: noBd, left: { style: BorderStyle.SINGLE, size: 20, color: accent } },
              rows: [
                new TableRow({
                  children: [
                    new TableCell({
                      shading: { type: ShadingType.SOLID, color: 'F6F6F3', fill: 'F6F6F3' },
                      margins: { top: 140, bottom: 140, left: 200, right: 200 },
                      children: inner,
                    }),
                  ],
                }),
              ],
            }),
            new Paragraph({ spacing: { after: 140 }, children: [] }),
          );
          break;
        }
        case 'image': {
          const img = b.path ? loadImage(String(b.path)) : null;
          if (img) {
            const dispW = Math.max(80, Math.min(Number(b.width) || 480, 620));
            const dispH = Math.max(1, Math.round(dispW * (img.h / img.w)));
            children.push(
              new Paragraph({
                spacing: { before: 120, after: b.caption ? 40 : 160 },
                alignment: AlignmentType.CENTER,
                children: [new ImageRun({ type: img.type === 'png' ? 'png' : 'jpg', data: img.data, transformation: { width: dispW, height: dispH } })],
              }),
            );
            if (b.caption) {
              children.push(
                new Paragraph({
                  spacing: { after: 180 },
                  alignment: AlignmentType.CENTER,
                  children: [new TextRun({ text: String(b.caption), font: BODY, size: 18, italics: true, color: '6B7280' })],
                }),
              );
            }
          } else {
            children.push(para(`[image not found: ${String(b.path || '(no path)')}]`, { italics: true, color: '6B7280' }));
          }
          break;
        }
        case 'paragraph':
          children.push(para(String(b.text || '')));
          break;
        case 'quote':
          children.push(
            new Paragraph({
              spacing: { before: 120, after: 160, line: 300 },
              indent: { left: 360 },
              border: { left: { style: BorderStyle.SINGLE, size: 18, space: 12, color: accent } },
              ...rtlProps(String(b.text || '')),
              children: inlineRuns(String(b.text || ''), { italics: true, color: '374151' }),
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
                ...rtlProps(String(item)),
                children: inlineRuns(String(item)),
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
        case 'chart': {
          if (!b.chart) break;
          const png = await renderChartPng({ ...b.chart, accent: `#${accent}` } as ChartArgs);
          if (png) {
            const { width, height } = chartSize(b.chart as ChartArgs);
            const dispW = Math.min(width, 600);
            const dispH = Math.max(1, Math.round(dispW * (height / Math.max(1, width))));
            children.push(
              new Paragraph({
                spacing: { before: 120, after: b.caption ? 40 : 160 },
                alignment: AlignmentType.CENTER,
                children: [new ImageRun({ type: 'png', data: png.png, transformation: { width: dispW, height: dispH } })],
              }),
            );
            if (b.caption) {
              children.push(
                new Paragraph({
                  spacing: { after: 180 },
                  alignment: AlignmentType.CENTER,
                  children: [new TextRun({ text: String(b.caption), font: BODY, size: 18, italics: true, color: '6B7280' })],
                }),
              );
            }
          } else if (b.caption) {
            children.push(para(`[chart unavailable: ${String(b.caption)}]`, { italics: true, color: '6B7280' }));
          }
          break;
        }
        case 'spacer':
          children.push(new Paragraph({ spacing: { after: 160 }, children: [] }));
          break;
      }
    }

    try {
      // Page furniture: a hairline running header (masthead/title) + centred "Page X of Y"
      // footer on every page EXCEPT the cover (titlePage → empty `first` header/footer).
      // Only for documents with real length — a one-page memo stays clean.
      const runningTitle = String(args.footer_text || (args.cover as Cover | undefined)?.masthead || args.title || '').slice(0, 80);
      const wantFurniture = !!args.cover || blocks.length >= 8;
      const furniture = wantFurniture
        ? {
            headers: {
              default: new Header({
                children: [
                  new Paragraph({
                    border: { bottom: { style: BorderStyle.SINGLE, size: 2, space: 4, color: 'E7E6E2' } },
                    children: [new TextRun({ text: runningTitle.toUpperCase(), font: BODY, size: 14, color: '9CA3AF', characterSpacing: 20 })],
                  }),
                ],
              }),
              first: new Header({ children: [] }),
            },
            footers: {
              default: new Footer({
                children: [
                  new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [
                      new TextRun({ text: 'Page ', font: BODY, size: 14, color: '9CA3AF' }),
                      new TextRun({ font: BODY, size: 14, color: '9CA3AF', children: [PageNumber.CURRENT] }),
                      new TextRun({ text: ' of ', font: BODY, size: 14, color: '9CA3AF' }),
                      new TextRun({ font: BODY, size: 14, color: '9CA3AF', children: [PageNumber.TOTAL_PAGES] }),
                    ],
                  }),
                ],
              }),
              first: new Footer({ children: [] }),
            },
          }
        : {};
      const landscape = String(args.orientation || '') === 'landscape';
      const doc = new Document({
        creator: 'ArksAI',
        // TOC fields refresh on open so the contents page is never stale/blank.
        features: { updateFields: args.toc === true },
        ...(embedFonts.length ? { fonts: embedFonts } : {}),
        numbering: {
          config: [
            {
              reference: 'arksai-num',
              levels: [{ level: 0, format: 'decimal', text: '%1.', alignment: AlignmentType.START }],
            },
          ],
        },
        sections: [
          {
            properties: {
              titlePage: wantFurniture ? true : undefined,
              page: {
                margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 },
                ...(landscape ? { size: { orientation: PageOrientation.LANDSCAPE } } : {}),
              },
            },
            ...furniture,
            children,
          },
        ],
      });
      const buf = await Packer.toBuffer(doc);
      fs.writeFileSync(absOut, buf);
    } catch (e: any) {
      return `Error: failed to build the document — ${e?.message ?? e}`;
    }

    // Validate: confirm it's a non-trivial OOXML (zip) file, then RE-OPEN it (mammoth) and
    // check the text actually landed — a structurally-valid but empty document is a failure.
    let words = 0;
    try {
      const buf = fs.readFileSync(absOut);
      if (buf.length < 500 || buf[0] !== 0x50 || buf[1] !== 0x4b) {
        return `Error: the written .docx looks invalid (${buf.length} bytes).`;
      }
      try {
        const mammoth: any = await import('mammoth');
        const extracted = await mammoth.extractRawText({ buffer: buf });
        words = String(extracted?.value || '').split(/\s+/).filter(Boolean).length;
        const expectedText = blocks.some((b) => (b.text && String(b.text).trim()) || b.items?.length || b.rows?.length);
        if (expectedText && words < 3) {
          return 'Error: the document wrote but re-opens EMPTY — the content blocks did not land. Re-send the blocks.';
        }
      } catch {
        /* mammoth unavailable → the zip check above stands alone */
      }
    } catch (e: any) {
      return `Error: wrote the file but could not validate it — ${e?.message ?? e}`;
    }

    const sz = fs.statSync(absOut).size;
    return `Generated ${finalName} (${Math.round(sz / 1024)} KB, ${words ? `${words} words, ` : ''}re-open validated) — styled and editable${args.toc ? ', with a Contents page' : ''}. Offered as a download; the canvas can preview it.`;
  },
};
