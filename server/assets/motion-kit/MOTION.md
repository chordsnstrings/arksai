# Motion-kit — authoring scenes for narrated motion graphics

Each scene is ONE self-contained HTML file rendered frame-by-frame by the capture harness.
The harness owns time: it injects `--scene-ms`/`--scene-s` (derived from the narration
audio) and steps `window.__seek(ms)` per frame.

## SCAFFOLDS FIRST (how to author at media-house quality)
Prefer `scaffold: {id, slots}` scene specs over hand-written HTML — the scaffolds carry
the choreography (entrances ≤1.2s, exits, camera, idles, composition, vignette, safe
areas) already correct, so you focus on the SCRIPT, the SLOT CONTENT and the ASSET PICKS.
Available scaffolds (see render_motion_video): `hook-question`, `hero-stat`,
`split-compare`, `process-steps`, `annotated-plate`, `callout`, `character-beat`,
`chart-insight`, `quote-punch`, `list-recap`, `end-punch`, and the STUDIO photo
scaffolds `photo-hero`, `cutout-stat`, `collage-compare`. Hand-write `html_file` scenes
only for signature moments a scaffold can't express — everything below then applies to
YOUR page verbatim.

## ANIMATED DATA (charts are built, never pasted)
Use the chart scaffolds (`bar-chart`, `line-chart`, `donut-stat`) for every data moment —
they animate like editorial dataviz: staggered bar growth with counting labels (ONE hero
bar in accent, the rest muted — one chart, one message), SVG line draw-on with an end dot
and counting end value, donut fills synced to their center count. Pass `source` for the
small credibility line (fades in last). Numbers COUNT (tabular-nums, ease-out) from a
meaningful origin. Static `render_chart` SVGs are for reports; in motion, data animates.

## EMPHASIS (which words get the treatment)
Mark the spoken keyword with *asterisks* in any scaffold text slot — it gets the pack's
kinetic emphasis (vox highlighter, nordic red rule, broadcast amber, accent sweep
elsewhere) timed to fire while it is spoken. SELECTION RULES: at most ONE emphasized
phrase per sentence, roughly every 2nd-3rd sentence — constant emphasis is zero emphasis.
Emphasize numbers, named entities on first mention, contrast pivots, the payoff noun,
negations. Never connectives, and never a word already highlighted by the visuals.

## SHOT GRAMMAR (edit like film, not like a template)
Alternate shot sizes irregularly — WIDE (photo/environment, focal ≤30% of frame), MEDIUM
(diagram/chart/compare), CLOSE (one giant number or word) — and never two consecutive
scenes from the same archetype family (data / type / photo / diagram); the tool flags
same-scaffold neighbours. Insert one `breath` scene (near-empty, quiet) per ~30s after a
dense stretch; use `chapter-card` (1.5-2.5s via min_ms, silent or 3-4 word narration) only
at genuine act breaks. Entrance direction follows MEANING: growth rises, decline drops,
compared things enter from opposite sides.

## THE DESIGN LIBRARY (search, never invent)
`search_motion_design` indexes ~900 intent-tagged presets: TYPE voices/pairings (every
bundled family in hero/headline/label/numeral/quote/echo treatments), CALLOUTS (pills,
stamps, flags, ribbons, badges, brackets, labels — toned and sized), animated
BACKGROUNDS (drifting dot grids, rain/rise stripes, blueprint grids, contour waves,
morphing accent blobs, orbit rings, light sweeps — each at whisper/standard/present
opacity), and MICRO effects (entrances by role+timing, phase-offset idles, emphasis).
Query by INTENT ("calm drifting texture", "urgent number callout", "premium serif hero"),
paste the returned snippet into bespoke scenes, or pass a background id as the `bg` slot
on ANY scaffold. NEVER hand-roll a background pattern, callout box or entrance — a library
pick is calibrated, seekable and pack-aware.

