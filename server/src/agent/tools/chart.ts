import fs from 'node:fs';
import path from 'node:path';
import { resolveInWorkspace, type ToolDef } from './common';

/**
 * render_chart — publication-grade charts as embeddable SVG, rendered server-side
 * with Vega-Lite → Vega → SVG (no browser, no Python, no native `canvas`). This
 * closes the biggest report-quality gap vs hand-rolled CSS bar-lists: real
 * dual-axis trends, stacked bars and month×year heatmaps that look authored.
 *
 * Our editorial defaults are baked in (flat 2D, transparent background, a muted
 * neutral base with the ACCENT only on the key series, light receding gridlines,
 * Inter labels, direct value labels) so output is on-brand without the model
 * having to specify styling. The SVG is saved to charts/ AND returned so the
 * agent can inline it into the report HTML; the report protocol's `.keep`/`.fig`
 * wrapping keeps it atomic across page breaks automatically.
 *
 * vega + vega-lite are ESM-only and our server is CommonJS, so we load them with a
 * Function-constructed native dynamic import (same trick deliverableCheck uses for
 * mupdf). buildVlSpec is pure + exported for unit tests.
 */

const nativeImport: (s: string) => Promise<any> = new Function('s', 'return import(s)') as any;

export type ChartType =
  | 'line'
  | 'multi_line'
  | 'dual_axis'
  | 'bar'
  | 'bar_h'
  | 'stacked_bar'
  | 'area'
  | 'donut'
  | 'heatmap';

export interface ChartArgs {
  type: ChartType;
  data: Record<string, any>[];
  x?: string;
  y?: string;
  y2?: string;
  series?: string;
  value?: string; // heatmap color field / donut size field
  title?: string;
  x_title?: string;
  y_title?: string;
  y2_title?: string;
  accent?: string;
  value_labels?: boolean;
  width?: number;
  height?: number;
  output?: string;
}

// Editorial palette — flat, restrained; accent only on the key series.
const FONT = 'Inter, system-ui, -apple-system, sans-serif';
const INK = '#1b1b1b';
const MUTED = '#8a8a8a';
const BASE = '#c4c4c4'; // muted neutral for secondary series/bars
const GRID = '#eee9e1'; // faint, warm, receding (matches the ivory report paper)
const DOMAIN = '#d8d2c7';
// Muted categorical ramp for multi-series (accent is prepended at render time).
const CATEGORICAL = ['#7a7a7a', '#b0a99c', '#9ca3a8', '#bfae8e', '#a89a9a'];

function clampHex(h: string | undefined, fallback: string): string {
  const v = String(h ?? '').trim();
  return /^#[0-9a-fA-F]{3,8}$/.test(v) ? v : fallback;
}

function baseConfig(accent: string) {
  return {
    background: null as any,
    font: FONT,
    view: { stroke: null },
    padding: 4,
    axis: {
      domainColor: DOMAIN,
      tickColor: DOMAIN,
      tickSize: 4,
      gridColor: GRID,
      gridWidth: 1,
      labelColor: INK,
      labelFontSize: 11,
      labelPadding: 4,
      titleColor: MUTED,
      titleFontSize: 11,
      titleFontWeight: 600,
      titlePadding: 8,
      labelFont: FONT,
      titleFont: FONT,
    },
    axisX: { grid: false },
    axisY: { grid: true, domain: false, ticks: false },
    legend: {
      labelColor: INK,
      labelFontSize: 11,
      titleColor: MUTED,
      titleFontSize: 11,
      symbolType: 'square',
      labelFont: FONT,
      titleFont: FONT,
      orient: 'top',
      direction: 'horizontal',
    },
    title: {
      color: INK,
      fontSize: 13,
      fontWeight: 600,
      font: FONT,
      anchor: 'start' as const,
      offset: 12,
      subtitleColor: MUTED,
    },
    range: { category: [accent, ...CATEGORICAL] },
  };
}

