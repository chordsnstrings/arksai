# Motion craft research (2026-07-05) — studio-grade explainer grammar, encodable in CSS/SVG

Operator directive: "research as much as you can to ensure we can create beautiful videos
which doesn't look templated and doesn't have that AI look". Full practitioner-source
research distilled here; the ENFORCED subset lives in `server/assets/motion-kit/MOTION.md`
and the scaffold/QC code. This file is the reference for future craft passes.

## Easing (the #1 pro-vs-template signal: different curves for enter/exit/move)
- entrance: cubic-bezier(0.22, 1, 0.36, 1) (out-quint) / (0.16, 1, 0.3, 1) (out-expo, big elements)
- exit: cubic-bezier(0.7, 0, 0.84, 0) (accelerating)
- move A→B: cubic-bezier(0.65, 0, 0.35, 1)
- overshoot pop: cubic-bezier(0.34, 1.56, 0.64, 1) (~15%)
- chart growth: cubic-bezier(0.25, 1, 0.5, 1) (fast attack, long settle) — kit token --mg-ease-chart

## Animated dataviz
- Build order ALWAYS: frame (axes/grid, 0-400ms) → data (from ~300ms, overlapping) →
  value labels (only when their mark is ~80% grown) → annotation/insight (40-70% into the
  scene, on the narration beat, never at t=0).
- Bars: grow from baseline via scaleX/Y (never fade in at full size); 600-900ms each;
  stagger min(110ms, 1200ms/n); total build ≤1.6s. ONE hero bar in accent (grows last,
  slightly slower, counting label), everything else ONE muted neutral. Overshoot on the
  hero only.
- Lines: stroke draw 1.2-2.5s; ease the NARRATIVE (slow the boring 60%, rush the payoff);
  leading/end dot = accent, ~1.5× stroke width, pops when the draw completes; area fill
  fades AFTER the stroke (≤15% opacity). Highlight-one-series: context series gray first
  and fast, hero drawn on top slower. Direct labels, never legends; ≤4 horizontal
  gridlines, none vertical; source line small-caps at bottom, fades in last.
- Counters: 800ms-2s, ease-out, tabular-nums MANDATORY; count from the meaningful origin
  (previous value for changes, 0 for magnitudes); animate the value, not the unit.
- Donuts: stroke-dashoffset 900-1400ms from 12 o'clock; center count lands together with
  the sweep; never two donuts animating simultaneously.
- Bar races: only when rank-change IS the story; ≤10 bars; ≤15s; end frozen 1.5s+ with
  the winner annotated.

## Animated icons (semantic motion mapping)
- draw-on (stroke reveal, 500-800ms, round caps, sub-paths staggered 80-120ms overlapping
  at 60%): introducing a concept. Add ONE settle beat after (micro-pop 1→1.06→1).
- pop with overshoot (scale .6→1, 350-450ms): list items, additions, confirmations.
- damped shake (±6°, 3 cycles, each 60% of previous amplitude, 500ms): danger/error/"no".
  Constant-amplitude shake = template.
- pulse (1→1.08, 900ms, ≤3 loops then rest): "look here now".
- rotate: only things that literally rotate. morph/crossfade (out: scale .85 + fade 200ms,
  in: 1.15→1, 100ms overlap): transformation narratives.
- bob idle (±1.5%, 3-4s, phase-offset siblings): anything on screen >2.5s.
- Choreography: icon lands ON its stressed word (atFrac), completing ≤150ms after the word;
  spoken lists stagger at speech rhythm (~600-900ms), not a uniform burst; ONE primary
  action at a time; secondary accents smaller and 100-150ms later.
- Micro-vocabulary reproducible in CSS: checkmark-draw, cross-draw, ring-pulse, badge-pop,
  bell-ring (damped, pivot top), heart-beat (two pulses then rest), eye-blink (scaleY),
  arrow-nudge, squash-on-impact (scaleX 1.08/scaleY .92, 80ms — cheapest "weight").

## Kinetic text emphasis
- Vocabulary: highlighter sweep (250-400ms, starts ~80ms BEFORE the word is spoken,
  translucent accent, multiply on light); boxed word (term definitions); underline draw;
  scale pop 1→1.15→1.05 + weight jump (surprise); color flip (quietest); redaction
  reveal; hand-drawn circle annotation (350-450ms, slight rotation, overlapping ends);
  stamp/match-cut sequence (6-12 cuts, ~330ms accelerating to ~180ms, scale punch each).
- SELECTION RULES: ≤1 emphasized phrase per sentence, roughly every 2nd-3rd sentence.
  Emphasize numbers, named entities (first mention), contrast pivots, the payoff noun,
  negations. Never verbs of being, connectives, or words already visually present.
  Register: highlighter=evidence, box=term, pop=surprise, underline=argument.
