# Website design revamp — closing the gap with Claude's output

> Planning doc. **No code is changed by this file.** It specifies what to build so ArksAI
> websites stop looking competent-but-generic and start looking *art-directed*, the way the
> Claude GIC build did. Grounded in a direct read of our actual design brain
> (`server/src/agent/designSystem.ts`) vs Claude's reference output
> (`gic-global/src/styles.css` + its build transcript).

---

## 1. The real diagnosis (it is NOT M3 — it's our process)

The operator is right: same model, same prompt, wildly different design. The difference is
entirely in **how we direct the work**. Reading the two side by side:

**What Claude did (its process, in order):**
1. **Researched the subject** — pulled the live business's real services, offices, affiliations.
2. **Invoked a "design skill" that NAMES and BANS three AI-default looks** — cream+serif+terracotta,
   black+acid-green, broadsheet-hairlines-everywhere — *before* choosing anything.
3. **Derived a bespoke CONCEPT from the subject's real world** — "Port of Entry" (travel documents),
   and let it drive everything.
4. **Encoded something TRUE in the structure** — destination markers are real country codes
   (CAN/UK/USA/UAE/GER/SWE/AUS/SCH), office cards carry real airport codes (DAC/CGP/DXB). Structure
   means something instead of `01 / 02 / 03`.
5. **Chose 3 typefaces with explicit ROLES, deliberately non-default** — Spectral (display gravitas,
   *not* Playfair/Fraunces), Hanken Grotesk (body, *not* Inter), IBM Plex Mono (data/codes/labels).
6. **Grounded the palette in the concept** — passport-cover evergreen + warm paper + a single
   vermilion "visa-stamp" accent, each with a written rationale.
7. **Built ONE meaningful signature element** — a typographic destinations board, revealed on a
   restrained stagger.
8. **Crafted the micro-details** — custom cubic-bezier easing token, eyebrow = mono + hairline rule,
   animated nav underline, button hover `translateY` + arrow `translateX`, `focus-visible` accent
   ring, skip-link, `clamp()` fluid spacing.

**What ArksAI's `designCore` currently does:**
- Mandates ONE universal house style: *"the house style is **MINIMAL · MODERN · MUTED** … ONE soft
  desaturated accent."* — **that aesthetic is itself one of the looks designers now read as "the AI
  default."** We are prescribing the very thing we need to beat.
- Treats design as **picking from a fixed menu**: 5 kits (minimal/paper/linen/calm/harbor) × 10
  themes × 8 font pairings. A menu guarantees *competent*; it cannot produce *made-for-this-client*.
  (And `paper`/`linen`/`clay` are literally cliché #1.)
- Has **no concept-derivation step.** Nothing tells the agent to ground the design in the subject's
  real world, or to encode anything true in the structure.
- **Doesn't enforce deliberate, non-default typography.** No "mono for data" role; the offered pairs
  lean on the ubiquitous faces; no anti-Inter/anti-Playfair steering.
- Defines "signature moment" as **generic web tropes** ("a gradient CTA, a bento, a hero visual") —
  decoration, not meaning. Claude's signature *encodes the subject*.
- The **critique rubric checks competence, not distinction** — a generic-but-clean site passes the
  gate today. Nothing makes "this looks like every other AI site" a failing grade.
- `create_web_app` (good for *function*) ships a **generic shell the model is told to "fill in"** —
  which biases toward keeping the generic look.

**Conclusion:** our craft mechanics (contrast, states, spacing, responsive, a11y) are genuinely
strong. What we are missing is the **art-direction layer that runs BEFORE craft** — concept,
deliberate type, concept-grounded palette, a meaningful signature, and a gate that rejects
generic. That layer is exactly what makes Claude's output "years ahead." We add it without losing
the construct+verify reliability we already shipped.

---

## 2. The method — five additions, layered over what exists

```
            ┌─────────────────────────────────────────────────────────────┐
  BEFORE →  │  ① ART DIRECTION (new):  concept → type roles → palette →    │
            │     signature → named anti-defaults.  Locked artifact.       │
            └─────────────────────────────────────────────────────────────┘
                                       │  feeds
            ┌─────────────────────────────────────────────────────────────┐
  BUILD  →  │  ② Theme-agnostic scaffold + ③ craft primitives + ④ a real   │
            │     type system with roles & a non-default font library.     │
            └─────────────────────────────────────────────────────────────┘
                                       │  judged by
            ┌─────────────────────────────────────────────────────────────┐
  VERIFY →  │  ⑤ DISTINCTIVENESS critique: a generic/AI-default look now    │
            │     REVISES, not passes.  (Function gate unchanged.)         │
            └─────────────────────────────────────────────────────────────┘
```

### ① The Art-Direction phase — a new tool `design_direction` (the headline "better design tool")

A first-class tool, invoked early on any visual website/landing/portfolio/content build, **before**
content authoring. It produces a small, durable, inspectable artifact (`design-direction.json` +
a human-readable `DESIGN.md`) that the build phase reads and the gate enforces.

The tool's schema forces the agent to commit to all of these (mirrors Claude's pre-build "lock"):