const labelText = (field: string, fmt?: string) => ({
  mark: { type: 'text' as const, dy: -8, color: INK, fontSize: 10, font: FONT },
  encoding: { text: { field, type: 'quantitative' as const, ...(fmt ? { format: fmt } : {}) } },
});

/**
 * Translate the concise tool args into a full Vega-Lite spec with our editorial
 * defaults applied. Pure (no IO) so it is unit-testable.
 */
export function buildVlSpec(args: ChartArgs): any {
  const accent = clampHex(args.accent, '#c8962a');
  const data = Array.isArray(args.data) ? args.data : [];
  const { width, height } = chartSize(args);
  const x = args.x || 'x';
  const y = args.y || 'y';
  const config = baseConfig(accent);
  const titleObj = args.title ? { text: args.title } : undefined;
  const common: any = { $schema: 'https://vega.github.io/schema/vega-lite/v6.json', width, height, config, data: { values: data } };
  if (titleObj) common.title = titleObj;
  // An unrecognized chart type still produces a (bar) chart rather than failing the request.
  const VALID_CHART = new Set(['bar', 'bar_h', 'stacked_bar', 'area', 'line', 'multi_line', 'dual_axis', 'donut', 'heatmap']);
  const t: any = VALID_CHART.has(args.type as any) ? args.type : 'bar';

  const xEnc = (type: 'nominal' | 'temporal' | 'ordinal' = 'nominal') => ({
    field: x,
    type,
    axis: { title: args.x_title ?? null, labelAngle: 0 },
    ...(type === 'nominal' ? { sort: null } : {}),
  });
  const yEnc = () => ({ field: y, type: 'quantitative', axis: { title: args.y_title ?? null } });

  switch (t) {
    case 'bar':
    case 'bar_h': {
      const horizontal = args.type === 'bar_h';
      const cat = { ...xEnc('nominal'), ...(horizontal ? { axis: { title: args.x_title ?? null } } : {}) };
      const val = yEnc();
      const barLayer = { mark: { type: 'bar', color: accent, cornerRadiusEnd: 1 } };
      const enc = horizontal ? { y: cat, x: val } : { x: cat, y: val };
      const layers: any[] = [{ ...barLayer, encoding: enc }];
      if (args.value_labels) {
        const lbl = labelText(y);
        layers.push({ ...lbl, encoding: { ...enc, ...lbl.encoding } });
      }
      return { ...common, layer: layers };
    }
    case 'stacked_bar': {
      const series = args.series || 'series';
      return {
        ...common,
        mark: { type: 'bar' },
        encoding: {
          x: xEnc('nominal'),
          y: { field: y, type: 'quantitative', stack: 'zero', axis: { title: args.y_title ?? null } },
          color: { field: series, type: 'nominal', legend: { title: null } },
        },
      };
    }
    case 'area': {
      return {
        ...common,
        mark: { type: 'area', line: { color: accent, strokeWidth: 2 }, color: { x1: 1, y1: 1, x2: 1, y2: 0, gradient: 'linear', stops: [ { offset: 0, color: '#ffffff00' }, { offset: 1, color: accent + '33' } ] } },
        encoding: { x: xEnc('nominal'), y: yEnc() },
      };
    }
    case 'line':
    case 'multi_line': {
      const multi = args.type === 'multi_line';
      const series = args.series || 'series';
      const pointMark: any = { type: 'line', point: { filled: true, size: 36, fill: accent }, strokeWidth: 2, color: accent };
      const enc: any = { x: xEnc('nominal'), y: yEnc() };
      if (multi) {
        enc.color = { field: series, type: 'nominal', legend: { title: null } };
        delete pointMark.color;
        delete pointMark.point.fill; // let each series colour its own points
      }
      const layers: any[] = [{ mark: pointMark, encoding: enc }];
      if (args.value_labels && !multi) {
        const lbl = labelText(y);
        layers.push({ ...lbl, encoding: { ...enc, ...lbl.encoding } });
      }
      return { ...common, layer: layers };
    }
    case 'dual_axis': {
      const y2 = args.y2 || 'y2';
      return {
        ...common,
        encoding: { x: xEnc('nominal') },
        layer: [
          {
            mark: { type: 'bar', color: BASE },
            encoding: { y: { field: y, type: 'quantitative', axis: { title: args.y_title ?? null } } },
          },
          {
            mark: { type: 'line', point: { filled: true, size: 38, fill: accent, color: accent }, strokeWidth: 2.5, color: accent },
            encoding: {
              y: { field: y2, type: 'quantitative', axis: { title: args.y2_title ?? null, titleColor: accent }, scale: { zero: false } },
            },
          },
        ],
        resolve: { scale: { y: 'independent' } },
      };
    }
    case 'donut': {
      const series = args.series || 'series';
      const value = args.value || y;
      return {
        ...common,
        mark: { type: 'arc', innerRadius: Math.round(Math.min(width, height) / 5), padAngle: 0.01, stroke: '#fff', strokeWidth: 1 },
        encoding: {
          theta: { field: value, type: 'quantitative', stack: true },
          color: { field: series, type: 'nominal', legend: { title: null } },
          order: { field: value, type: 'quantitative', sort: 'descending' },
        },
        view: { stroke: null },
      };
    }
    case 'heatmap': {
      const value = args.value || 'value';
      const layers: any[] = [
        {
          mark: { type: 'rect' },
          encoding: {
            x: { field: x, type: 'nominal', axis: { title: args.x_title ?? null, labelAngle: 0 }, sort: null },
            y: { field: y, type: 'nominal', axis: { title: args.y_title ?? null }, sort: null },
            color: {
              field: value,
              type: 'quantitative',
              legend: { title: null, gradientLength: 120 },
              scale: { range: ['#f5efe4', accent] },
            },
          },
        },
      ];
      if (args.value_labels) {
        layers.push({
          mark: { type: 'text', fontSize: 10, font: FONT, color: INK },
          encoding: {
            x: { field: x, type: 'nominal', sort: null },
            y: { field: y, type: 'nominal', sort: null },
            text: { field: value, type: 'quantitative' },
          },
        });
      }
      return { ...common, layer: layers, config: { ...config, view: { stroke: null }, axis: { ...config.axis, grid: false, ticks: false, domain: false } } };
    }
    default:
      // unreachable (t is normalized to a known type) — a plain bar fallback, never a throw.
      return { ...common, mark: { type: 'bar', color: accent }, encoding: { x: xEnc('nominal'), y: yEnc() } };
  }
}

