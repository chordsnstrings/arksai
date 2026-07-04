# Claude Design — what we learned, and where it lives in ArksAI

Research artifact (2026-07-04) distilling three sources for reuse in future design arcs:
Claude's own internal design doctrine (primary source), Anthropic's **Claude Design**
product, and the Anthropic brand identity. Ends with the gap table and where each gap was
fixed in our engine.

## 1. The doctrine (how Claude itself designs)

**Calibrate the treatment, not whether to design.** This is the LEAD principle, and the one
we were missing. Every artifact deserves craft — real hierarchy, considered spacing, a
chosen palette — but the *treatment* is read from the request: a plan, memo, demo or
internal tool gets a **utilitarian** treatment (no flashy hero, flourishes tasteful and
limited); a landing page, game, or anything the user keeps/shares gets the **editorial**
treatment (opinionated calls, one real aesthetic risk). The tie-breaker: *"a well-composed
page is never the wrong answer; an over-designed visual identity sometimes is."*
Over-designing a memo is a failure symmetrical to under-designing a landing page.

**Ground identity in the subject.** Distinctive choices come from the subject's own world —
its materials, instruments, vernacular. Real content throughout, never lorem.

**The anti-AI-default look list** (avoid when the user hasn't pinned a direction; follow the
user exactly when they HAVE): warm cream `#F4F1EA` + serif display + terracotta accent;
near-black + a lone acid-green/vermilion pop; broadsheet hairlines with dense columns; a
purple→blue gradient hero on white; Inter/Space Grotesk as the "safe face"; emoji as
section markers; everything centered; `rounded-lg` everywhere; an accent bar/rail on
rounded cards.

**Neutrals are chosen, not defaulted.** A pure mid-grey reads unconsidered; a grey with a
slight hue bias toward the page's accent reads chosen.

**Token-level dual theme.** Define the palette as custom properties on `:root`; redefine
only the tokens under `@media (prefers-color-scheme: dark)`; then redefine again under
`[data-theme="dark"]` and `[data-theme="light"]` so a user toggle beats the OS preference
in both directions. Style components exclusively through tokens. A deliberately
single-world design (neon arcade, letterpress) may stay single-theme — as a choice.

**Layout does the spacing.** Sibling groups via flex/grid `gap`, never per-element margins
(they collapse/double silently). Wide content gets its own `overflow-x:auto` container.
`tabular-nums` wherever digits align.

**Words are design material.** Name things from the user's side of the screen
(notifications, not webhook config); active voice; a control says exactly what happens
("Publish" → toast "Published"); errors say what went wrong and how to fix it — no
apologies, no vagueness; empty states direct the next action; specific beats clever.

**Structure encodes information.** Numbering, eyebrows, dividers and labels must encode
something true — numbered markers (01/02/03) only when the content is genuinely a sequence
whose order carries information.

**UI is operated, not read.** For dashboards/tools the craft shifts to information design:
summary before detail; state encoded in form (pill/chip/severity stripe), not just number;
semantic color (good/warn/critical) is separate from the accent and doesn't count as it.

**Editorial principles.** The hero is a thesis (open with the most characteristic thing in
the subject's world); typography carries the personality; motion is orchestrated, not
scattered; **spend boldness in ONE place** and keep everything around it quiet; if the
accent fights the ground, shift analogous or desaturate — never swap it.

**Process.** Sketch a compact design plan first (4–6 named hex values, 2+ type roles, a
layout concept in a sentence or two), review it against the subject for genericness, then
build to the revised plan exactly.

## 2. The product (Claude Design, Anthropic Labs, Apr 2026)

Design-system-first: it learns a design system from your codebase/files FIRST, then applies
it everywhere; refinement is conversational, with inline comments on the artifact and live
adjustment knobs; exports to Canva/PDF/PPTX/HTML. This validates ArksAI's architecture
(design_direction locks a system → tokens.css → everything builds through it). The
inline-comment/knob iteration ergonomics are a noted FUTURE idea for our Design studio —
not built in this arc; our refinement is conversational (keep talking in the session).

## 3. The brand (Anthropic identity — reference only, not to copy)

Styrene (sans) + Tiempos (serif); warm paper `#faf9f5` / `#e8e6dc`, ink `#141413`, mid
`#b0aea5`; accents: clay `#d97757`, blue `#6a9bcc`, green `#788c5d`. The irony worth
remembering: Claude's own doctrine names "warm cream + serif + terracotta" — its
brand-adjacent look — as an AI default to avoid, because ubiquity made it a cliché. ArksAI's
product shell (warm ivory + Source Serif) is fine for OUR brand; generated OUTPUT must never
default to it — our engine already fails that look in review. Our Design studio surface
(`/design`) deliberately wears the Claude look because the operator asked for "exactly like
Claude" — a chosen homage on our chrome, still banned in output.

## 4. Gap table (ArksAI engine, audited 2026-07-04)

| Doctrine point | Had it? | Where it lives / was fixed |
| --- | --- | --- |
| Treatment calibration | **GAP** | designBrief.ts `TREATMENT:` line; designCore header; uiCheck rubric judges per-treatment |
| Anti-default looks | partial (4 named) | completed to the full list in designBrief AVOID, designCore, rubric, design-direction defaults |
| Hue-biased neutrals | yes | designCore COLOUR (neutrals share one undertone) |
| Token-level dual theme | **GAP** | prompts.ts COLOUR & DARK MODE option (c) |
| Copy as design material | **GAP** | designCore "WORDS ARE DESIGN MATERIAL"; CRAFT "COPY IS CRAFT"; rubric COPY bullet |
| Structure encodes info | yes | designCore ("never generic 01/02/03" + order-carries-information) |
| One signature / boldness in one place | yes | designCore SIGNATURE + accent-conflict line added |
| Semantic color ≠ accent | **GAP** | dashboard typePack |
| gap-not-margins, overflow-x containers, text-wrap:balance, 65ch, tracked labels | **GAP** | designCore SPACE & TYPOGRAPHY micro-craft |
| Distinctiveness-first review | yes | uiCheck DESIGN_RUBRIC_PROMPT (now editorial-scoped) |
