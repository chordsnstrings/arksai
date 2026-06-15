import fs from 'node:fs';
import { resolveInWorkspace, type ToolDef } from './common';

/** Normalise "#4f46e5"/"4f46e5" → 6-hex (no #), PptxGenJS colour form. */
function hex6(c: string | undefined, fallback: string): string {
  const h = String(c || '').replace('#', '').trim();
  return /^[0-9a-fA-F]{6}$/.test(h) ? h.toUpperCase() : fallback;
}
const esc = (s: unknown) => String(s ?? '').replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]!));

type SlideLayout = 'title' | 'section' | 'bullets' | 'two-col' | 'stat' | 'quote' | 'table' | 'chart' | 'image';
interface Slide {
  layout: SlideLayout;
  title?: string;
  subtitle?: string;
  kicker?: string;
  bullets?: string[];
  left?: string[];
  right?: string[];
  leftTitle?: string;
  rightTitle?: string;
  stats?: { value: string; label: string }[];
  quote?: string;
  attribution?: string;
  header?: string[];
  rows?: string[][];
  chartType?: 'bar' | 'line' | 'pie';
  categories?: string[];
  series?: { name: string; values: number[] }[];
  image?: string;
  notes?: string;
}

const DISPLAY = 'Source Serif 4'; // editorial display (same identity as reports/docx)
const BODY = 'Inter';
const INK = '14161B';
const MUTED = '6B7280';

/**
 * Generate a real, editable PowerPoint (.pptx) — a 16:9 deck with an editorial,
 * typography-first look (Source Serif 4 display + Inter body, one restrained accent,
 * flat on-palette charts). For when the user wants a deck they can open and edit in
 * PowerPoint/Keynote/Google Slides (vs a print-locked PDF via render_report).
 */