/**
 * Make a Vega SVG FLUID for inlining into the report HTML. Vega emits fixed `width`/`height`
 * pixel attributes plus a `viewBox`; when that SVG is dropped into a narrow column or a card it
 * keeps its intrinsic px size and either overflows-and-clips or visually collapses into a corner
 * (the "tiny chart with overlapping labels" defect). We KEEP the viewBox (so it scales) but make
 * the rendered box responsive: width:100% of its .fig container, height:auto to preserve aspect,
 * capped at the natural width so it never up-scales blurrily, and centred. Pure string transform.
 */
export function makeSvgResponsive(svg: string): string {
  if (!svg || !svg.includes('<svg')) return svg;
  // Pull the intrinsic width so we can cap max-width at the natural size (no blurry upscaling).
  const wMatch = /<svg[^>]*\bwidth="(\d+(?:\.\d+)?)"/.exec(svg);
  const natural = wMatch ? Math.round(parseFloat(wMatch[1])) : 600;
  const style = `width:100%;height:auto;max-width:${natural}px;display:block;margin:0 auto`;
  return svg.replace(/<svg\b([^>]*)>/, (full, attrs) => {
    // Drop any existing inline style, keep everything else (incl. the viewBox), append ours.
    const cleaned = String(attrs).replace(/\sstyle="[^"]*"/i, '');
    return `<svg${cleaned} style="${style}">`;
  });
}

