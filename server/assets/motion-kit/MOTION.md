# Motion-kit — authoring scenes for narrated motion graphics

Each scene is ONE self-contained HTML file rendered frame-by-frame by the capture harness.
The harness owns time: it injects `--scene-ms`/`--scene-s` (derived from the narration
audio) and steps `window.__seek(ms)` per frame.

## Hard rules (a scene that breaks these renders wrong)
1. Link `motion.css` + `motion.js` + `fonts/fonts.css` with RELATIVE paths. No external
   http(s) resources anywhere — fully self-contained.
2. NO wall-clock: no requestAnimationFrame state, no setInterval/setTimeout visuals, no
   `Date.now()`. All motion = CSS animations (the kit's classes or your own keyframes with
   `animation-fill-mode: both`) or `window.__motionHook((ms) => …)` deriving purely from ms.
3. Time entrances in the first 1.5–3s; ambient/looping motion afterwards — narration length
   varies, and the scene must look composed at ANY t. For proportional timing use
   `animation-duration: calc(var(--scene-s) * 1s)`.
4. One idea per scene. Fill the frame ~85–100%; safe margins via `.mg-safe`.
5. Icons/logos come from `search_assets` (inline the materialized SVG) — never hand-drawn
   paths. Charts come from `render_chart` SVGs (animate bars with `.mg-bar-v`, lines with
   `.mg-draw`).

## Building blocks
- Stage: `.mg-scene .mg-safe [.mg-center]`, `.mg-row/.mg-col/.mg-grid`, `.mg-wash` backdrop.
- Type: `.mg-kicker` (mono eyebrow), `.mg-title` (serif display), `.mg-sub`, `.mg-stat`
  (big tabular number), `.mg-label`.
- Entrances (delay via `--at`, e.g. `style="--at:.6s"`): `.mg-reveal .mg-fade .mg-pop
  .mg-slide-l .mg-slide-r .mg-wipe`; stagger a group with `.mg-stagger` (`--stagger`).
- SVG draw-on: wrap the icon in `.mg-draw` (set `--len` ≈ path length for tight timing).
- Ambient: `.mg-float .mg-pulse`; camera: `.mg-camera-zoom` / `.mg-camera-pan` on a wrapper.
- Data: `.mg-bar` / `.mg-bar-v` growth; counters
  `<span data-count-to="42" data-count-start="800" data-count-dur="1200">0</span>`;
  typewriter `data-typewriter data-tw-start="400" data-tw-cps="24"`.
- Theme: override `--mg-bg/--mg-ink/--mg-accent/--mg-accent-2/--mg-font-*` per video so all
  scenes share one identity (brand accent from extract_palette when a logo exists).

## Scene skeleton
```html
<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="fonts/fonts.css"><link rel="stylesheet" href="motion-kit/motion.css">
<style>:root{ --mg-accent:#0a7d5b } /* per-video theme + bespoke bits */</style>
</head><body>
<div class="mg-scene mg-safe mg-center mg-col">
  <div class="mg-wash"></div>
  <div class="mg-kicker mg-reveal">STEP 1</div>
  <h1 class="mg-title mg-reveal" style="--at:.25s">Eat more soluble fibre</h1>
  <div class="mg-row mg-stagger" style="--at:.9s">
    <div class="mg-chip mg-pop"><!-- inline SVG from search_assets --></div>
    ...
  </div>
</div>
<script src="motion-kit/motion.js"></script>
</body></html>
```