```jsonc
{
  "concept":   "Port of Entry",                         // a named idea grounded in the SUBJECT
  "rationale": "An immigration consultancy's real world is travel documents…",
  "structureEncodes": "destinations = real country codes; offices = real airport codes",
  "antiDefaults": ["cream+serif+terracotta", "black+acid-green", "broadsheet-hairlines"],
  "type": {
    "display": { "family": "Spectral",        "role": "headings / gravitas", "why": "not Playfair" },
    "body":    { "family": "Hanken Grotesk",   "role": "body",                "why": "warmer than Inter" },
    "data":    { "family": "IBM Plex Mono",    "role": "codes / labels / stat figures" }
  },
  "palette": {
    "ink": "#14201a", "brand": "#1b4d3e", "paper": "#f5f3ec",
    "accent": "#c8432b", "accentRationale": "visa-stamp vermilion, used <8%"
  },
  "signature": "a typographic destinations board keyed to real codes, staggered reveal",
  "motion": "one cubic-bezier easing token; nav underline; button lift + arrow nudge"
}
```

- **Why a tool, not just prompt text:** it makes the direction *committed and durable* (survives the
  long build), *inspectable* (we and the gate can read it), and *enforceable* (the critique compares
  the built site against this brief). It is the same idea as report mode's locked protocol, but
  **bespoke per project**.