/**
 * Validate that the data rows actually contain the fields the chosen chart type plots — the
 * fix for the "chart renders ok but comes out empty (axes only, no bars)" bug. Vega-Lite happily
 * produces a dataless chart when the spec's field names (x/y/series/value) don't match the keys in
 * the data rows, so the tool used to report success and ship blank axes into a report. We catch the
 * mismatch up front and hand back an actionable message (with the actual data keys) so the agent
 * fixes the field names and re-renders, instead of shipping an empty figure. Pure + exported.
 */
export function validateChartData(args: ChartArgs): string | null {
  const rows = Array.isArray(args.data) ? args.data.filter((r) => r && typeof r === 'object') : [];
  if (!rows.length) return '`data` must be a non-empty array of row objects.';
  const x = args.x || 'x';
  const y = args.y || 'y';
  const series = args.series || 'series';
  const value = args.value || y;
  const need: { f: string; numeric?: boolean }[] = [];
  switch (args.type) {
    case 'multi_line':
    case 'stacked_bar':
      need.push({ f: x }, { f: y, numeric: true }, { f: series });
      break;
    case 'dual_axis':
      need.push({ f: x }, { f: y, numeric: true });
      if (args.y2) need.push({ f: args.y2, numeric: true });
      break;
    case 'donut':
      need.push({ f: series }, { f: value, numeric: true });
      break;
    case 'heatmap':
      need.push({ f: x }, { f: y }, { f: value, numeric: true });
      break;
    default: // bar, bar_h, area, line
      need.push({ f: x }, { f: y, numeric: true });
  }
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r as object)))];
  const has = (f: string) => rows.some((r) => Object.prototype.hasOwnProperty.call(r, f));
  const numeric = (f: string) =>
    rows.some((r) => {
      const v = (r as any)[f];
      return typeof v === 'number' ? isFinite(v) : typeof v === 'string' && v.trim() !== '' && isFinite(Number(v));
    });
  for (const { f, numeric: needNum } of need) {
    if (!has(f))
      return `the chart field "${f}" isn't in your data rows (their keys are: ${keys.join(', ')}). Set the matching x/y/series/value argument to one of those keys (or rename your data fields to match) — otherwise the chart renders with axes but NO bars/line.`;
    if (needNum && !numeric(f))
      return `the chart's value field "${f}" has no numeric values (Vega needs real numbers, not text). Pass "${f}" as numbers so the bars/line can be drawn.`;
  }
  return null;
}

/** Compile + render an SVG string from concise chart args. */
export async function renderChartSvg(args: ChartArgs): Promise<string> {
  const vega: any = await nativeImport('vega');
  const vl: any = await nativeImport('vega-lite');
  const compile = vl.compile ?? vl.default?.compile;
  const vlSpec = buildVlSpec(args);
  const vgSpec = compile(vlSpec).spec;
  const view = new vega.View(vega.parse(vgSpec), { renderer: 'none' });
  const svg: string = await view.toSVG();
  view.finalize?.();
  return svg;
}

/**
 * Page-appropriate intrinsic dimensions. The chart is INLINED into a report whose printable
 * measure (inside @page{margin:20mm 26mm} on A4) is ~597px wide, so the default width matches
 * a FULL-MEASURE .fig block — a chart that comes out small/cornered is the #1 chart defect.
 * Height auto-grows with the data so labels never collide: a tall column count (heatmap rows,
 * horizontal bars, many categories) needs more vertical room or axis labels overlap (the
 * "AED 155K/318K/120K all colliding" defect). Defaults are deliberately generous; an explicit
 * width/height still wins but is floored so the model can't request a tiny chart.
 */
export function chartSize(args: ChartArgs): { width: number; height: number } {
  const rows = Array.isArray(args.data) ? args.data.length : 0;
  // Full-measure default so the chart fills the .fig block, never a narrow corner.
  const width = Math.max(360, Math.min(1400, Number(args.width) || 600));
  let defHeight = 340;
  if (args.type === 'bar_h') defHeight = Math.max(280, Math.min(900, rows * 30 + 90)); // one labelled row each
  else if (args.type === 'heatmap') defHeight = Math.max(300, Math.min(900, rows * 16 + 140));
  else if (args.type === 'donut') defHeight = 320;
  const height = Math.max(220, Math.min(1000, Number(args.height) || defHeight));
  return { width, height };
}