export const generatePptxTool: ToolDef = {
  name: 'generate_pptx',
  description:
    'Create a polished, EDITABLE PowerPoint (.pptx) 16:9 deck from a high-level slide spec — ' +
    'title, section, bullets, two-col, stat, quote, table, chart, and image layouts — with an ' +
    'editorial typography-first design (Source Serif 4 + Inter, one restrained accent, flat charts). ' +
    'Use for an editable deck; use render_report layout:slides for a print-locked PDF deck. The file ' +
    'is offered as a download and previewable in the canvas. Design: one idea per slide, ≤6 bullets, ' +
    'strong title hierarchy, big stat slides, generous margins, the accent only on the key series.',
  parameters: {
    type: 'object',
    properties: {
      output: { type: 'string', description: 'Output filename, e.g. "pitch.pptx". Default deck.pptx.' },
      title: { type: 'string', description: 'Deck title (used for metadata).' },
      accent: { type: 'string', description: 'Accent colour hex (e.g. "#4f46e5"). Used sparingly.' },
      theme: { type: 'string', enum: ['light', 'dark'], description: 'Light (default) or dark slides.' },
      slides: {
        type: 'array',
        description: 'Ordered slides.',
        items: {
          type: 'object',
          properties: {
            layout: { type: 'string', enum: ['title', 'section', 'bullets', 'two-col', 'stat', 'quote', 'table', 'chart', 'image'] },
            title: { type: 'string' },
            subtitle: { type: 'string' },
            kicker: { type: 'string', description: 'Small eyebrow/overline above the title.' },
            bullets: { type: 'array', items: { type: 'string' } },
            left: { type: 'array', items: { type: 'string' }, description: 'Left column lines (two-col).' },
            right: { type: 'array', items: { type: 'string' }, description: 'Right column lines (two-col).' },
            leftTitle: { type: 'string' },
            rightTitle: { type: 'string' },
            stats: { type: 'array', items: { type: 'object', properties: { value: { type: 'string' }, label: { type: 'string' } } }, description: 'Big stat tiles.' },
            quote: { type: 'string' },
            attribution: { type: 'string' },
            header: { type: 'array', items: { type: 'string' }, description: 'Table header cells.' },
            rows: { type: 'array', items: { type: 'array', items: { type: 'string' } }, description: 'Table body rows.' },
            chartType: { type: 'string', enum: ['bar', 'line', 'pie'] },
            categories: { type: 'array', items: { type: 'string' }, description: 'Chart x-axis categories.' },
            series: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, values: { type: 'array', items: { type: 'number' } } } } },
            image: { type: 'string', description: 'Workspace path to an image for an image slide.' },
            notes: { type: 'string', description: 'Speaker notes.' },
          },
          required: ['layout'],
        },
      },
    },
    required: ['slides'],
  },
  modes: ['code', 'report'],
  summarize: (a) => `pptx ${String(a.output ?? 'deck.pptx')} (${Array.isArray(a.slides) ? a.slides.length : 0} slides)`,
  async run(args, ctx) {
    const outName = String(args.output || 'deck.pptx').replace(/[^a-zA-Z0-9._-]/g, '-');
    const finalName = outName.toLowerCase().endsWith('.pptx') ? outName : `${outName}.pptx`;
    const slides: Slide[] = Array.isArray(args.slides) ? args.slides : [];
    if (!slides.length) return 'Error: provide at least one slide.';

    let absOut: string;
    try {
      absOut = resolveInWorkspace(ctx.repoDir, finalName);
    } catch (e: any) {
      return `Error: ${e?.message ?? e}`;
    }

    let PptxGenJS: any;
    try {
      PptxGenJS = (await import('pptxgenjs')).default ?? (await import('pptxgenjs'));
    } catch {
      return 'Error: the pptxgenjs library is not available in this environment.';
    }

    const accent = hex6(args.accent, '4F46E5');
    const dark = args.theme === 'dark';
    const bg = dark ? '14161B' : 'FFFFFF';
    const ink = dark ? 'ECEEF2' : INK;
    const muted = dark ? '9AA1AD' : MUTED;
    const surface = dark ? '1C1F25' : 'F7F7F5';

    const pptx = new PptxGenJS();
    pptx.defineLayout({ name: 'ARKS_WIDE', width: 13.333, height: 7.5 });
    pptx.layout = 'ARKS_WIDE';
    pptx.author = 'ArksAI';
    if (args.title) pptx.title = String(args.title);
    const M = 0.85; // generous side margin (in)
    const CW = 13.333 - 2 * M; // content width

    const kicker = (s: any, text: string, y = 0.7) =>
      s.addText(String(text).toUpperCase(), { x: M, y, w: CW, h: 0.3, fontFace: BODY, fontSize: 11, bold: true, color: accent, charSpacing: 2 });

    for (const sl of slides) {
      const s = pptx.addSlide();
      s.background = { color: bg };
      if (sl.notes) s.addNotes(String(sl.notes));

      switch (sl.layout) {
        case 'title': {
          if (sl.kicker) s.addText(String(sl.kicker).toUpperCase(), { x: M, y: 2.7, w: CW, h: 0.4, align: 'center', fontFace: BODY, fontSize: 13, bold: true, color: accent, charSpacing: 2 });
          s.addText(String(sl.title || ''), { x: M, y: 3.1, w: CW, h: 1.6, align: 'center', fontFace: DISPLAY, fontSize: 44, bold: true, color: ink });
          s.addShape(pptx.ShapeType.line, { x: 13.333 / 2 - 0.5, y: 4.85, w: 1, h: 0, line: { color: accent, width: 2.5 } });
          if (sl.subtitle) s.addText(String(sl.subtitle), { x: M + 1.5, y: 5.0, w: CW - 3, h: 1, align: 'center', fontFace: BODY, fontSize: 16, color: muted, lineSpacingMultiple: 1.3 });
          break;
        }
        case 'section': {
          if (sl.kicker) kicker(s, sl.kicker, 3.0);
          s.addText(String(sl.title || ''), { x: M, y: 3.3, w: CW, h: 1.2, fontFace: DISPLAY, fontSize: 36, bold: true, color: ink });
          if (sl.subtitle) s.addText(String(sl.subtitle), { x: M, y: 4.5, w: CW, h: 1, fontFace: BODY, fontSize: 15, color: muted, lineSpacingMultiple: 1.3 });
          break;
        }
        case 'bullets': {
          if (sl.kicker) kicker(s, sl.kicker);
          s.addText(String(sl.title || ''), { x: M, y: 1.0, w: CW, h: 0.9, fontFace: DISPLAY, fontSize: 30, bold: true, color: ink });
          const items = (sl.bullets || []).slice(0, 7).map((b) => ({ text: String(b), options: { bullet: { code: '2022', indent: 18 }, color: ink, fontFace: BODY, fontSize: 18, paraSpaceAfter: 10 } }));
          if (items.length) s.addText(items as any, { x: M, y: 2.1, w: CW, h: 4.8, lineSpacingMultiple: 1.2, valign: 'top' });
          break;
        }
        case 'two-col': {
          if (sl.kicker) kicker(s, sl.kicker);
          s.addText(String(sl.title || ''), { x: M, y: 1.0, w: CW, h: 0.9, fontFace: DISPLAY, fontSize: 30, bold: true, color: ink });
          const colW = (CW - 0.6) / 2;
          const col = (x: number, t: string | undefined, lines: string[] | undefined) => {
            if (t) s.addText(String(t), { x, y: 2.1, w: colW, h: 0.4, fontFace: BODY, fontSize: 13, bold: true, color: accent });
            const items = (lines || []).map((b) => ({ text: String(b), options: { bullet: { code: '2022' }, color: ink, fontFace: BODY, fontSize: 16, paraSpaceAfter: 8 } }));
            if (items.length) s.addText(items as any, { x, y: 2.55, w: colW, h: 4.3, valign: 'top' });
          };
          col(M, sl.leftTitle, sl.left);
          col(M + colW + 0.6, sl.rightTitle, sl.right);
          break;
        }
        case 'stat': {
          if (sl.kicker) kicker(s, sl.kicker);
          if (sl.title) s.addText(String(sl.title), { x: M, y: 1.0, w: CW, h: 0.9, fontFace: DISPLAY, fontSize: 30, bold: true, color: ink });
          const stats = (sl.stats || []).slice(0, 4);
          const n = Math.max(stats.length, 1);
          const gap = 0.4;
          const tileW = (CW - gap * (n - 1)) / n;
          stats.forEach((st, i) => {
            const x = M + i * (tileW + gap);
            s.addShape(pptx.ShapeType.rect, { x, y: 2.6, w: tileW, h: 2.4, fill: { color: surface }, line: { color: surface } });
            s.addText(String(st.value), { x, y: 2.9, w: tileW, h: 1.1, align: 'center', fontFace: DISPLAY, fontSize: 40, bold: true, color: ink });
            s.addText(String(st.label).toUpperCase(), { x: x + 0.1, y: 4.0, w: tileW - 0.2, h: 0.8, align: 'center', fontFace: BODY, fontSize: 11, color: muted, charSpacing: 1 });
          });
          break;
        }
        case 'quote': {
          s.addText('“', { x: M, y: 1.6, w: 1.5, h: 1.5, fontFace: DISPLAY, fontSize: 90, color: accent });
          s.addText(String(sl.quote || ''), { x: M + 0.4, y: 2.6, w: CW - 0.8, h: 2.8, fontFace: DISPLAY, fontSize: 26, italic: true, color: ink, lineSpacingMultiple: 1.25 });
          if (sl.attribution) s.addText(`— ${sl.attribution}`, { x: M + 0.4, y: 5.5, w: CW - 0.8, h: 0.5, fontFace: BODY, fontSize: 15, bold: true, color: muted });
          break;
        }
        case 'table': {
          if (sl.kicker) kicker(s, sl.kicker);
          if (sl.title) s.addText(String(sl.title), { x: M, y: 1.0, w: CW, h: 0.9, fontFace: DISPLAY, fontSize: 28, bold: true, color: ink });
          const header = sl.header || [];
          const rows = sl.rows || [];
          const body: any[][] = [];
          if (header.length) body.push(header.map((h) => ({ text: String(h), options: { bold: true, color: 'FFFFFF', fill: { color: accent }, fontFace: BODY, fontSize: 13 } })));
          rows.forEach((r, ri) => body.push((header.length ? header.map((_h, ci) => r[ci] ?? '') : r).map((c) => ({ text: String(c), options: { color: ink, fill: { color: ri % 2 ? surface : bg }, fontFace: BODY, fontSize: 12 } }))));
          if (body.length) s.addTable(body as any, { x: M, y: 2.1, w: CW, border: { type: 'solid', color: dark ? '2C313A' : 'E7E6E2', pt: 0.5 }, autoPage: false, valign: 'middle', rowH: 0.45 });
          break;
        }
        case 'chart': {
          if (sl.kicker) kicker(s, sl.kicker);
          if (sl.title) s.addText(String(sl.title), { x: M, y: 1.0, w: CW, h: 0.9, fontFace: DISPLAY, fontSize: 28, bold: true, color: ink });
          const cats = sl.categories || [];
          const series = (sl.series || []).map((se, i) => ({ name: String(se.name), labels: cats, values: se.values || [] }));
          const colors = [accent, '9AA1AD', 'C9CDD4'];
          const type = sl.chartType === 'line' ? pptx.ChartType.line : sl.chartType === 'pie' ? pptx.ChartType.pie : pptx.ChartType.bar;
          if (series.length) {
            s.addChart(type, series as any, {
              x: M, y: 2.1, w: CW, h: 4.6,
              chartColors: colors, showLegend: series.length > 1, legendPos: 'b', legendFontFace: BODY, legendFontSize: 11,
              showValue: sl.chartType !== 'line', dataLabelFontFace: BODY, dataLabelFontSize: 10, dataLabelColor: ink,
              catAxisLabelFontFace: BODY, catAxisLabelFontSize: 11, catAxisLabelColor: muted,
              valAxisHidden: true, valGridLine: { style: 'none' }, catAxisLineShow: false,
              showTitle: false, chartColorsOpacity: 100,
            });
          }
          break;
        }
        case 'image': {
          if (sl.title) s.addText(String(sl.title), { x: M, y: 0.6, w: CW, h: 0.7, fontFace: DISPLAY, fontSize: 24, bold: true, color: ink });
          if (sl.image) {
            try {
              const abs = resolveInWorkspace(ctx.repoDir, String(sl.image));
              if (fs.existsSync(abs)) s.addImage({ path: abs, x: M, y: sl.title ? 1.5 : 0.7, w: CW, h: sl.title ? 5.3 : 6.1, sizing: { type: 'contain', w: CW, h: sl.title ? 5.3 : 6.1 } as any });
            } catch {
              /* skip a bad image path */
            }
          }
          break;
        }
      }
      // quiet running footer
      s.addText(args.title ? String(args.title) : 'ArksAI', { x: M, y: 7.05, w: CW, h: 0.3, fontFace: BODY, fontSize: 8, color: muted, charSpacing: 1 });
    }

    try {
      await pptx.writeFile({ fileName: absOut });
    } catch (e: any) {
      return `Error: failed to build the deck — ${e?.message ?? e}`;
    }

    // Validate: a real .pptx is a zip with a presentation part + slide parts.
    let slideCount = 0;
    try {
      const JSZip: any = (await import('jszip')).default ?? (await import('jszip'));
      const zip = await JSZip.loadAsync(fs.readFileSync(absOut));
      slideCount = Object.keys(zip.files).filter((n: string) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).length;
      if (!zip.file('ppt/presentation.xml') || !slideCount) return `Error: the written .pptx looks invalid (no slides).`;
    } catch (e: any) {
      return `Error: wrote the file but could not validate it — ${e?.message ?? e}`;
    }

    // Emit a faithful HTML preview sibling so the canvas + the visual-QC gate always have
    // something to render (esp. when LibreOffice isn't available for true rendering).
    try {
      writePreviewHtml(absOut.replace(/\.pptx$/i, '.preview.html'), slides, { accent, ink, muted, surface, bg, dark, title: String(args.title || finalName) });
    } catch {
      /* preview is best-effort */
    }

    const sz = fs.statSync(absOut).size;
    return `Generated ${finalName} (${Math.round(sz / 1024)} KB, ${slideCount} slides) — editable, editorial 16:9 deck. Offered as a download; the canvas can preview it.`;
  },
};

