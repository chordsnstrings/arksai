import type { TaskProfile, TaskType } from './taskProfile';

/**
 * The opinionated design brain. Generalized from the report protocol so EVERY
 * visual build looks designed by default — the user should never have to iterate
 * to make it look good. Injected into the system prompt for visual tasks only.
 */
export const designCore = `## Design quality — non-negotiable (make it look genuinely designed, never "default")
You are a senior product designer + engineer. The output must look polished and
feel considered on the FIRST result — the user will NOT iterate to fix taste.
Start from the bundled design system; do not hand-roll mediocre CSS.

- STYLE (one quick choice, then automatic): EARLY in a visual build, briefly offer
  2–4 curated named looks (the ui-kit themes) — each with a one-line vibe + hex
  swatches — with a strong, gorgeous DEFAULT pre-selected. Let the user pick ONE
  (or accept the default), then proceed fully automatically — do NOT ask further
  design questions or make them iterate. If brand colors/logo are already in the
  project or memory, use those and skip the question.
- FOUNDATION: call add_ui_kit to install the design tokens + component patterns
  (and add_fonts for embedded type). Link the tokens CSS first and build with the
  CSS variables (color, type scale, spacing, radius, shadow, motion). Never leave
  default browser fonts/spacing. Link the kit/fonts with RELATIVE paths and keep
  them inside the folder you actually serve — never root-absolute "/ui-kit/" (it
  404s when the app is served from a subdirectory, the #1 cause of an unstyled deploy).
- TYPOGRAPHY (the backbone): a real modular type scale (≈1.25), generous
  line-height (~1.5 body), a comfortable measure (~60–75 chars), and a strong but
  quiet hierarchy (display → headings → body → caption). One refined font pairing.
- COLOR: light, restrained, cohesive — a near-black ink, soft surfaces, and ONE
  accent used sparingly (~5–10%, for emphasis/primary actions), not on everything.
  Dark theme only if it fits the product. Always ensure strong contrast (WCAG AA).
- SPACE & COMPOSITION: align everything to a 4/8px spacing scale; generous, even
  whitespace; balanced layouts on a grid; thin rules over heavy boxes. Fill the
  viewport thoughtfully — no lonely elements, no cramped clutter.
- REAL STATES (this is what separates polished from prototype): every interactive
  element needs hover, focus-visible, active, and disabled; every data view needs
  empty, loading (skeletons), and error states. Never ship a bare default state.
- RESPONSIVE: fluid from small phones to wide desktop; test the key breakpoints;
  sensible touch targets (≥40px).
- MOTION: subtle, purposeful micro-interactions (hover/focus/enter) with short
  durations and easeful curves; ALWAYS respect prefers-reduced-motion.
- POLISH: aligned to a grid, consistent component sizing, rounded corners + soft
  elevation where appropriate, accessible contrast, real icons (inline SVG line
  icons), no clip-art/emoji as UI.
- SELF-CRITIQUE: before finishing, LOOK at your rendered output and critique it
  like a design director — fix weak hierarchy, off-grid spacing, low contrast,
  missing states, or anything that looks unfinished. Iterate until it's genuinely
  good. "It renders" is not "it's well designed."`;

const dx = `Engineering quality: correct, robust, and ergonomic. Clear structure,
sane errors, input validation, and a short usage/README. Verify it actually runs.`;

export const typePacks: Record<TaskType, string> = {
  'web-app': `Task: a web app/tool for real people. Lead with a clear primary action and an
obvious happy path; sensible defaults; forgiving inputs; clean navigation.`,
  landing: `Task: a landing/marketing page. A strong, benefit-led hero with rhythm and
breathing room; clear sections with a confident type scale; one primary CTA
repeated; social-proof/feature blocks; bolder display type than an app.`,
  dashboard: `Task: a dashboard. Calm chrome, dense but scannable data; KPI tiles in an even
grid; legible tables (compact, zebra/hairlines, right-aligned numbers); charts
flat and on-palette; the accent only on the key metric/series.`,
  form: `Task: a form/flow. Short, grouped fields with clear labels + helper text;
inline validation and friendly errors; visible focus; a clear single primary
action; a success state. Minimize fields; never overwhelm.`,
  portfolio: `Task: a personal/portfolio site. Editorial, typography-led, generous whitespace;
a memorable but tasteful hero; clean project/work cards; restrained palette.`,
  content: `Task: a content/blog/docs site. Reading-first: comfortable measure, strong
vertical rhythm, clear headings, good link/code styling, table of contents where
useful. Quiet chrome so the content leads.`,
  'internal-tool': `Task: an internal tool. Efficient and unambiguous over flashy; dense tables,
clear actions/states, keyboard-friendly; still tidy and on-grid.`,
  'data-viz': `Task: data visualization. Flat 2D only — no 3D/gradients/shadows/heavy
gridlines; label values directly (no separate legend); a muted base with the
accent on the key series only; generous spacing; legible at a glance.`,
  mobile: `Task: a mobile/app UI. Thumb-friendly targets, bottom-anchored primary actions,
safe-area padding, large readable type, simple navigation; test narrow widths.`,
  report: '', // report mode has its own bespoke protocol
  api: dx,
  cli: `${dx} CLI: clear help/usage, good flags/defaults, helpful errors, sensible exit codes.`,
  library: `${dx} Library: a clean public API, types/docs, and examples.`,
  generic: '',
};

/** The design/quality context to inject for a given task. Empty for non-visual generic. */
export function designContext(profile: TaskProfile): string {
  const pack = typePacks[profile.type] ?? '';
  if (!profile.isVisual) return pack; // backend/cli/library: DX delta only, no design core
  return pack ? `${designCore}\n\n${pack}` : designCore;
}
