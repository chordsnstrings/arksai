/**
 * ArksAI Mobile UI Kit — design tokens (React Native / Expo).
 *
 * The mobile counterpart of the web ui-kit: one source of truth for a minimal, modern,
 * typography-first aesthetic. Every generated Android app composes from these tokens +
 * the components in ./components — never the default RN look. Light + dark themes.
 *
 * Philosophy (matches the web kit): restrained palette, ONE characterful accent used
 * sparingly, an 8pt spacing grid, a real modular type scale, generous line-height,
 * hairlines over heavy borders, soft shadows, tasteful motion. Respect the safe area.
 */

export const palette = {
  // Neutral ink + surfaces (near-black ink, soft surfaces — not pure #000/#fff).
  ink: '#16130F',
  inkMuted: '#6B6256', // readable secondary (~55–65% ink), never a washed-out tint
  surface: '#FFFFFF',
  surfaceAlt: '#F6F3EE', // cards / grouped rows
  hairline: '#E7E1D8',
  // ONE accent (override per-brand via theme). Warm, characterful default.
  accent: '#BC7F4E',
  accentInk: '#FFFFFF', // text on accent
  // Semantic
  success: '#2E7D5B',
  danger: '#C0492F',
} as const;

export const darkPalette = {
  ink: '#F3EEE6',
  inkMuted: '#A89E90',
  surface: '#15120E',
  surfaceAlt: '#1F1B16',
  hairline: '#2C2620',
  accent: '#D6A06A',
  accentInk: '#15120E',
  success: '#5FB98C',
  danger: '#E0775C',
} as const;

/** 8pt spacing scale. */
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;

/** Modular type scale (~1.25) — display → headings → body → caption. */
export const type = {
  display: { fontSize: 32, lineHeight: 38, fontWeight: '700' as const, letterSpacing: -0.4 },
  title: { fontSize: 24, lineHeight: 30, fontWeight: '700' as const, letterSpacing: -0.2 },
  heading: { fontSize: 19, lineHeight: 25, fontWeight: '600' as const },
  body: { fontSize: 16, lineHeight: 24, fontWeight: '400' as const },
  label: { fontSize: 14, lineHeight: 20, fontWeight: '600' as const },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' as const },
} as const;

export const radius = { sm: 8, md: 12, lg: 16, xl: 24, pill: 999 } as const;

export const shadow = {
  card: {
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
} as const;

export const motion = { fast: 140, base: 220, slow: 360 } as const;

/** Palette shape — WIDENED to plain strings so dark/brand palettes assign cleanly
 *  (the literal `as const` types otherwise reject every non-default hex — a real tsc error). */
export type Palette = { [K in keyof typeof palette]: string };

export type Theme = {
  colors: Palette;
  space: typeof space;
  type: typeof type;
  radius: typeof radius;
  shadow: typeof shadow;
  motion: typeof motion;
  dark: boolean;
};

export const lightTheme: Theme = { colors: palette, space, type, radius, shadow, motion, dark: false };
export const darkTheme: Theme = { colors: darkPalette, space, type, radius, shadow, motion, dark: true };

/** Build a brand theme from a single accent (nudge for contrast in the app if needed). */
export function brandTheme(accent: string, dark = false): Theme {
  const base = dark ? darkTheme : lightTheme;
  return { ...base, colors: { ...base.colors, accent } };
}