/** A faithful slide-by-slide HTML mirror (16:9 tiles) for canvas preview + visual QC. */
function writePreviewHtml(
  abs: string,
  slides: Slide[],
  t: { accent: string; ink: string; muted: string; surface: string; bg: string; dark: boolean; title: string },
): void {
  const tiles = slides
    .map((sl) => {
      let inner = '';
      if (sl.kicker) inner += `<div class="kick">${esc(sl.kicker)}</div>`;
      if (sl.layout === 'title') {
        inner = `<div class="center"><div class="kick" style="text-align:center">${esc(sl.kicker || '')}</div><h1 class="disp" style="font-size:34px">${esc(sl.title)}</h1><div class="rule"></div>${sl.subtitle ? `<p class="muted" style="max-width:60%;margin:14px auto">${esc(sl.subtitle)}</p>` : ''}</div>`;
      } else if (sl.layout === 'quote') {
        inner += `<div class="q">“</div><p class="disp" style="font-size:24px;font-style:italic">${esc(sl.quote)}</p>${sl.attribution ? `<p class="muted">— ${esc(sl.attribution)}</p>` : ''}`;
      } else {
        if (sl.title) inner += `<h2 class="disp">${esc(sl.title)}</h2>`;
        if (sl.bullets?.length) inner += `<ul>${sl.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>`;
        if (sl.layout === 'two-col') inner += `<div class="cols"><div>${sl.leftTitle ? `<div class="ct">${esc(sl.leftTitle)}</div>` : ''}<ul>${(sl.left || []).map((b) => `<li>${esc(b)}</li>`).join('')}</ul></div><div>${sl.rightTitle ? `<div class="ct">${esc(sl.rightTitle)}</div>` : ''}<ul>${(sl.right || []).map((b) => `<li>${esc(b)}</li>`).join('')}</ul></div></div>`;
        if (sl.stats?.length) inner += `<div class="stats">${sl.stats.map((st) => `<div class="tile"><div class="v">${esc(st.value)}</div><div class="l">${esc(st.label)}</div></div>`).join('')}</div>`;
        if (sl.header?.length || sl.rows?.length) {
          const head = sl.header?.length ? `<tr>${sl.header.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>` : '';
          const rows = (sl.rows || []).map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('');
          inner += `<table>${head}${rows}</table>`;
        }
        if (sl.layout === 'chart' && sl.series?.length && sl.categories?.length) {
          const vals = sl.series[0]?.values || [];
          const max = Math.max(1, ...sl.series.flatMap((se) => se.values || []));
          const cols = sl.categories
            .map((c, i) => {
              const v = vals[i] ?? 0;
              const h = Math.round((v / max) * 200);
              return `<div class="bcol"><div class="bval">${esc(v)}</div><div class="bar" style="height:${h}px"></div><div class="blabel">${esc(c)}</div></div>`;
            })
            .join('');
          inner += `<div class="chart">${cols}</div>`;
        }
      }
      return `<div class="slide">${inner}<div class="ft">${esc(t.title)}</div></div>`;
    })
    .join('\n');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(t.title)}</title><style>
    :root{--accent:#${t.accent};--ink:#${t.ink};--muted:#${t.muted};--surface:#${t.surface};--bg:#${t.bg}}
    *{box-sizing:border-box} body{margin:0;padding:24px;background:#e9e7e1;font-family:'Inter',-apple-system,Arial,sans-serif}
    .slide{position:relative;width:960px;height:540px;margin:0 auto 24px;background:var(--bg);color:var(--ink);
      padding:54px 64px;box-shadow:0 4px 24px rgba(0,0,0,.12);border-radius:4px;overflow:hidden}
    .disp{font-family:'Source Serif 4',Georgia,serif;font-weight:700;margin:0 0 14px}
    h2.disp{font-size:30px} h1.disp{margin:6px 0}
    .kick{font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--accent);margin-bottom:10px}
    .center{height:100%;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center}
    .rule{width:54px;height:3px;background:var(--accent);margin:6px auto 0}
    .muted{color:var(--muted)} ul{margin:8px 0;padding-left:22px} li{font-size:18px;margin:0 0 10px;line-height:1.35}
    .cols{display:grid;grid-template-columns:1fr 1fr;gap:36px} .ct{font-size:13px;font-weight:700;color:var(--accent);margin-bottom:6px}
    .stats{display:flex;gap:18px;margin-top:26px} .tile{flex:1;background:var(--surface);border-radius:8px;padding:22px;text-align:center}
    .tile .v{font-family:'Source Serif 4',serif;font-weight:700;font-size:38px} .tile .l{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-top:6px}
    table{border-collapse:collapse;width:100%;margin-top:16px;font-size:14px} th{background:var(--accent);color:#fff;text-align:left;padding:8px 12px}
    td{padding:7px 12px;border-bottom:1px solid var(--surface)} tr:nth-child(even) td{background:var(--surface)}
    .chart{display:flex;align-items:flex-end;gap:28px;height:280px;margin-top:22px;padding:0 8px}
    .bcol{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%}
    .bar{width:60%;max-width:90px;background:var(--accent);border-radius:4px 4px 0 0;min-height:4px}
    .blabel{font-size:13px;color:var(--muted);margin-top:10px} .bval{font-size:14px;font-weight:700;margin-bottom:6px}
    .q{font-family:'Source Serif 4',serif;font-size:70px;color:var(--accent);line-height:.6}
    .ft{position:absolute;left:64px;bottom:20px;font-size:9px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
  </style></head><body>${tiles}</body></html>`;
  fs.writeFileSync(abs, html);
}