## STUDIO MATERIAL (real photos + cutouts — the studio look)
Photography is design MATERIAL, never a raw stock rectangle. Per video, aim for 1-2
photo-driven beats: a `photo-hero` (full-bleed duotone/archival plate + giant type), a
`cutout-stat` or `collage-compare` (background-removed subjects). Get material with
search_photos — pass `cutout:true` to also produce `<photo>-cutout.png` (transparent
subject; needs a photo with ONE clear subject). Treatments in the kit: `.mg-cutout`
(+`.sticker` die-cut white outline on nutshell/broadcast, `.ink` outline on nordic),
`.mg-duotone` (accent-toned plate), `.mg-archival`, `.mg-halftone`, `.mg-tape`,
`.mg-torn`, `.mg-polaroid`, `.mg-crop-circle`/`.mg-crop-arch`, `.mg-photo-grain`.
Rules: every plate gets a treatment or a scrim (raw photo + raw text = student tell);
cutouts get a shadow or outline and may bleed off-frame; the photo must LITERALLY show
the narration's subject (the vision gate checks).

## Hard rules (a scene that breaks these renders wrong)
1. Link `motion.css` + `motion.js` + `fonts/fonts.css` with RELATIVE paths. No external
   http(s) resources anywhere — fully self-contained.
2. NO wall-clock: no requestAnimationFrame state, no setInterval/setTimeout visuals, no
   `Date.now()`. All motion = CSS animations (the kit's classes or your own keyframes with
   `animation-fill-mode: both`) or `window.__motionHook((ms) => …)` deriving purely from ms.
3. Entrances COMPLETE within ~1.2s (headline visible within 0.5s of the cut); ambient
   idles + one camera move carry the hold; content EXITS in the final ~0.4s (`.mg-exit-up`
   on the content wrapper — a frame that sits frozen into a cut is a defect). For
   proportional timing use `animation-duration: calc(var(--scene-s) * 1s)`.
4. One idea per scene. Fill the frame ~85–100%; safe margins via `.mg-safe`.
5. Icons/logos come from `search_assets` (inline the materialized SVG) — never hand-drawn
   paths, and the icon must literally depict its label (an apple labeled "butter" kills
   credibility). Real photography comes from `search_photos` (or generate_image when no
   quality photo exists). Charts come from `render_chart` SVGs (animate bars with
   `.mg-bar-v`, lines with `.mg-draw`).

## THE HOOK (scene 1 — non-negotiable)
55% of viewers are lost in the first 60 seconds; short-form viewers decide in ~3s. Scene 1
must EARN the rest of the video:
- ≤5s long, and something MOVES in the first second (never a title card, logo, greeting,
  or "in this video…" — those narrations are rejected before rendering).
- The narration's first sentence poses the payoff as a QUESTION, a BOLD CLAIM, a STAKE, or
  a SHOCKING NUMBER. Templates: "Why does [surprising fact]?" · "[X] isn't [assumed] —
  it's [surprising]." · "You're doing [common thing] wrong, and it costs you [stake]." ·
  "[Specific number] — and almost no one knows why." · "Most people think [wrong belief].
  Watch what actually happens." · "[Option A] or [Option B]? Pick wrong and [consequence]." ·
  "This is [end result]. Here's how it got there."
- Tease, don't resolve: the hook opens a loop the FINAL scene pays off. Anticipation, not
  the answer, is what holds attention (dopamine fires on the predictive cue).

## SCRIPT DOCTRINE (write the narration for retention)
The tool REJECTS scripts with essay scaffolding, engagement CTAs or hype promises before
any audio is synthesized, and returns advisory notes on intensifiers/hedges/AI-lexicon/
rhythm — write to this doctrine the first time.

