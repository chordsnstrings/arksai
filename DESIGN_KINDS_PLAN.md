# Design studio — full artifact-kind parity with Claude Design (plan, 2026-07-06)

Operator: "claude design can create wireframes, documents etc. arksai design doesn't.
Plan proper granular implementation."

## Gap analysis (Claude Design's template set vs our studio)

| Claude Design template | ArksAI today | Verdict |
| --- | --- | --- |
| Document | ✅ Document chip (chat `generate_doc`) + One-pager (report) | have it |
| Slides | ✅ Pitch deck chip (report 16:9) | have it |
| Prototype | ⚠️ We build REAL verified apps (stronger but slower/heavier); no fast clickable-mock kind | **build** |
| Wireframe | ❌ Nothing — no lo-fi language, no multi-screen boards, no annotations | **build (the headline)** |
| Animation | ⚠️ World-class motion engine exists, but not reachable from the design studio | **wire** |

Claude Design's wireframe surface (per the operator's screenshot) is really a THINKING
artifact: several lo-fi screens on one board, hand-drawn strokes and hatch fills, red
handwritten annotations explaining decisions, and concept-variant exploration ("2a…2g,
pick favorites"). That's a different register from our polished output — it needs its own
kit and its own review rubric (a wireframe judged by the editorial design gate would fail
on purpose).

Explicitly DEFERRED from this arc (noted in CLAUDE_DESIGN.md §2 already): annotate-on-
artifact + tweak knobs, Present mode, per-org design-system dropdown.

---

## Phase 1 — Wireframe engine (new capability)

**The lo-fi kit** — `server/assets/ui-kit/wireframe.css` + a vendored handwritten face
(Caveat, OFL → `server/assets/report-fonts/`; annotation voice) alongside the plain sans:
- Tokens: paper ground, graphite ink, ONE annotation accent (red), sketch stroke
  (1.5px, slightly rounded, `stroke-dasharray` for dashed), hatch pattern (repeating
  linear-gradient), no shadows/gradients/photos — lo-fi BY CONSTRUCTION.
- Screens: `.wf-board` (the canvas: responsive grid of screens, scrolls, never overflows)
  · `.wf-screen` with device chrome variants `.phone/.tablet/.desktop` (frame + status bar
  hint) · `.wf-title`/`.wf-tag` (screen name + step number).
- Blocks: `.wf-box` (dashed content region) · `.wf-img` (hatch-fill placeholder with an ✕)
  · `.wf-text` (grey bar lines, 1–n) · `.wf-btn`/`.wf-btn.primary` · `.wf-input` ·
  `.wf-nav`/`.wf-tabbar` · `.wf-list`/`.wf-card` · `.wf-avatar` · `.wf-chart` (sketch bars).
- Story layer: `.wf-note` (red handwritten annotation + a leader line/arrow, absolutely
  positioned but clamp-safe) · `.wf-flow` (an SVG arrow between screens with a label like
  "on submit") · `.wf-variant` (a labelled variant column for concept boards).

**Engine wiring:**
- `taskProfile.ts`: new TaskType `wireframe` (classifier: wireframe/lo-fi/mockup/screen
  flow/user flow → wireframe; isVisual true).
- `designSystem.ts`: a `wireframe` typePack that REPLACES the editorial bar: lo-fi
  discipline (greyscale + one annotation red; hatch fills, never photos/brand colours;
  label every screen; annotate every non-obvious decision; flows as arrows; 3–8 screens
  per board; concept-ask → 2–4 NAMED variants side by side, each with a one-line thesis).
- `uiCheck.ts`: `WIREFRAME_RUBRIC` swapped in when the profile is wireframe — judges
  flow completeness (every CTA leads somewhere), annotation quality, label clarity,
  overflow, and **hi-fi creep as a defect** (real colours/photos/polish = REVISE).
  Geometry-style checks still apply (no clipped text).
- Deliverable: ONE self-contained HTML board (canvas-previewable) + a PNG export
  (Chromium screenshot at 2×, saved next to it) so it can be shared/attached anywhere.

**Studio:** `Wireframe` chip, hint "Wireframe the flow for…", mode `code`.

Tests: kit-class integrity, classifier lock ("wireframe the checkout flow" → wireframe),
rubric-swap lock, prompt lock, a real Chromium render of a 3-screen fixture board
(overflow + note-clamping assertions).

## Phase 2 — Prototype kind (fast clickable mock)

Definition: a HI-FI, clickable, multi-screen prototype — real design language (direction
engine applies), fake-but-real data, NO backend, NO publish requirement. Minutes, not a
full verified build.

- `proto.css` additions to the ui-kit: `.proto-frame` (optional phone/desktop device
  shell) · `.proto-switcher` (a floating screen-list pill: number keys/arrows/click to
  jump) · `.proto-hotspot` (subtle affordance pulse on prototype links so reviewers can
  find the clickable areas).
- Pattern: multiple `screen-*.html` pages linked by ordinary anchors (reuses the web
  kit + design directions untouched) + the switcher injected by a tiny `proto.js`.
- `taskProfile` type `prototype` (classifier: prototype/clickable mock/click-through/
  hi-fi mock). typePack: screens-first (list the screens, then build), every primary
  action navigates somewhere, seed real-looking data, states shown as separate screens
  where relevant (empty/success), skip backend entirely.
- Gate: crash gate + the standard design rubric (hi-fi = full bar) — but no publish step.
- Studio: `Prototype` chip, hint "A clickable prototype of…", mode `code`.

Tests: classifier lock, typePack prompt lock, switcher/proto.js unit (screen discovery),
fixture prototype renders + navigates in Chromium.

## Phase 3 — Animation kind (wiring only)

- Studio `Animation` chip → mode `code`, brief routes to the MOTION engine
  (render_motion_video): explainer-style brief scaffolding (subject → title param,
  16:9 default, style pack from the Style menu: auto→clean; brand→clean + org accent;
  a picked design direction maps to the nearest motion pack by mood table in the brief).
- The finished video lands as the session's video card; canvas shows it.
- Tests: brief-builder unit lock (title passed, style mapping table).

## Phase 4 — Template-card picker (the "Start with a template…" surface)

- Replace the text chips with visual TEMPLATE CARDS: Website · Landing page · Prototype ·
  Wireframe · Pitch deck · One-pager · Document · Social creative · Animation.
  Each card = a small inline-SVG thumbnail drawn in the wireframe language (no image
  assets; sketch style previews the kind) + label + one-line hint on hover/selected.
- Responsive: grid on desktop, 2-col at 390px; keyboard navigable; selected state in the
  house accent. The picked card still just sets `type` + placeholder (interaction
  unchanged).
- Playwright QA 1280 + 390, light + dark.

## Phase 5 — Ship + live validation

- Full gate (typecheck · tests · build), docs (FEATURES, WhatsNew bump, CLAUDE.md handoff).
- Live on arksai.studio: (1) an autonomous WIREFRAME session ("wireframe a 4-screen
  onboarding flow for a fitness app, two concept variants") — eyeball the board, deliver
  the PNG; (2) an autonomous PROTOTYPE session ("clickable prototype of a coffee
  subscription checkout, 4 screens") — click through it live; (3) an Animation-chip
  session producing a short motion piece end-to-end.

## Order & effort

| Phase | Size | Risk |
| --- | --- | --- |
| 1 Wireframe | L (kit + profile + rubric + tests) | rubric calibration (lo-fi vs sloppy) |
| 2 Prototype | M (kit deltas + profile + steering) | low — reuses web kit + directions |
| 3 Animation wiring | S | low |
| 4 Picker cards | S–M (pure client) | low |
| 5 Ship + live | M (three live runs) | render/QC time |
