/**
 * Animated-explainer OVERLAY layer — the SECOND layer (pure, unit-tested).
 *
 * The video is two independent layers (operator, 2026-07-08): a text-free generative
 * illustrated CLIP, and this crisp HTML/CSS TEXT layer composited on top — text is NEVER
 * baked into the generated pixels. This module builds (a) the transparent overlay HTML page
 * (captured with alpha, then composited), and (b) the clip prompt that keeps layer 1 clean
 * (non-photoreal, text-free, with calm negative space where the overlay will sit).
 */

const esc = (s: string): string =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export const AX_LAYOUTS = ['lower', 'center', 'stat', 'caption', 'none'] as const;
export type AxLayout = (typeof AX_LAYOUTS)[number];

export interface AxOverlay {
  layout: AxLayout;
  kicker?: string;
  title?: string;
  sub?: string;
  num?: string;
  unit?: string;
  label?: string;
  caption?: string;
}

/** The illustrated looks. `tokens` steer the generative clip; the text-ban NEGATIVE is constant. */
export const AX_STYLES: Record<string, { label: string; tokens: string }> = {
  'flat-vector': { label: 'Flat vector', tokens: 'flat 2D vector illustration, bold clean shapes, limited flat colour palette, thick confident outlines, no gradients, crisp geometric forms' },
  painterly: { label: 'Painterly', tokens: 'hand-painted painterly illustration, soft gouache brushwork, visible texture, warm diffused light, gentle colour blends' },
  'ink-wash': { label: 'Ink & wash', tokens: 'ink and watercolour wash illustration, expressive brush linework, muted tones with a single accent colour, subtle paper texture' },
  'paper-collage': { label: 'Paper collage', tokens: 'cut-paper collage illustration, layered textured paper shapes, soft drop shadows between layers, tactile handmade feel' },
  silhouette: { label: 'Silhouette', tokens: 'minimalist silhouette illustration, strong negative space, two or three flat tones plus one accent, elegant simple shapes' },
  isometric: { label: 'Isometric', tokens: 'clean isometric flat illustration, tidy geometric forms, soft ambient occlusion, calm muted palette' },
  storybook: { label: 'Storybook', tokens: 'warm storybook illustration, soft rounded shapes, cosy hand-drawn charm, gentle textured shading' },
  'cel-anime': { label: 'Cel anime', tokens: 'cel-shaded anime illustration, clean confident lineart, flat cel shading, expressive but simple' },
};

export const AX_STYLE_IDS = Object.keys(AX_STYLES);

/** The constant text-ban + realism-ban that keeps layer 1 clean (all text lives in layer 2). */
export const AX_NEGATIVE =
  'no text, no words, no letters, no numbers, no captions, no subtitles, no watermark, no logo, no signage, no user interface; ' +
  'no photorealism, no 3D render, no live-action, no real photograph, no camera footage, no realistic human faces';

/** Where the overlay text sits → which region of the clip must stay calm/uncluttered. */
function negativeSpaceZone(layout: AxLayout): string {
  switch (layout) {
    case 'center':
      return 'centre of the frame (keep the middle calm and simple so a headline can sit there)';
    case 'stat':
      return 'lower-left quarter of the frame';
    case 'caption':
    case 'lower':
      return 'lower third of the frame';
    default:
      return 'lower third of the frame';
  }
}

/** Build the generative CLIP prompt for a scene — text-free, non-photoreal, with room for the overlay. */
export function clipPrompt(visual: string, styleTokens: string, layout: AxLayout): string {
  const v = String(visual || '').trim().replace(/\s+/g, ' ');
  return (
    `${styleTokens}. ${v}. ` +
    `Gentle ambient motion and a slow subtle camera drift — a living, breathing scene, not a still image. ` +
    `Leave a calm, uncluttered area of negative space in the ${negativeSpaceZone(layout)}. ` +
    `NEGATIVE: ${AX_NEGATIVE}.`
  );
}