- **It writes the tokens for you:** the tool emits a starter `tokens.css` from the chosen palette +
  type roles (with the rationale as comments, exactly like Claude's file header), so the build starts
  from the locked direction instead of re-deriving it.
- **Steering:** `prompts.ts` (code block) + `designCore` instruct: for any website, **call
  `design_direction` first**, present the concept to the user in one line, then build to it. For a
  quick/simple request it can run silently with a sensible bespoke concept; for a brand the user can
  approve/tweak the concept in one turn.

### ② Make `create_web_app` theme-AGNOSTIC (function stays, generic look goes)

`create_web_app` already guarantees the mechanics that matter (overflow-proof reset, working mobile
hamburger, `<meta viewport>`, fluid grids, build). Keep all of that. **Change one thing:** its
`site.css` currently also imposes a finished generic *look*. Split it:

- `site.css` → **mechanics only** (reset, nav behaviour, container, a11y, responsive safety). No
  opinionated colors/fonts/feel.
- `tokens.css` → **the look**, written by `design_direction` from the locked brief.

Result: the reliable skeleton no longer pulls the output toward "generic AI site"; the bespoke
direction sits cleanly on top. The model fills in **content**, the direction supplies **the look**.

### ③ Ship craft primitives — `craft.css` + signature snippets in the kit

The micro-details that make Claude's output read as "designed by a person" are mechanical and
repeatable. Bundle them so the model starts from high-craft primitives instead of re-deriving them
(usually worse): the **eyebrow** (mono + hairline rule), the **animated nav underline**, the
**button** (`translateY` lift + arrow `translateX` on hover), **`focus-visible`** accent ring,
**skip-link**, a single **`--ease` cubic-bezier** token, **`clamp()` fluid spacing/gutter** scale,
and a **staggered `[data-reveal]`** that's already in the kit. Plus 2–3 **signature section
templates** that are *meaningful* (a code/data "board", a labelled spec list, a stamped callout) —
contrast with today's generic "bento/gradient-CTA" suggestions.

### ④ A type system with ROLES + a non-default font library (`add_fonts` upgrade)

- **Add the missing role:** a **mono / data face** for codes, labels, eyebrows, and stat figures —
  the single biggest "expensive editorial" tell, and absent from `designCore` today.
- **Expand the self-hosted library** beyond Inter/Source Serif/Space Grotesk to a curated set of
  *distinctive* faces, each tagged `role` + `vibe`, so the direction can pick deliberately:
  - display: **Spectral, Fraunces, Bricolage Grotesque, Instrument Serif, Libre Caslon**
  - body: **Hanken Grotesk, Schibsted Grotesk, Geist, Mona Sans, Newsreader (text)**
  - data/mono: **IBM Plex Mono, Geist Mono, Space Mono, Martian Mono**
- **Anti-default rule** in `designCore`: name the over-used faces (Inter/Roboto as the *only* font,
  Playfair/Fraunces as the *reflexive* serif) and require the direction to choose with intent and a
  one-line "why this, not the default." (Fraunces is allowed — but *chosen*, never reflexive.)

### ⑤ Upgrade the critique to judge DISTINCTIVENESS (the gate that forces it up)

Today's `DESIGN_RUBRIC` / `parseDesignVerdict` (in `uiCheck.ts`, run by `runVerifyGate`) checks
*competence* — hierarchy, contrast, spacing, states. Add a **distinctiveness pass** that compares the
rendered site against the locked `design-direction.json` and asks:

1. Does it **avoid all three named AI-default looks**? (cream+serif+terracotta / black+acid /
   broadsheet hairlines — and our own "generic minimal-muted-blue".)
2. Is there a **concept carried through** structure + type + color, or is it decoration on a default?
3. Is there a **meaningful signature element** (encodes something true), not just a gradient box?
4. Are the **typefaces deliberate** (matches the brief's roles; not Inter-by-default)?
5. Does the **palette have personality + rationale**, not generic blue-on-white?

A site that is clean-but-generic now returns **`revise`** with a targeted instruction (e.g. "the
hero is a centered generic card — build the signature board from the locked concept; swap the
default sans for the brief's body face"). Bounded by the existing `MAX_DESIGN_ROUNDS` (2). This is
the change that actually moves the average output up, because "competent" stops being good enough.

---

## 3. Concrete change list (for the build phase that follows approval)

**New**
- `server/src/agent/tools/design-direction.ts` — `design_direction` tool: validates the brief,
  writes `design-direction.json` + `DESIGN.md` + a starter `tokens.css` into the workspace.
- `server/assets/web-app-template/tokens.css` — written/overwritten by the tool (palette + type
  roles, rationale comments).
- `server/assets/ui-kit/craft.css` — eyebrow, nav underline, button craft, focus ring, skip-link,
  `--ease`, fluid `clamp()` scale; + 2–3 *meaningful* signature section templates.
- `server/assets/report-fonts/` (extend) — the curated non-default faces above, self-hosted.
- Tests: `design-direction.test.ts` (schema/artifact), `distinctiveness.test.ts` (rubric verdict on
  a generic fixture → `revise`, on a concept-driven fixture → `pass`).

**Modified**
- `server/src/agent/designSystem.ts` — **reframe `designCore`**: demote "minimal·muted" from THE
  house style to one deliberate option; add the **named anti-default block**; add the **concept-first
  + signature-must-mean-something** mandate; add the **mono/data type role** + anti-default-font rule;
  point at `design_direction` as step 0 for websites.
- `server/src/agent/prompts.ts` — code block: "website → `design_direction` first, then
  `create_web_app` (mechanics), then build to the brief."
- `server/src/agent/tools/index.ts` — register `design_direction` (code mode).
- `server/src/agent/tools/web-app.ts` + `web-app-template/site.css` — split look out of `site.css`
  into `tokens.css` (scaffold becomes theme-agnostic).
- `server/src/agent/tools/fonts.ts` (`add_fonts`) — register the expanded role-tagged library.
- `server/src/agent/uiCheck.ts` — add the **distinctiveness** criteria to `DESIGN_RUBRIC`; have
  `parseDesignVerdict` read `design-direction.json` to judge concept-fidelity; `runVerifyGate`
  (runner.ts) passes the brief into the critique.

**Reused (do not rebuild)** — `create_web_app` mechanics + nav, `add_ui_kit`, `add_fonts`,
`detectRenderable`/`startPreviewServer`, `browserSmokeTest`/`judgeMobileNav`, the design verdict/
revise loop (`MAX_DESIGN_ROUNDS`/`MAX_VERIFY`, `config.designGate`), `validate_palette`/
`extract_palette`, the multi-viewport gate from the prior shipped work.

---

## 4. Why this beats "just write a better prompt"

A longer prompt alone won't hold across a 100k-token build — the model drifts back to defaults. The
leverage is **(a)** a *committed, durable, inspectable* art-direction artifact the build reads and
the gate enforces, **(b)** *theme-agnostic mechanics* so reliability doesn't drag in a generic look,
**(c)** *craft primitives* so high-craft details are free instead of re-derived, and **(d)** a
*critique that fails generic*. Prompt edits are the smallest part; the tools + gate are what make it
stick — which is exactly the "better design tools" the operator asked for.

---

## 5. Verification (when built)

- **Unit:** `design_direction` writes a valid brief + tokens; distinctiveness rubric returns
  `revise` on a generic fixture and `pass` on a concept-driven one; font library resolves all roles.
- **Integration (tsc-compiled build, local):** run the GIC brief through the new flow → assert a
  `design-direction.json` with a non-generic concept, 3 role-tagged non-default faces, an accent
  with rationale, and a signature section in the built HTML; assert the function gate (320/390/768/
  1280, nav opens, 0 overflow) still passes.
- **Live on arksai.studio** (~2 min auto-deploy): rebuild the GIC site through the agent and compare
  against Claude's reference — concept present, deliberate type, signature board, no AI-default look.
- Update `FEATURES.md` + `WhatsNewModal.tsx` in the same change.

---

## 6. Open calls for the operator (decide before build)

1. **Concept autonomy** — should `design_direction` always run silently with a bespoke concept, or
   surface the one-line concept for approval on branded/important builds? (Recommend: silent for
   quick asks, one-line approve for a named brand — matches the "one quick style choice" promise.)
2. **Font hosting** — self-host the expanded library (privacy/perf, our pattern) vs Google Fonts CDN
   (less weight to ship). (Recommend: self-host, consistent with the rest of the app.)
3. **Scope of the distinctiveness gate** — websites/landing/portfolio only, or all visual builds
   (apps too)? (Recommend: start with marketing-type sites where it matters most, then widen.)