STORY SPINE, NOT ESSAY. A video script is a chain of collisions, not a structured summary:
- The writers-room rule: every scene joins the next with BUT or THEREFORE — tension (but,
  except, turns out, the problem is) or consequence (so, which means, that's why) — NEVER
  "and then" or "additionally". If you can reorder two adjacent scenes without breaking anything, the
  link between them is missing. Scripts with zero connectives are rejected.
- Beat templates by length (at ~2.0 spoken words/s for shorts, 2.4 for longer):
  · 15s ≈ 30 words: HOOK (≤10w) → TENSION/reveal → PUNCH-OUT (≤6w).
  · 30s ≈ 65 words: HOOK → SETUP → TWIST ("but…") → RESOLUTION → PUNCH-OUT.
  · 60s ≈ 140 words: HOOK → STAKES (why care) → 2–3 escalating reveals (each a "turns
    out…") → the PEAK number/moment → PUNCH-OUT that calls back to the hook.
  · 3min+: chapter the script — each chapter has its own mini-hook and mini-payoff, and a
    re-hook ("but that's not the strange part") every 30–40s.
- Open loops: the hook poses a question the FINAL scene answers; mid-script, resolve each
  loop only after the next one is open. Never resolve everything before the last beat.

LANGUAGE CRAFT (what separates spoken prose from essay prose):
- Concrete nouns beat abstractions: "your coffee" not "caffeinated beverages"; a person
  doing a thing, not a concept being the case. If a sentence has no image in it, rewrite.
- "You" is the stakes-carrier — anchor consequences in the viewer ("your money", "your
  sleep") or in one named character carried through the video. Facts without an owner
  are trivia.
- Translate every number ("naked hero stat" rule): a number lands only next to a
  comparison the ear can hold — "42% — nearly half of everything you drink", "that's
  three school buses", "twice your rent". One hero number per scene; the rest go on
  screen, not in the mouth.
- Rhythm is deliberate: vary sentence length — two short, one long, one very short.
  Three same-length sentences in a row read as a list being recited. Hard max ~20 words
  per spoken sentence; one idea per sentence.
- Kill the tells: no empty intensifiers (truly/incredibly/absolutely — delete or upgrade
  the base word), at most one deliberate hedge in the whole script, none of the AI lexicon
  (delve, tapestry, unlock, unleash, elevate, journey, seamless, robust, game-changer,
  testament, deep dive, "the world of…"), no essay scaffolding (firstly/moreover/in
  conclusion/"in today's world"), no hype promises ("you won't believe", "mind-blowing" —
  if the fact is good, the fact carries it).

WRITE FOR THE EAR (this text is spoken by TTS, not read):
- Contractions always (it's, don't, that's) — but avoid "-'ve" contractions after nouns
  ("the results've") which TTS mangles; spell out "have" there.
- No abbreviations, symbols or parentheses: "about 40 percent" reads better aloud than
  "(~40%)"; expand acronyms on first use unless universally spoken (NASA fine, "WHO" say
  "the World Health Organization").
- End-focus: put the payoff word LAST in the sentence — "The real cause is sugar", not
  "Sugar is the real cause of this". The ear weights sentence endings.
- Landing-strip last line: the final narration sentence is short (≤8 words), concrete,
  and callable back to the hook. Never end on a list item, a disclaimer, or a CTA
  ("like and subscribe" is rejected).
- Read it aloud mentally: anywhere you'd stumble or take a breath mid-clause, split the
  sentence.
- On-screen text NEVER duplicates the narration (redundancy hurts comprehension): 5–12
  words max on screen, keyword labels not sentences, labels sit NEXT TO what they name.
- The visual for a thing appears AT THE MOMENT the narration says it: derive `--at` from
  the word's position — `--at ≈ (chars before the word / total chars) × narration seconds`.
- Peak-end: engineer ONE emotional peak (the biggest reveal/number/moment) and end on a
  short punch-out scene (`end-punch`), never a disclaimers wall. The final scene is the
  SHORTEST scene, not the longest.

## PACING & RHYTHM
- Scene mix per minute: 1–2 punch beats (1.5–2.5s, silent `min_ms` or ≤6 words), a
  majority of 3–6s scenes, at most one 7–10s dwell. Uniform scene lengths read as a
  slideshow — the tool warns when every scene is within ±15% of the median.
- Something VISIBLY changes at least every ~4 seconds inside a scene (a reveal, a counter,
  a sweep, a label landing) — one visual event per narration beat: every spoken number or
  named noun triggers exactly ONE on-screen change; no beat passes with zero change.
- Micro-arc per scene: enter (headline ≤0.5s, staggered 40–80ms, parent before children) →
  UNFOLD (secondary content arrives PROPORTIONALLY across the scene — `--at:
  calc(var(--scene-s) * 0.4s)` or counter `data-count-start-frac="0.4"` — so each element
  lands roughly as the narration reaches it, never all piled into the first second) →
  exit (final ~0.4s). Scaffolds do this automatically.
- THE ENDING LANDS, never stops: the final scene gets extra hold and the assembled video
  fades out automatically. With a MUSIC bed the ending is a proper outro: the last scene
  holds ~2.6s past the final spoken word, the ducked bed rises back to full and carries
  the frame, then music+picture fade out over ~1.8s — the narration itself is never faded
  or clipped. Without music: a short breath + ~0.9s fade. Author the last narration line
  as a closing thought, not a mid-list item, and give the final scene visuals that can
  hold the outro (living ambients, the punch-out word breathing).
- After 3–4 dense scenes, one breather beat (single statement, sparse frame).
- Re-hook cadence: a reveal/tension renewal every ~30–40s (short videos) or every 2–3
  minutes (long ones) — schedule them in the script before writing scenes.

## NOTHING IS EVER STATIC (micro-animation doctrine — non-negotiable)
A held, frozen frame reads as a slideshow, not a video — the render FAILS a scene whose
frames are pixel-static. EVERY visible element must either
(a) enter with a smooth entrance that SETTLES INTO an ambient idle — `.mg-float` (drift),
`.mg-breathe` (subtle scale), `.mg-sway` (±1°), `.mg-bob`, `.mg-pulse`, `.mg-shimmer` —
or (b) ride a camera move: EVERY scene wraps its stage in `.mg-cam-in` / `.mg-cam-out` /
`.mg-cam-drift` (alternate the direction scene to scene; never two consecutive scenes with
the same camera). Rules of smoothness: transform/opacity ONLY; the kit's easing tokens
(`--mg-ease-out` entrances, `--mg-ease-exit` exits, `--mg-ease-back` for 1–2 focal pops)
— linear is reserved for parallax; entrances 0.3–0.7s traveling SHORT distances (2–4vh —
long flights read student); STAGGER every group (`.mg-stagger`, or −ve `--at` offsets so
idles never move in lockstep); numbers tick (`data-count-to`), lines draw (`.mg-draw`),
highlights sweep — never appear fully formed. Secondary motion sells realism: `.mg-lag`
on a label/shadow so it trails its owner, `.mg-squash` on landings, `.mg-stress` pulse
when the narration stresses an element. Before finishing a scene, scan it: anything that
would sit pixel-frozen for more than a second needs an idle or a camera.

LIVING FRAME (the mid-scene bar): a camera move alone reads as a slide with a slow zoom —
the QC flags weak mid-scene motion. Between the entrance and the exit the frame must keep
breathing: wrap the background echo in `.mg-drift` (perpetual slow translate; tune
`--ddur/--dx/--dy`), put `.mg-bob` on icons/chips (phase-offset with negative delays),
`.mg-shimmer` on labels/attributions, and a `.mg-runline` (a hairline whose accent segment
slowly travels) across an empty lower band. Scaffolds bake all of this in — bespoke
`html_file` scenes must add it themselves.

## TYPOGRAPHY IS THE SET (never slide-like)
A uniform-size centered text stack reads as a slide. Every scene's type is COMPOSED:
- SCALE CONTRAST ≥3×: one element set huge (`.mg-giant`, a 25-32vh stat, a 15vh+ key
  word) against small tracked labels (`.mg-rulelabel`, `.mg-vert`). Mixed sizes INSIDE a
  headline: short lines huge, long lines smaller (scaffolds do this automatically).
- TEXTURE TYPE: a giant outlined echo word/number in the background (`.mg-echo
  mg-outline`, ~35-50vh, opacity ≤0.1, bleeding off-frame, drifting on `.mg-depth-bg`).
- PLACEMENT: off-center blocks, edge anchors (`.mg-vert` vertical rail kickers),
  staircase indents on lists, a `.mg-tilt-l/r` wrapper on a stamp/label — never
  everything centered.
- Type may BLEED off-frame when it's texture; content type stays inside `.mg-safe`.

## KINETIC TYPE (text performs; it is never merely placed)
- Titles: masked line rise — `<span class="mg-mask"><span class="mg-rise">Line</span></span>`,
  lines staggered 80–120ms.
- Hook lines / key sentences: `.mg-words` (words reveal one by one — time the group's
  `--at` to the phrase being SPOKEN).
- THE key word: `.mg-key` (arrives last, overshoot pop, accent color) or `.mg-mark`
  (accent sweep) / `.mg-highlight` (vox yellow) timed to the exact spoken word.
- Numbers: `data-count-to` counters — the value is never shown pre-formed; add `.mg-stress`
  at the count's end.
- Max ~8–12 words on screen; display type ≥6vh; labels ≥2.4vh; everything inside `.mg-safe`.

## TRANSITIONS (frame-to-frame polish)
- The DEFAULT cut is choreographed: outgoing scene exits (`.mg-exit-up` wrapper), incoming
  headline lands within 0.5s. Cut on narration phrase boundaries (the holds).
- Designed transitions are reserved for ACT boundaries (idea shifts) — 1–2 per minute max,
  ONE grammar per video. Set per scene via `transition`: `dip` (dip to black),
  `dissolve`, `wipe`, `slide`, `circle` — the tool renders them at the seam (narration is
  never crossfaded; the fade window fits inside the silent holds).
- Continuity devices: scenes within one act share the ground (the ground change IS the act
  change); for an object-carry/match cut, place the shared element at the SAME coordinates
  in the last frame of scene N and the first frame of scene N+1.

## FORMATS (the same scene must be DESIGNED at any size)
The engine stamps a format class on every scaffold scene: landscape (16:9), `.mg-fmt-sq`
(1:1 and 4:5 — row layouts survive but everything tightens: shorter margins, `vmin`-bound
props, floor lines drop lower), `.mg-portrait`/`.mg-fmt-tall` (9:16 — full-height stacked
compositions, `space-evenly`, width-bounded display sizes). Bespoke `html_file` scenes:
never assume 16:9 — size display type with `min(Xvh, Yvw)`, stack columns when the frame
is taller than wide, and keep text inside `.mg-safe` at every aspect.

## STYLE PACKS (pick ONE per video — it governs every scene)
State the chosen style in scene 1's comment. Each pack has its own ground set, components
and motion doctrine; SCENE CONTRAST still applies within the pack's grounds.
PACK DNA IS IN THE ENGINE: every scaffold scene carries `.mg-style-<pack>` — accents,
display-type voice (nutshell heavy sans, broadcast shouting uppercase, vox/nordic/clean
editorial serif) and card treatments (broadcast comic-outlined, nordic ruled print,
nutshell soft glass) apply automatically; a passed `accent` still overrides.

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
- LOOK: a PLATE — a REAL photograph from `search_photos` (or generate_image when no
  quality photo exists; text-free) — fills or anchors the frame with `.mg-kenburns`;
  text over a plate sits on `.mg-plate-scrim`; annotations layer ON TOP:
  `.mg-label-vox` yellow boxed labels in bold caps (`.num` for big figures, `.ink` for
  black), `.mg-highlight` highlighter sweeps over key phrases, `.mg-underline` red
  underlines, `.mg-connector` lines drawing from label to subject; `.mg-title-serif` for
  editorial headings. Restrained palette: studio gray + yellow #ffe600 + ink + one red.
  The evidence IS the design — a vox scene without a plate or a chart is a defect.
- MOTION: calm and precise — slow pushes, labels fade-up then hold, highlights sweep as
  the narrator says the words. The annotation IS the animation.

### `nordic` — Swiss/Scandinavian grid editorial (Müller-Brockmann × Form magazine)
- GROUNDS: `.mg-ground-paper` (warm paper + ink + ONE accent, default red #e32219 —
  swap for a muted Scandi tone: sage #6f7d6b, dusty blue #5e7387, clay #b0684a) as home;
  `.mg-ground-night` (#20242b + gold) and `.mg-ground-dark` for contrast beats.
- LAYOUT LAW: everything on the 12-column grid (`.mg-grid12`); type flush-left
  ragged-right, NEVER centered (exception: one poster word); max THREE text sizes per
  frame with ≥5× contrast between display and support; whitespace ≥55%; one message,
  ≤12 words; accent covers ≤10% of the frame.
- DEVICES: `.mg-kick-rule` kicker-on-hairline; `.mg-numeral` oversized numerals
  (40-70vh, `.ghost` at 9% ink, cropping an edge is sanctioned); `.mg-hairline` rules
  (≤3); ONE `.mg-vert` rotated rail; photos grayscale, grid-obedient, ≤1 per frame;
  flat geometry only — zero gradients/shadows/rounded cards.
- KINETIC TYPE (ONE device per scene — restraint IS the style): `.kt-stamp` word-stamp
  on the speech beat · `.kt-swap`(+`.hold`) giant word swap with HARD cuts ·
  `.kt-track-in` once per video on the title · `.kt-rail-wipe` for the rail ·
  `.kt-drop` at most once · `.kt-caret` typewriter caret. Idles stay subtle here
  (breathe on at most one element) — this pack tolerates less wobble.
- TYPE ROLES: Inter = the Helvetica role (display 650-700 tight, body 400/1.5);
  Space Grotesk = kickers/numerals; Source Serif 4 = ledes/pull-quotes (the Berling
  role); IBM Plex Mono = captions/annotations. Max 2 families per video.

### default (`clean`) — the house motion-graphics style (what you get with no pack): the
base kit + SCENE CONTRAST doctrine as documented below. Give every scene a PLACE:
`.mg-ground-floor` (floor plane) or a dark/accent ground + `.mg-vignette`; anchor one
oversized element (`.mg-prop-hero`, edge-bled) or a `.mg-hero-stat`; icons sit in
`.mg-chip` tiles with `.mg-contact` shadows — never floating alone on flat white.

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
- Stage: `.mg-scene .mg-safe [.mg-center]`, `.mg-row/.mg-col/.mg-grid`, `.mg-wash` backdrop,
  `.mg-vignette` atmosphere, `.mg-ground-floor` floor plane, `.mg-prop-hero` edge-bled prop.
- Type: `.mg-kicker` (mono eyebrow), `.mg-title` (serif display), `.mg-sub`, `.mg-stat`
  (big tabular number), `.mg-label`; kinetic: `.mg-mask`+`.mg-rise`, `.mg-words`, `.mg-key`,
  `.mg-mark`.
- Entrances (delay via `--at`, e.g. `style="--at:.6s"`): `.mg-reveal .mg-fade .mg-pop
  .mg-slide-l .mg-slide-r .mg-wipe`; stagger a group with `.mg-stagger` (`--stagger`).
- Exits (on a wrapper): `.mg-exit-up .mg-exit-fade .mg-exit-down .mg-exit-scale`.
- Secondary: `.mg-lag` (follow-through), `.mg-squash` (landing), `.mg-stress` (spoken-word
  pulse), `.mg-contact` (grounding shadow).
- SVG draw-on: wrap the icon in `.mg-draw` (set `--len` ≈ path length for tight timing).
- Ambient: `.mg-float .mg-pulse .mg-breathe .mg-bob`; camera: `.mg-cam-in` / `.mg-cam-out` /
  `.mg-cam-drift` (v2, eased) or `.mg-camera-zoom` / `.mg-camera-pan`; depth:
  `.mg-depth-bg/.mg-depth-mid/.mg-depth-fg` parallax layers.
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
<div class="mg-scene mg-ground-floor">
  <div class="mg-wash"></div>
  <div class="mg-cam-in mg-fill" style="display:flex">
    <div class="mg-exit-up mg-safe mg-center mg-col mg-fill" style="display:flex">
      <div class="mg-kicker mg-reveal">STEP 1</div>
      <h1 class="mg-title"><span class="mg-mask"><span class="mg-rise">Eat more</span></span>
        <span class="mg-mask"><span class="mg-rise" style="--at:.12s">soluble <span class="mg-key" style="--at:.5s">fibre</span></span></span></h1>
      <div class="mg-row mg-stagger" style="--at:.7s">
        <div class="mg-breathe"><div class="mg-chip mg-pop mg-contact"><!-- inline SVG from search_assets --></div></div>
        ...
      </div>
    </div>
  </div>
  <div class="mg-vignette"></div>
</div>
<script src="motion-kit/motion.js"></script>
</body></html>
```