/** Normalize a raw overlay object into a validated AxOverlay (defaults to 'lower'). */
export function normalizeOverlay(raw: any): AxOverlay {
  const layout = (AX_LAYOUTS as readonly string[]).includes(String(raw?.layout)) ? (raw.layout as AxLayout) : 'lower';
  const s = (k: string) => (raw?.[k] != null ? String(raw[k]).slice(0, 200) : undefined);
  return { layout, kicker: s('kicker'), title: s('title'), sub: s('sub'), num: s('num'), unit: s('unit'), label: s('label'), caption: s('caption') };
}

/** Human-readable summary of an overlay's copy — used by the (deterministic) legibility notes. */
export function overlayText(o: AxOverlay): string {
  return [o.kicker, o.title, o.sub, o.num, o.unit, o.label, o.caption].filter(Boolean).join(' ');
}

export interface OverlayStyle {
  ink?: string; // text colour (default near-white)
  accent?: string; // brand accent
  scrim?: string; // veil colour (default near-black)
  font?: string; // css font-family stack
  width: number;
  height: number;
  kitPrefix?: string; // relative path to reach motion-kit/ (default './')
}

/** Build the transparent overlay HTML page for a scene — the .ax-* layer, motion-kit runtime linked. */
export function buildOverlayHtml(o: AxOverlay, st: OverlayStyle): string {
  const prefix = st.kitPrefix ?? './';
  const ink = st.ink || '#f6f7fb';
  const accent = st.accent || '#7aa2ff';
  const scrim = st.scrim || '#06070c';
  const font = st.font || "'Inter', system-ui, sans-serif";
  const vars = `--ax-ink:${ink}; --ax-accent:${accent}; --ax-scrim:${scrim}; --mg-font:${font}`;

  let scrimEl = '';
  let content = '';
  if (o.layout === 'lower') {
    scrimEl = '<div class="ax-scrim bottom" aria-hidden="true"></div>';
    content =
      `<div class="ax-content">` +
      (o.kicker ? `<div class="ax-kicker">${esc(o.kicker)}</div>` : '') +
      (o.title ? `<div class="ax-title">${esc(o.title)}</div>` : '') +
      (o.sub ? `<div class="ax-sub">${esc(o.sub)}</div>` : '') +
      `</div>`;
  } else if (o.layout === 'center') {
    scrimEl = '<div class="ax-scrim full" aria-hidden="true"></div>';
    content =
      `<div class="ax-content">` +
      (o.kicker ? `<div class="ax-kicker">${esc(o.kicker)}</div>` : '') +
      (o.title ? `<div class="ax-title">${esc(o.title)}</div>` : '') +
      (o.sub ? `<div class="ax-sub">${esc(o.sub)}</div>` : '') +
      `</div>`;
  } else if (o.layout === 'stat') {
    scrimEl = '<div class="ax-scrim bottom" aria-hidden="true"></div>';
    content =
      `<div class="ax-card">` +
      `<div class="ax-num">${esc(o.num ?? '')}${o.unit ? `<span class="u">${esc(o.unit)}</span>` : ''}</div>` +
      (o.label ? `<div class="ax-lbl">${esc(o.label)}</div>` : '') +
      `</div>`;
  } else if (o.layout === 'caption') {
    scrimEl = '<div class="ax-scrim bottom" aria-hidden="true"></div>';
    content = `<div class="ax-cap">${esc(o.caption ?? '')}</div>`;
  } // 'none' → empty transparent stage (composite still normalizes + adds narration)

  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<link rel="stylesheet" href="${prefix}motion-kit/motion.css">` +
    `<style>html,body{margin:0;width:${st.width}px;height:${st.height}px;background:transparent}</style>` +
    `</head><body class="ax-body">` +
    `<div class="ax-stage ax-${o.layout}" style="${vars}">${scrimEl}${content}</div>` +
    `<script src="${prefix}motion-kit/motion.js"></script>` +
    `</body></html>`
  );
}