- Shorts word-pop captions: one word/2-3-word phrase at a time, lower-middle third (never
  bottom 20%), 120-150ms scale-pop entrance, hard swap (no exit), weight 800-900, ~1 in
  6-10 words gets the accent.
- Type: masked line rise is the editorial default (translateY .6em→0, 450-600ms, per-line
  stagger 80-120ms); per-CHARACTER animation is a template tell; size contrast ≥3:1 in a
  stack; full line readable within 1/3 of its screen time; ≤6-8 words/line, 2 lines.

## Templated/AI-look tells → counters
Tells: uniform entrances; perfect centering everywhere; default `ease` for everything;
uniform scene lengths; purple-blue gradient washes + glow-behind-everything; everything
animates at t=0 then freezes; no overshoot/settle/weight; no motion hierarchy; legends +
rainbow palettes; zero texture/imperfection.
Counters (encodable):
- SHOT GRAMMAR: alternate WIDE (focal ≤30% of frame) / MEDIUM / CLOSE (focal ≥60%);
  never two consecutive scenes with the same shot size AND ground; never two consecutive
  scenes from the same archetype family (data/type/photo/diagram).
- Asymmetry default: focal mass on a thirds intersection; a deliberately empty quadrant
  in ≥half of scenes; balance with type or negative space, not mirror elements.
- Art-directed imperfection: skewed highlights (1-2°), elbowed leader lines, hand-drawn
  circles that don't close, seeded ±2-4% jitter on staggers/idle phases, 2-3% grain,
  treated photos.
- Pacing: scene lengths vary ≥2× shortest-to-longest; one quiet "breath" scene per ~30s
  after a dense stretch; explainers average 8-12 cuts/min.
- Motion hierarchy budget: 1 primary action + ≤2 secondary reveals per scene, all else
  idles ≤2%.
- Entrance direction follows MEANING (growth rises, decline drops, comparisons enter from
  opposite sides) — never the template slot.
- Camera: alternate zoom-in / zoom-out scenes (matching consecutive directions reads as a
  slideshow plugin).

## Scene grammar — 22 archetypes (Vox/Kurzgesagt/Economist/Bloomberg/Harris)
cold-open hook (CLOSE) · chapter title card (ghost number + rule, 1.5-2.5s breather) ·
full-bleed photo + corner label (WIDE) · annotated evidence/document (Harris: tilted doc,
push-in, highlighter on the key sentence) · hero stat (CLOSE) · data moment (chart 60% +
insight in whitespace + source line) · focus-shift chart (same chart, series gray out,
camera pushes) · diagram build-up (nodes pop, connectors draw AFTER endpoints, ≤7 nodes) ·
process rail (steps light as spoken, previous dim to 50%) · split VS (45/55 not 50/50,
sides from opposite edges 150ms apart) · before/after wipe · map moment (region fill, pin
drop with squash, routes draw) · timeline scrub (playhead travels, events pop alternating
above/below) · character beat (Kurzgesagt lane) · metaphor stage (ONE metaphor recurs
across the video) · icon triptych (≤4, speech-rhythm stagger) · quote card (ghost
quotation mark, serif mixed sizes, attribution after 60%) · receipts montage (3-6 cuts
400-700ms accelerating, scale punch each) · zoom-out context reveal (CLOSE→WIDE pullback)
· counter-swarm (unit multiplies into a field, ≤150 elements, waves 20-40ms) · the breath
(near-empty, 2-4s, no/minimal text) · end punch (biggest type of the video, ONE final
micro-action, no new info).
Built as scaffolds so far: hook, chapter-card, photo-hero, annotated-plate, hero-stat,
bar/line/donut charts, process-steps, split-compare + collage-compare, timeline,
character-beat, quote-punch, list-recap, cutout-stat, breath, end-punch.
NOT yet built (future adds): map moment, before/after wipe, diagram build-up, receipts
montage, zoom-out reveal, counter-swarm, focus-shift chart.

Sources: Toptal/PixelFree/Flourish dataviz-animation guides; Economist chart style guide;
storytelling-with-data annotation practice; Vox dataviz/Atlas breakdowns (Bard Edlund, Sam
Ellis); Kurzgesagt workflow breakdowns (10.studio, Skillshare); SVGator/Cursa/LottieFiles
stroke + micro-animation guides; Adam Webb highlighter overlays; OpusClip/Blitzcut caption
conventions + AI-slop tells; Smashing/Filmmakers-Academy composition; StudioBinder pacing;
Josh Collinsworth / CSS-Tricks easing.
