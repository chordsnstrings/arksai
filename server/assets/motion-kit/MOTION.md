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

## NOTHING IS EVER STATIC (micro-animation doctrine — non-negotiable)
A held, frozen frame reads as a slideshow, not a video. EVERY visible element must either
(a) enter with a smooth entrance that SETTLES INTO an ambient idle — `.mg-float` (drift),
`.mg-breathe` (subtle scale), `.mg-sway` (±0.6°), `.mg-bob`, `.mg-pulse`, `.mg-shimmer` —
or (b) ride a container motion (`.mg-camera-zoom`/`.mg-camera-pan`/`.mg-kenburns`/parallax).
Rules of smoothness: transform/opacity ONLY; soft cubic-bezier easings everywhere (linear is
reserved for camera drift and parallax); entrances 0.5–0.9s with a gentle overshoot for
emphasis pops; STAGGER every group (`.mg-stagger`, or −ve `--at` offsets so idles never move
in lockstep); numbers tick (`data-count-to`), lines draw (`.mg-draw`), highlights sweep —
never appear fully formed. Before finishing a scene, scan it: anything that would sit
pixel-frozen for more than a second needs an idle or a camera.

## STYLE PACKS (pick ONE per video — it governs every scene)
State the chosen style in scene 1's comment. Each pack has its own ground set, components
and motion doctrine; SCENE CONTRAST still applies within the pack's grounds.

### `nutshell` — premium science-explainer (Kurzgesagt-inspired)
- GROUNDS: `.mg-ground-space` (cosmic gradient) alternated with `.mg-ground-dark` and one
  accent scene; never a light ground. Theme: 4–6 saturated neon hues per video — e.g.
  --mg-accent #e30050 (magenta) / --mg-accent-2 #24c4ff (cyan) + golden #fbbe00 highlights
  on deep indigo (#0b0a34 family). Never pure black.
- LOOK: flat geometric vector, NO outlines; shading = a darker hue-shifted shape, never
  grey; `.mg-glow` on anything emissive (orbs, screens); `.mg-orb` planets; `.mg-hills`
  parallax planes for depth; a `__mgScatter('stars',{count:120,seed:N})` starfield in space
  scenes (≤150 dots); `.mg-grain` on hero scenes only.
- CAST: the `.mg-bird` mascot reacts to the narration (hop/flap/look-*/blink) — comedy and
  empathy live in the character, one per scene max.
- MOTION: pop-with-overshoot entrances, everything drifts or floats, hard cuts on beats,
  one slow camera move per scene.

### `broadcast` — high-tempo infographic storytelling (Infographics-Show-inspired)
- GROUNDS: `.mg-ground-stage` (bright, with a floor line) as home base; `.mg-ground-dark`
  for grim beats. Color codes MEANING: danger red, money green, info yellow.
- LOOK: bold outlined props (colorful `prop:` assets from search_assets), `.mg-callout`
  boxed labels (yellow default, `.danger`/`.money` variants, `.big` numerals) — EVERY number
  spoken in the narration appears as a callout within a beat; `.mg-tag` arrow labels pinned
  to subjects; `.mg-vs` split-screens for comparisons.
- MOTION: relentless — short scenes, slide/pop entrances, `.mg-bob` idles on characters,
  a Ken Burns or pan on every held composition. Speed over subtlety.

### `vox` — annotated-evidence editorial (Vox-inspired)
- GROUNDS: `.mg-ground-studio` (warm gray photo-studio) as home; `.mg-ground-dark` for
  archival/night beats; occasional full-bleed `.mg-plate` scenes.
- LOOK: a PLATE (a generate_image photographic/still-life image of a real prop or scene —
  text-free — or a large flat SVG composition) fills or anchors the frame with
  `.mg-kenburns`; annotations layer ON TOP: `.mg-label-vox` yellow boxed labels in bold
  caps (`.num` for big figures, `.ink` for black), `.mg-highlight` highlighter sweeps over
  key phrases, `.mg-underline` red underlines, `.mg-connector` lines drawing from label to
  subject; `.mg-title-serif` for editorial headings. Restrained palette: studio gray +
  yellow #ffe600 + ink + one red.
- MOTION: calm and precise — slow pushes, labels fade-up then hold, highlights sweep as
  the narrator says the words. The annotation IS the animation.

### default (`clean`) — the house motion-graphics style (what you get with no pack): the
base kit + SCENE CONTRAST doctrine as documented below.

## SCENE CONTRAST (non-negotiable — the #1 review failure)
Consecutive scenes must read as a real CUT, never the same slide re-worded. Across the
video, VARY two things on every scene change:
1. **The ground** — alternate `.mg-ground-dark` (ink, light text) and `.mg-ground-accent`
   (deep accent, white text) against the default light ground. A good 6-scene rhythm:
   light hero → light card → **dark stat** → light split → **accent emphasis** → dark
   closing. Never more than TWO consecutive scenes on the same ground.
2. **The composition** — rotate layout archetypes: centered hero (`.mg-center`), asymmetric
   split (`.mg-split` + `.mg-left`), one giant number (`.mg-hero-stat`), an icon grid
   (`.mg-row .mg-stagger`), a full-width band (`.mg-band`), an edge-anchored `.mg-rail`
   scene. Two adjacent scenes must never share BOTH ground and composition.
Scale contrast helps too: one scene whose stat fills a quarter of the frame beats another
medium-sized card.

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
