# Motion Polish — from "student project" to media house

Operator verdict (2026-07-05): "the output for every style isn't polished. it seems like a
student project not a polished media house. the voice over is perfect but we need to work on
polish of each page, transition from one frame to the other, animations and even the asset
choice and the design. the icons placement the typography and pacing is bland. not
interesting enough. and it doesn't have hook… research neuroscience and dopamine and ensure
people are always engaged to the video whether 30 second or 30 minutes."

Three research passes feed this plan: (1) retention/hook/narration science + neuroscience,
(2) media-house motion-design craft translated to CSS/Chromium, (3) a frame-by-frame audit
of our three delivered videos (LDL 57.8s, LDL 143s, Vox 44.4s) with pixel-diff measurements.

## Root diagnosis (from the audit — measured, not felt)

The capture pipeline is NOT the problem (narration sync exact, cuts frame-clean, text
pixel-crisp). The delivered videos are **"enter → freeze → hard cut" typography slides**:

1. **Frozen frames**: LDL-60s frames at 0:20 vs 0:25 are bit-identical (mean gray diff
   0.00); the 143s cut freezes 14–23s per scene. The idle doctrine isn't executing, kit
   idles are too weak (breathe = 1.6% scale), and **QC samples 2 spot frames per scene so
   stillness is invisible to it by construction**.
2. **Hard cut is the only transition**; no exit animations exist in the kit at all
   (`fill-mode: both` entrances freeze elements until the splice). Cuts land on ~1–1.5s of
   near-empty incoming frame (350ms lead hold + slow `--at` chains) at the moment of
   maximum viewer attention.
3. **Frames 65–85% empty** (LDL S3 content in top-left quadrant for 11s) — "fill the frame"
   is doctrine but nothing enforces it. No grounds/environments/plates/props anywhere; the
   vox pack's defining device (annotated plates) went unused. One live rendering defect:
   the vox ground stops at 57% frame height leaving a visible seam for a full scene.
4. **No hook**: both LDL videos open on a literal document cover (title + number), the 143s
   one holds it for 18 seconds. Nothing in the doctrine demands a hook beat.
5. **Text is placed, not performed**: everything fades/pops in and sits; no word-timed
   reveals, no emphasis on the spoken keyword; walls of 40–50 words per frame.
6. **Monotone pacing**: scene lengths near-uniform (LDL: 8.7/8.3/11.1/8.9/8.3/12.7s);
   the LONGEST, most static scene is the outro.
7. **Asset semantics unchecked**: apple icon labeled "Butter"; olive oil and salmon share
   one fish icon; QC never asks whether an icon depicts its label.

