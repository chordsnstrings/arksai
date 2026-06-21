import type { ToolDef } from './common';

/**
 * validate_palette — deterministic WCAG 2.2 contrast validation + safe token
 * derivation for a brand palette. Closes a "looks perfect" gap: before building
 * any visual deliverable the agent can CHECK that body text / links / accents
 * actually pass AA contrast on the chosen background, and get a corrected colour
 * when a combo fails (instead of shipping unreadable text).
 *
 * Pure compute — no LLM, no network, no key. The WCAG relative-luminance +
 * contrast-ratio math, the HEX parse, and the HSL lighten/darken/hue-shift token
 * derivation are ported (reimplemented in TypeScript) from the MIT-licensed
 * claude-skills design-system tool:
 *   markdown-html/skills/design-system/scripts/brand_palette_validator.py
 * (Anthropic claude-skills, MIT). No Python and no dependency added — only the
 * math was harvested.
 */

export interface RGB {
  r: number;
  g: number;
  b: number;
}

const AA_NORMAL = 4.5; // WCAG 2.2 AA, normal-size body text
const AA_LARGE = 3.0; // WCAG 2.2 AA, large text (≥18.66px bold / 24px) + non-text UI

const HEX_RE = /^#?([0-9a-fA-F]{6})$/;

/** Parse #RRGGBB / RRGGBB → RGB, or null if malformed. */
export function parseHex(hex: string): RGB | null {
  const m = HEX_RE.exec(String(hex ?? '').trim());
  if (!m) return null;
  const h = m[1];
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}

export function toHex({ r, g, b }: RGB): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0').toUpperCase();
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** WCAG 2.2 sRGB-linearized relative luminance. */
export function relativeLuminance({ r, g, b }: RGB): number {
  const lin = (ch: number) => {
    const c = ch / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two colours (1:1 … 21:1). */
export function contrastRatio(a: RGB, b: RGB): number {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// --- HSL helpers (port of Python colorsys rgb_to_hls / hls_to_rgb) ---
function rgbToHsl({ r, g, b }: RGB): { h: number; s: number; l: number } {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const mx = Math.max(rr, gg, bb);
  const mn = Math.min(rr, gg, bb);
  const l = (mx + mn) / 2;
  let h = 0;
  let s = 0;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === rr) h = (gg - bb) / d + (gg < bb ? 6 : 0);
    else if (mx === gg) h = (bb - rr) / d + 2;
    else h = (rr - gg) / d + 4;
    h /= 6;
  }
  return { h, s, l };
}

function hslToRgb(h: number, s: number, l: number): RGB {
  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }
  const hue2rgb = (p: number, q: number, t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    g: Math.round(hue2rgb(p, q, h) * 255),
    b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  };
}

export function lighten(rgb: RGB, pct: number): RGB {
  const { h, s, l } = rgbToHsl(rgb);
  return hslToRgb(h, s, Math.min(1, Math.max(0, l + pct)));
}
export function darken(rgb: RGB, pct: number): RGB {
  return lighten(rgb, -pct);
}
export function shiftHue(rgb: RGB, degrees: number): RGB {
  const { h, s, l } = rgbToHsl(rgb);
  return hslToRgb((h + degrees / 360 + 1) % 1, s, l);
}

const isDark = (rgb: RGB) => relativeLuminance(rgb) < 0.18;

/**
 * Walk a colour's luminance toward whichever direction raises contrast on `bg`
 * until it meets `target` (or saturates). Returns the corrected colour. Pure.
 */
export function ensureContrast(fg: RGB, bg: RGB, target = AA_NORMAL): RGB {
  if (contrastRatio(fg, bg) >= target) return fg;
  const step = relativeLuminance(bg) < 0.5 ? 0.04 : -0.04; // dark bg → lighten fg, else darken
  let result = fg;
  for (let i = 0; i < 25; i++) {
    if (contrastRatio(result, bg) >= target) return result;
    const next = lighten(result, step);
    if (toHex(next) === toHex(result)) break; // saturated (pure white/black)
    result = next;
  }
  return result;
}

export interface PaletteTokens {
  primary: string;
  accent: string;
  bg: string;
  surface: string;
  text: string;
  muted: string;
  line: string;
  link: string;
  'link-hover': string;
}

export interface ContrastCheck {
  pair: string;
  ratio: number;
  floor: number;
  pass: boolean;
  /** A corrected colour that DOES meet the floor, when the original fails. */
  fix?: string;
}

export interface PaletteResult {
  ok: boolean;
  inputs: { primary: string; accent?: string; bg?: string; text?: string };
  checks: ContrastCheck[];
  tokens: PaletteTokens;
  notes: string[];
}

/**
 * The full pure validation+derivation. Given a brand primary (and optional
 * accent/bg/text), resolve a safe background, derive a small token set, run the
 * AA contrast checks, and attach a corrected colour for any failing pair.
 */
