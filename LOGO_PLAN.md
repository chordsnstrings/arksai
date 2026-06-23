# Logo & Brand Identity — `generate_logo` (the spec)

A real, in-product logo generator that gets M3 as close to Opus-quality as M3 can reach,
then wraps the result in a **full designer submission** (directive + palette + light/dark +
placements + a zipped multi-format asset kit). Lives in **Marketing → creative**.

## Why it works (the core finding, validated live in R&D)
M3 (our `arksai-max`) has two reliable skills and one weak one:
- ✅ **Places a real font glyph** (`<text font-family=…>`) → the letterform is *perfect* (it's a
  designed typeface, not M3's hand).
- ✅ **Stacks basic primitives** (rect / circle / ellipse / line / polygon / simple arcs) →
  composes clean shapes.
- ❌ **Morphs a glyph into an object** (f→bubble, A→hull) → produces lollipops and arrowheads.

So the system **bans the morph** and plays only to the strengths. Validated: Facebook reached
Opus parity (solid bubble + triangle tail + real white "f" knocked out); ARKS/GIC produced
premium primitive-built concept marks (sailboat, armillary globe) with real-font wordmarks.

## THE ONE LAW
**Never morph a letter into an object or vice-versa.** A LETTER is always real `<text>` in a
named font; an OBJECT is always built from PRIMITIVE shapes. They sit beside/around each
other, never merge.

## Two routes (M3 auto-picks per brand; may combine)
- **Concept / pictorial** — when there's a drawable idea (boat, leaf, globe, bubble, shield):
  build the object from **overlapping primitives** + an optional real-font wordmark. The strong,
  distinctive route.
- **Lettermark** — abstract/name-led brands: a real-font initial/word as hero + ≤1 small
  primitive accent.

## Pipeline (`composeLogo`)
1. **Directive call** (M3 text): from the brand brief + the user's directions/palette/vibe →
   strict JSON `{concept, rationale, route, palette:[{name,hex,role}], typography:{display,body,labels}, tagline?}`.
2. **Best-of-N generate** (M3 ×N, default 3): the unified spec + the LOCKED directive (exact
   palette hexes, chosen route, chosen display font) → N SVG candidates.
3. **Render** candidates to a contact sheet (headless Chromium, fonts embedded).
4. **Vision-select** (M3 vision): pick the strongest candidate + name its defects.
5. **Structure-locked polish** (M3 text): fix the named defects WITHOUT changing the concept or
   shrinking key shapes. (A loose "make it better" prompt regresses M3 — proven; lock the
   structure.)
6. **Dark variant** (M3 text): recolor the exact SVG for a dark background (shapes/positions
   unchanged, fills only).
7. **Embed fonts** (`@font-face` base64) into the light + dark SVGs so they render anywhere.
8. **Build the kit + zip** (below).

## The deliverable — a designer submission (zipped)
- `brand-directive.md` — concept rationale, palette table (hex + role), typography, usage do/don't.
- `brand-sheet.html` — the visual presentation (mark on light + dark, palette swatches,
  type specimen, placements) — also copied to the workspace so it auto-opens in the canvas.
- `svg/` — `logo-light.svg`, `logo-dark.svg` (self-contained, fonts embedded).
- `png/` — light **and** dark backgrounds at 1024/512/256/128/64.
- `jpeg/` — 1024 light + dark (for places that need a flat raster).
- `app-icon-{light,dark}.png` (rounded-square) + `favicon-64.png`.
- `placement-website-{light,dark}.png` (navbar mockup).
- The zip lands as a download chip; a hero PNG auto-opens in the canvas.

## Intake (the agent asks first)
The play/persona steer the agent to gather, in ONE short round, before calling the tool:
brand name + what it does, 1–3 concept **directions** to explore, a **colour** preference
(or "you choose"), and the **vibe**. Then it calls `generate_logo` and hands over the kit.

## Libraries (expanded)
- **Fonts** (`server/assets/report-fonts/`): ~23 logo-grade families — geometric sans
  (Space Grotesk, Sora, Outfit, Manrope, Jakarta, DM Sans, Inter, Poppins, Montserrat),
  grotesques (Archivo, Epilogue, Libre Franklin), editorial serifs (Source Serif 4, Fraunces,
  Playfair Display, Spectral, Cormorant, Lora, Newsreader, Libre Baskerville), display
  (Syne, Unbounded, Bricolage Grotesque). Registry in `server/src/agent/fontkit.ts`.
- **Primitive vocabulary** (codified in the spec): rect (rx), circle, ellipse, line, polyline,
  polygon (triangle/trapezoid/diamond/chevron/star), simple `<path>` arcs (M/L/Q/C/A) for an
  object's curve only — never to spell a letter — and `<g transform>` to place/mirror.

## Files
- `server/src/agent/fontkit.ts` — font registry + `@font-face` base64 CSS + used-family detection.
- `server/src/agent/logo.ts` — engine: spec, pipeline, pure builders (exported for tests).
- `server/src/agent/tools/logo.ts` — the `generate_logo` ToolDef (chat + code).
- `server/src/engines/minimax.ts` — `generateText` (M3 Anthropic-endpoint text completion).
- `server/src/agent/tools/index.ts` — register in ALL_TOOLS (+ REPORT_TOOLS).
- `server/src/agent/expertise.ts` + `client/src/lib/departments.ts` — Marketing logo play + steering.
- `server/src/agent/prompts.ts` — chat image-route mentions logos.
- `server/test/logo.test.ts` — pure-fn tests.
- `FEATURES.md` + `client/src/components/WhatsNewModal.tsx`.

## Notes / limits
- Opus (true vector reasoning) still edges M3 on the most conceptual marks; this gets M3 to its
  own ceiling. An optional Anthropic-key path could later raise the floor further.
- M3 stalls under concurrency — the pipeline's M3 calls are sequential within a run.
- Needs the MiniMax `sk-cp` key (same gate as the other capability tools).
</content>