/**
 * Rasterize a chart to a TRANSPARENT PNG (2× for crispness) via headless Chromium —
 * .docx and .pptx both need a raster image (SVG is unreliable in Word/PowerPoint),
 * so this lets the office generators embed the exact same editorial Vega charts the
 * reports use. Mirrors the Playwright/Chromium pattern in deliverableCheck.ts and
 * degrades gracefully (returns null) when the SVG fails to render or Chromium is
 * unavailable, so doc/deck generation never breaks on a chart.
 */
/** Rasterize ANY SVG string to a TRANSPARENT PNG (scale× crisp) via headless Chromium. Null if unavailable. */
export async function svgToPng(svg: string, width: number, height: number, scale = 2): Promise<Buffer | null> {
  if (!svg || !svg.includes('<svg')) return null;
  let pw: any;
  try {
    pw = await import('playwright');
  } catch {
    return null;
  }
  let browser: any;
  try {
    browser = await pw.chromium.launch({ headless: true, timeout: 15_000, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const page = await browser.newPage({ deviceScaleFactor: scale });
    await page.setViewportSize({ width: Math.max(1, Math.ceil(width)), height: Math.max(1, Math.ceil(height)) });
    await page.setContent(
      `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:transparent}svg{display:block}</style>${svg}`,
      { waitUntil: 'load', timeout: 20_000 },
    );
    const el = await page.$('svg');
    const png = (await (el ?? page).screenshot({ type: 'png', omitBackground: true })) as Buffer;
    return png && png.length ? png : null;
  } catch {
    return null;
  } finally {
    try {
      await browser?.close();
    } catch {
      /* ignore */
    }
  }
}

export async function renderChartPng(
  args: ChartArgs,
  scale = 2,
): Promise<{ png: Buffer; width: number; height: number } | null> {
  let svg: string;
  try {
    svg = await renderChartSvg(args);
  } catch {
    return null;
  }
  const { width, height } = chartSize(args);
  const png = await svgToPng(svg, width, height, scale);
  return png ? { png, width, height } : null;
}

export const renderChartTool: ToolDef = {
  name: 'render_chart',
  description:
    'Render a publication-grade chart as an embeddable SVG (flat, on-brand: muted base + your accent ' +
    'on the key series, direct value labels, light gridlines). Prefer this over hand-coded CSS bar-lists ' +
    'for any real data-viz in a report/dashboard. The SVG is saved to charts/ AND returned — INLINE the ' +
    'returned <svg> into your report HTML inside a FULL-MEASURE <figure class="fig"> (its OWN row, the full ' +
    'text width — NEVER a narrow column or a small card, or the axis labels collide and it looks cornered). ' +
    'The returned SVG is already fluid (width:100%; height:auto) so it fills the figure; you do NOT need to ' +
    'resize it. Types: line, multi_line, dual_axis (bars + a trend line on a 2nd axis — great for time-series), ' +
    'bar, bar_h, stacked_bar, area, donut, heatmap (e.g. month×year). Pass the report ACCENT so it matches.',
  parameters: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['line', 'multi_line', 'dual_axis', 'bar', 'bar_h', 'stacked_bar', 'area', 'donut', 'heatmap'],
        description: 'Chart type. dual_axis = bars + a line on a second y-axis; heatmap = a value grid (x × y coloured by `value`).',
      },
      data: {
        type: 'array',
        items: { type: 'object' },
        description: 'Array of row objects, e.g. [{"month":"Jan","leads":120,"rate":3.1}, …].',
      },
      x: { type: 'string', description: 'Field for the x-axis (category/time). MUST exactly match a key in your data rows (case-sensitive) or the chart renders empty (axes, no bars). For heatmap: the column dimension.' },
      y: { type: 'string', description: 'Primary numeric field (the bars/line/area) — MUST exactly match a numeric key in your data rows. For heatmap: the row dimension.' },
      y2: { type: 'string', description: 'dual_axis only: the second numeric field drawn as the line on the right axis.' },
      series: { type: 'string', description: 'Field that splits the data into multiple series (multi_line / stacked_bar) or the category (donut).' },
      value: { type: 'string', description: 'heatmap: the numeric field that colours each cell. donut: the slice size field (defaults to y).' },
      title: { type: 'string', description: 'Optional chart title (kept quiet/small).' },
      x_title: { type: 'string', description: 'Optional x-axis title.' },
      y_title: { type: 'string', description: 'Optional y-axis (left) title.' },
      y2_title: { type: 'string', description: 'dual_axis only: right-axis title.' },
      accent: { type: 'string', description: 'Hex accent (the report accent) used for the key series / heatmap high end. Default warm ochre.' },
      value_labels: { type: 'boolean', description: 'Label values directly on bars/points/cells (recommended for small datasets).' },
      width: { type: 'number', description: 'SVG width in px (default 560).' },
      height: { type: 'number', description: 'SVG height in px (default 300).' },
      output: { type: 'string', description: 'Output filename in charts/ (e.g. "leads-trend.svg"). Default chart.svg.' },
    },
    required: ['type', 'data'],
  },
  modes: ['report', 'code'],
  summarize: (a) => `chart ${String(a.type ?? '')}${a.title ? ` · ${a.title}` : ''}`,
  async run(args, ctx) {
    if (!Array.isArray(args.data) || !args.data.length) return 'Error: `data` must be a non-empty array of row objects.';
    // Catch a field-name mismatch (data keys ≠ x/y/series/value) BEFORE rendering — otherwise Vega
    // emits a valid-but-empty chart (axes, no bars) and we'd ship blank axes into the report.
    const bindErr = validateChartData(args as ChartArgs);
    if (bindErr) return `Error: ${bindErr}`;
    let svg: string;
    try {
      svg = await renderChartSvg(args as ChartArgs);
    } catch (e: any) {
      return `Error: chart render failed — ${e?.message ?? e}`;
    }
    if (!svg || !svg.includes('<svg')) return 'Error: the chart rendered empty — check the data/field names.';
    // Backstop: a bar/area chart with real data must contain mark elements. If the SVG came back
    // with only axis scaffold (no <rect>/<path> marks), the data didn't bind — don't ship it.
    if (/^(bar|bar_h|stacked_bar|area)$/.test(String(args.type))) {
      const rectCount = (svg.match(/<rect\b/g) || []).length;
      if (rectCount <= 1)
        return 'Error: the chart rendered with axes but no bars — the data did not bind. Make sure the `x` (label) and `y` (numeric value) arguments exactly match the keys in your data rows, then render again.';
    }
    // Make it fluid so it fills its .fig block instead of collapsing to a fixed-px corner.
    svg = makeSvgResponsive(svg);

    const outName = String(args.output || 'chart.svg').replace(/[^a-zA-Z0-9._-]/g, '-');
    const finalName = outName.toLowerCase().endsWith('.svg') ? outName : `${outName}.svg`;
    let absOut: string;
    try {
      absOut = resolveInWorkspace(ctx.repoDir, path.join('charts', finalName));
    } catch (e: any) {
      return `Error: ${e?.message ?? e}`;
    }
    try {
      fs.mkdirSync(path.dirname(absOut), { recursive: true });
      fs.writeFileSync(absOut, svg, 'utf8');
    } catch (e: any) {
      return `Error: could not save the chart — ${e?.message ?? e}`;
    }
    const kb = Math.max(1, Math.round(svg.length / 1024));
    return (
      `Rendered ${args.type} chart → charts/${finalName} (${kb} KB SVG).\n` +
      `INLINE this SVG into your report HTML inside a FULL-MEASURE <figure class="fig">…</figure> (its own row, ` +
      `the full text width — never a narrow column/small card) so it stays atomic AND large enough that the axis ` +
      `labels don't collide. It's already fluid (width:100%; height:auto) — don't add a width/height. Markup:\n\n${svg}`
    );
  },
};