export function validatePalette(input: {
  primary: string;
  accent?: string;
  bg?: string;
  text?: string;
}): PaletteResult | { error: string } {
  const primary = parseHex(input.primary);
  if (!primary) return { error: `Invalid primary HEX "${input.primary}". Expected #RRGGBB.` };
  const accentIn = input.accent ? parseHex(input.accent) : null;
  if (input.accent && !accentIn) return { error: `Invalid accent HEX "${input.accent}". Expected #RRGGBB.` };
  const bgIn = input.bg ? parseHex(input.bg) : null;
  if (input.bg && !bgIn) return { error: `Invalid bg HEX "${input.bg}". Expected #RRGGBB.` };
  const textIn = input.text ? parseHex(input.text) : null;
  if (input.text && !textIn) return { error: `Invalid text HEX "${input.text}". Expected #RRGGBB.` };

  const notes: string[] = [];

  // Resolve the background first — it anchors every contrast decision.
  let bg: RGB;
  if (bgIn) bg = bgIn;
  else if (isDark(primary)) {
    bg = primary; // a dark brand primary → assume a dark theme
    notes.push('Dark brand primary → derived a dark background from it.');
  } else {
    // near-neutral light surface tinted faintly by the primary hue
    const { h } = rgbToHsl(primary);
    bg = hslToRgb(h, 0.04, 0.97);
  }

  const text = textIn ?? (isDark(bg) ? { r: 247, g: 247, b: 242 } : { r: 16, g: 24, b: 32 });
  const accent = accentIn ?? (isDark(primary) ? lighten(shiftHue(primary, 160), 0.45) : primary);

  const surface = lighten(bg, isDark(bg) ? 0.06 : -0.03);
  const line = lighten(bg, isDark(bg) ? 0.12 : -0.08);
  const muted = isDark(bg) ? lighten(text, -0.18) : lighten(text, 0.32);
  // Link starts from the accent and is nudged to AA on the bg.
  const link = ensureContrast(accent, bg, AA_NORMAL);
  const linkHover = lighten(link, isDark(bg) ? 0.08 : -0.06);

  const tokens: PaletteTokens = {
    primary: toHex(primary),
    accent: toHex(accent),
    bg: toHex(bg),
    surface: toHex(surface),
    text: toHex(text),
    muted: toHex(muted),
    line: toHex(line),
    link: toHex(link),
    'link-hover': toHex(linkHover),
  };

  const check = (pair: string, fg: RGB, floor: number): ContrastCheck => {
    const ratio = Math.round(contrastRatio(fg, bg) * 100) / 100;
    const pass = ratio >= floor;
    const c: ContrastCheck = { pair, ratio, floor, pass };
    if (!pass) c.fix = toHex(ensureContrast(fg, bg, floor));
    return c;
  };

  const checks: ContrastCheck[] = [
    check('body text on bg', text, AA_NORMAL),
    check('accent on bg (large text / UI)', accent, AA_LARGE),
    check('link on bg', link, AA_NORMAL),
    check('muted text on bg (large)', muted, AA_LARGE),
  ];

  const ok = checks.every((c) => c.pass);
  if (!ok) notes.push('One or more pairs fail WCAG AA — apply the `fix` colour shown for each failing pair.');

  return { ok, inputs: { primary: input.primary, accent: input.accent, bg: input.bg, text: input.text }, checks, tokens, notes };
}

export const validatePaletteTool: ToolDef = {
  name: 'validate_palette',
  description:
    'Validate a brand colour palette for WCAG 2.2 AA contrast and derive a SAFE token set BEFORE building any ' +
    'visual deliverable (web app, landing page, deck, report, dashboard). Pass the brand primary HEX (required) ' +
    'plus optional accent/bg/text HEX. Returns: pass/fail for body-text-on-bg and link-on-bg (4.5:1 floor) and ' +
    'accent/large-text-on-bg (3:1 floor); a corrected colour for any pair that FAILS (so text is never ' +
    'unreadable); and a derived token set (primary/accent/bg/surface/text/muted/line/link/link-hover) you can drop ' +
    'into :root CSS. Use this to lock contrast in before you build — never ship body text that fails AA. Pure, ' +
    'deterministic, instant.',
  parameters: {
    type: 'object',
    properties: {
      primary: { type: 'string', description: 'Brand primary HEX, e.g. "#0A1628" or "0A1628" (#RRGGBB).' },
      accent: { type: 'string', description: 'Optional accent/CTA HEX. Derived from the primary if omitted.' },
      bg: { type: 'string', description: 'Optional background HEX. A safe light/dark bg is derived if omitted.' },
      text: { type: 'string', description: 'Optional body-text HEX. A readable near-black/near-white is derived if omitted.' },
    },
    required: ['primary'],
  },
  modes: ['chat', 'code', 'report'],
  summarize: (a) => `validate palette ${String(a.primary ?? '')}`,
  async run(args) {
    const res = validatePalette({
      primary: String(args.primary ?? ''),
      accent: args.accent ? String(args.accent) : undefined,
      bg: args.bg ? String(args.bg) : undefined,
      text: args.text ? String(args.text) : undefined,
    });
    if ('error' in res) return `Error: ${res.error}`;
    return JSON.stringify(res, null, 2);
  },
};