Keep (audit's "already good"): the vox label/typography system, the persistent LDL ticker
(cross-scene continuity device), palette discipline, the 142→96 strikethrough payoff idea,
narration-sync determinism, font embedding.

## The science, distilled (what we encode)

**Retention/hooks** (YouTube/TikTok data, MrBeast memo, Veritasium research, Loewenstein
information-gap, Schultz reward-prediction-error, Gruber curiosity–dopamine, Kahneman
peak-end, Mayer multimedia learning):
- 55% of viewers are lost in the first 60s; ~65–71% of short-form viewers decide in 3s.
  The first scene must pose the payoff as a question/bold claim/stake with on-topic motion
  in the first 1–3s — never a greeting, topic statement, logo, or title card.
- Anticipation, not the payoff, drives dopamine (Schultz: dopamine fires on the predictive
  cue). Tease before revealing; plant open loops and pay them off later; end scenes on
  incomplete thoughts the next scene resolves.
- But/Therefore rule (South Park): every beat connects causally, never "and then".
- Habituation is why pattern interrupts work: change something visually every ≤4s; re-hook
  every ~30–40s (short) / ~2–3min (long); vary the reward schedule — payoffs must not be
  metronomic.
- Peak-end rule: the remembered video ≈ its emotional peak + its ending. Guarantee one
  peak moment; the ending is a crisp punch-out, never the longest static scene.
- Mayer: never duplicate narration as on-screen paragraphs (5–12 word ceiling); the visual
  for a concept animates AT THE MOMENT the narration says it; labels sit next to referents;
  one idea per scene; conversational second-person narration at 130–160 wpm.

**Craft** (School of Motion, Kurzgesagt/Vox breakdowns, Carbon/Material motion specs):
- Pros mostly HARD CUT — on narration phrase boundaries — but every cut is dressed:
  outgoing elements exit (250–400ms, accelerate), incoming choreograph in (≤1.2s total,
  decelerate, 40–80ms staggers, parent-then-children, reading order). Designed transitions
  (wipe/dip/zoom-through/match-cut) are reserved for act boundaries, ~1–2/minute, one
  grammar per video.
- Easing tokens: entrances `cubic-bezier(0.16,1,0.3,1)`, exits `cubic-bezier(0.3,0,0.8,0.15)`,
  overshoot `cubic-bezier(0.34,1.56,0.64,1)` (transform only, 1–2 focal elements max).
  Entrances travel SHORT distances (20–40px + fade + scale 0.96→1) — long flights read student.
- Anticipation (80–120ms counter-move), follow-through (shadow/label lags owner 60–120ms),
  arcs not straight diagonals, squash&stretch for props (±6–10%).
- Camera: every scene gets a push-in/pull-out/drift (1.0→1.03–1.06), direction alternating
  per scene; ≥2 parallax depth layers under it.
- A designed frame has: a ground/environment, ≥3 depth layers, ONE dominant focal element
  at 2–4× secondary scale, asymmetry, deliberate negative space, icons integrated (contained,
  consistent stroke, contact shadows, one light direction), texture/vignette, overlap and
  edge-bleed, connective tissue (drawn-on arrows/underlines).
- Kinetic type: masked line rise, word-by-word reveals timed to the voice, keyword
  scale-pop on the stressed word, highlight sweeps ON the spoken word, counters that
  finish with a settle pulse, exits that reverse compressed.
- Pacing: one visual event per narration beat (every spoken number/noun triggers exactly
  one on-screen change); scene mix per minute ≈ 1–2 punch scenes (1.5–2.5s) + mostly 3–6s +
  ≤1 long dwell; reading hold = max(1s per 13 chars, 2s); density ramps, breather beats.

## The plan — 6 phases

### Phase 1 — Script & hook doctrine (retention science into the writing)
- **Hook gate**: MOTION.md + the tool's planning guidance + prompts.ts demand scene 1 =
  a HOOK beat ≤5s: question / bold claim / stakes / misconception / shocking number, with
  motion in the first second — never a title card. Ship the 12 hook templates as
  fill-in-the-blank patterns. Deterministic pre-check in the tool: first scene narration
  matching greeting/topic-statement patterns ("welcome", "in this video", "let's talk
  about", title-echo) → hard defect before any TTS is paid.
- **Beat sheets** by length (30–90s single-loop; 3–10min with re-hooks every 2–3min and a
  midpoint reframe; 10min+ chaptered) with per-beat timing %, in MOTION.md; But/Therefore
  chaining + cliffhanger scene boundaries + one guaranteed emotional peak + punch-out
  ending (final scene SHORT, never the longest).
- **`target_seconds` param** on render_motion_video: wpm-based word budget (~2.4 words/s)
  per scene and total; tool warns/blocks when narration overshoots >25% (also fixes the
  live 140s-vs-60s length failure — currently only verbatim pinning works).
- **Narration rules** in the doctrine: 130–160wpm register, one idea per sentence, second
  person, concrete numbers, forward references; on-screen text NEVER duplicates narration
  (5–12 word frame ceiling — Mayer redundancy).

### Phase 2 — Motion kit v2 (choreography, kinetic type, environments)
- **Token system**: `--mg-ease-in/out/back` + a 4-step duration scale as CSS vars; all kit
  primitives consume them. Entrance ≤1.2s total (tightened from 3s), headline lands within
  500ms of the cut; staggers 40–80ms.
- **Exit primitives** (the single biggest upgrade): `.mg-exit` family driven off the scene
  tail (`animation-delay: calc(var(--scene-ms)*1ms - 350ms)`) — fade-rise-out, slide-out,
  mask-drop; doctrine: elements EXIT during the tail hold, nothing sits frozen into a cut.
- **Kinetic type**: `.mg-mask-rise` (masked line reveal), `.mg-words` (word-by-word stagger
  with per-word `--w` indices; motion.js splits `data-words` text into spans at load — the
  agent times the group start to the narration position), `.mg-key` keyword pop,
  highlight/underline sweeps get `--at` guidance to land ON the spoken word (word position
  estimated proportionally from character offset within the scene's narration — we know
  exact audio duration per scene).
- **Choreography**: anticipation + overshoot + settle baked into `.mg-pop/.mg-slide`;
  `.mg-lag` follow-through wrapper (shadow/label trails 80–120ms); squash&stretch
  `.mg-squash` for props; arc entrances via nested X/Y wrappers.
- **Camera v2**: eased push-in/pull-out/lateral presets with per-scene direction rotation;
  parallax layer classes (`.mg-depth-bg/-mid/-fg` at 0.3×/0.6×/1.2×); idle amplitudes
  raised to visible (breathe 3–4%, float 2–2.5vh) with desynced delays.
- **Environments for every pack** (not just nutshell): grounds with floor/horizon,
  vignette + grain on by default, icon containment shapes, contact shadows, edge-bleed
  oversized props (`.mg-prop-hero` ≥40% frame height), duotone icon recolor discipline.
  Vox pack: `generate_image` plates become a REQUIRED device (the planning step must give
  every vox scene a plate or an explicit visual anchor).

### Phase 3 — Transition system
- **Choreographed cut is the default** (exit + entrance, pure CSS — Phase 2 delivers it).
- **Per-boundary `transition` field** in the scenes array + manifest:
  `cut | dip | xfade-smooth | slide | circle` → stitch path upgrades from pure concat to
  segmented xfade at chosen boundaries (`xfadeCmd` gains kinds: fadeblack/fadewhite +
  smoothleft/smoothup/circleopen/slideleft; duration 400–600ms). Narration-safe by
  construction: fade window ≤ the tail hold (600ms) so voice never crossfades; audio
  stays cut. Doctrine: designed transitions at ACT boundaries only, 1–2/min, one grammar
  per video (avoid the cheesy xfades: pixelize/dissolve/squeeze).
- **Continuity devices**: background-continuity rule (scenes within one act share the
  ground; the act change is where the ground shifts); match-cut/object-carry pattern in
  MOTION.md — a `handoff` hint per scene boundary places the shared element at the same
  coordinates on both sides of the cut (the Kurzgesagt signature, pure authoring contract,
  no pipeline change).

### Phase 4 — Pacing engine
- **Beat-length variety enforced**: the plan step must produce a scene mix (per minute:
  1–2 punch beats 1.5–2.5s, majority 3–6s narration, ≤1 dwell 7–10s); tool warns when all
  scenes fall within ±15% of the median duration. Punch scenes = silent min_ms beats
  (mechanism already exists).
- **One visual event per narration beat**: MOTION.md authoring rule with worked examples —
  every number/noun spoken gets exactly one on-screen change, `--at` values derived from
  the word's character-position fraction × narration duration.
- **Micro-arc per scene**: enter (≤1.2s) → hold WITH idle+camera (reading time =
  max(1s/13 chars, 2s)) → exit (250–400ms). Breather rule after 3–4 dense scenes.
- **Ending**: final scene ≤ median length, one strong motion payoff (e.g. the 142→96
  strike-through grows to hero scale), never a disclaimers wall.

### Phase 5 — QC that can actually see the problems
- **Deterministic motion audit** (would have failed both LDL videos): after capture,
  pixel-diff already-on-disk frames at 40/60/80% (±0.5s pairs); mean diff below threshold
  → hard defect "scene N is static", same severity as a missing file. Cheap (frames exist;
  jpeg decode + diff, no model call).
- **Frame-fill audit**: ink/occupancy coverage on spot frames (the `detectEmptyPages`
  pattern from the PDF pipeline); <~45% occupied → defect. Also a ground-fill check
  (bottom-band background variance vs mid-band) to catch the vox 57%-seam class of bug.
- **Spot-frame timing fix**: sample 2% / 50% / 98% (was 32%/85% — never saw the first
  1.5s where the empty-cut defects live, nor the final frame).
- **Cut QC**: extend varietyCheck's contact sheet with cut-straddling pairs (last frame of
  scene N beside first frame of N+1) so the verdict judges the cuts themselves.
- **Vision prompt upgrade**: score against the 10-point student-vs-pro gradesheet
  (frozen elements, icon-on-card-centered, text placed not performed, uniform pop-ins,
  missing ground/depth, kicker contrast, icon↔label semantic match — "does each icon
  depict its adjacent label? name mismatches").
- **search_assets semantics**: tool description requires picking from top-3 candidates
  with an explicit match check; the wrong-icon class of defect (apple = "Butter") gets
  caught at authoring AND at QC.

### Phase 6 — Validation (live, before claiming done)
- Unit tests: exit/kinetic primitives in motion.css locks, hook/pacing pre-checks, xfade
  boundary builder, motion-audit + fill-audit pure functions, spot-frame positions.
- Sandbox: re-render a 3-scene sample through the full loop; eyeball frames incl. cut
  straddles; verify pixel-diff audit trips on a deliberately static scene.
- Live on arksai.studio: re-produce the SAME two briefs that failed the operator's bar —
  the 60s LDL explainer (clean) and the vox debt-vs-invest — compare side by side, send
  both mp4s. The bar: hook in 3s, no frozen stretch, dressed cuts, ≥45% frame fill,
  correct icons, varied pacing, punch-out ending.

## Sequencing & effort
Phases 2+3 (kit + transitions) are the visual payload; Phase 1+4 (script/pacing doctrine)
are prompt/doctrine + small tool params; Phase 5 is the enforcement that makes it stick
autonomously. Order: 1 → 2 → 3 → 4 → 5 → 6 in one arc; each phase is testable alone.
No new dependencies, no new APIs — everything runs on the existing capture/encode/QC
pipeline. Style-pack previews re-render at the end (kit look changes → picker cards must
not drift).
