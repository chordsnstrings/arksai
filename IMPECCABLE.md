# IMPECCABLE — taste discipline for ArksAI website creation

**Source & credit.** The rules here are distilled from the open **impeccable** design skill
(github.com/pbakaus/impeccable — "the design language that makes your AI harness better at
design") and its taste-skill lineage (emilkowalski/skill, leonxlnx/taste-skill, merged as
h3nryprod01/design-taste). ArksAI's builder is not Claude Code, so the skill can't run at
runtime — instead its *principles* are encoded into our own steering, the same way
`CLAUDE_DESIGN.md` and `MOTION.md` were. This file is the durable reference; the live rules
live in `server/src/agent/designSystem.ts` (`designCore` → "TASTE DISCIPLINE") and the design
gate rubric (`uiCheck.ts` → `DESIGN_RUBRIC_PROMPT`). We do NOT copy impeccable's own brand
identity (its kinpaku-gold / lacquer "neo-kinpaku" look); we take the transferable discipline.

## The one idea
"Clean and competent" now reads as the generic AI look. Premium comes from **discipline at the
pixel level** — every size, gap, weight, radius and colour is a deliberate choice on a system,
not an ad-hoc guess. ArksAI already art-directs (concept → type trio → palette → signature);
impeccable adds the *rigor* underneath.

## Discipline (encode, then enforce)
1. **Everything lands on a step.** Choose a type scale and a spacing scale up front; every
   `font-size` and gap lands on one of those steps. Ad-hoc 13/15/22px sizes and 7/11/13px gaps
   are the tell of an unconsidered page. Our kit tokens already define the steps — use them.
2. **Weight is deliberate, not one note.** A real weight range (a light/thin large display over
   heavier section anchors) reads as designed; body stays regular. A display face never carries
   body/UI text (thin cuts read too light small); small sizes switch to the text face.
3. **Tracked uppercase caps are short system markers only** — an eyebrow, a label. Never a
   sentence or paragraph in tracked caps.
4. **Dark type needs air** — body on a dark ground: line-height 1.6–1.8, 60–75ch measure.
5. **Structure restraint** — no cards nested in cards, no wide rounded pill-cards, no accent
   rail down a rounded card; one radius family; thin hairlines over heavy boxes.
6. **Never pure #000 / #fff grounds** — bias the near-black/near-white neutral slightly toward
   the palette's hue; a pure-grey neutral reads as unconsidered.
7. **Colour system** — prefer OKLCH for new colours (even lightness across hues); ONE accent
   used sparingly; warmth lives in the accent/surfaces, text tiers stay neutral.
8. **Motion is restrained** — no bounce; one easing token for all transitions; hover is a small
   lift / brightness / border shift, not a springy scale.
9. **Kit-first** — reach for the kit's primitives before inventing a bespoke
   `.hero-cta-primary` / `.section-action` class (already ArksAI doctrine).

## Anti-slop tells the gate now catches (in addition to the existing list)
glassmorphism · generic "AI-tool" glow/haze · neon-cyan fields · cards-in-cards · wide rounded
pill-cards · pure #000 / #fff grounds · a sentence in tracked UPPERCASE caps · a single heading
weight everywhere (no weight range) — on top of the pre-existing bans (purple→blue gradient
hero, cream+serif+terracotta, black+acid-green, broadsheet-hairlines pastiche, everything
centered, one rounded-lg radius on everything, emoji section markers, Inter-inherited-as-default).

## Where this lives (integration points)
- `designSystem.ts` `designCore` — the "TASTE DISCIPLINE" bullet (steers every visual build).
- `uiCheck.ts` `DESIGN_RUBRIC_PROMPT` — the design gate REVISES on the new anti-slop tells, so a
  build that ships glassmorphism / nested cards / pure-black ground / tracked-caps paragraphs
  gets bounced automatically (no user iteration).
- Future (Phase 2, optional): port impeccable's model-free *deterministic* detectors into the
  web-hygiene preflight so the cheapest slop (a `#000`/`#fff` body ground, an Inter-only stack,
  a purple→blue gradient) is caught before the vision gate even runs.
