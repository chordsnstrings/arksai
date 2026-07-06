# SCRIPT CRAFT — storytelling & narration quality for the motion engine

Research distillation (2026-07-06) behind the script-quality gate in
`server/src/agent/motion/qc.ts` (`scriptProblems`) and the SCRIPT DOCTRINE section of
`server/assets/motion-kit/MOTION.md`. Operator brief: "improve our storytelling
techniques… ensure the actual script that gets generated is high quality as well."

Sources synthesized: the South Park "But/Therefore" writers-room rule (Parker & Stone,
NYU talk); Pixar's 22 rules of storytelling (Emma Coats) and the story-spine exercise;
YouTube retention research (audience-retention curves — the first 60s cliff, re-hook
cadence); MrBeast's leaked production doc (hook density, "the first minute IS the video");
Kurzgesagt & Vox script post-mortems (translate-the-number, one-hero-stat discipline);
broadcast/radio writing guides (BBC News style for the ear, NPR's "write the way you
talk"); TTS-specific copywriting guidance (contractions, abbreviation expansion,
end-focus); and the well-documented lexical fingerprint of LLM-generated prose
(delve/tapestry/testament studies on arXiv abstracts post-2023).

## 1. Structure: the story spine

**The But/Therefore test (the single highest-leverage rule).** Beats joined by "and then"
are a list; beats joined by "but" (tension) or "therefore/so" (consequence) are a story.
Test: if two adjacent scenes can be swapped without breaking anything, the link is
missing. The gate HARD-FAILS a ≥3-beat script containing zero contrastive/causal
connectives (but, yet, so, because, instead, except, turns out, which means, that's why,
here's the thing).

**Open loops hold attention; anticipation beats information.** Dopamine fires on the
predictive cue, not the reward. The hook opens a loop the FINAL scene closes; each
mid-script loop resolves only after the next opens. Resolving everything early is the
retention cliff. Re-hook cadence: a fresh tension renewal every ~30–40s ("but that's not
the strange part"), every 2–3 min for long pieces — scheduled in the outline BEFORE
writing scenes.

**Beat templates by target length** (shorts speak punchy lines slower — budget 2.0 w/s
for ≤30s targets, 2.4 w/s beyond):

| Target | Words | Spine |
| --- | --- | --- |
| 15s | ~30 | HOOK (≤10w) → TENSION/reveal → PUNCH-OUT (≤6w) |
| 30s | ~65 | HOOK → SETUP → TWIST ("but…") → RESOLUTION → PUNCH-OUT |
| 60s | ~140 | HOOK → STAKES → 2–3 escalating "turns out…" reveals → PEAK → callback PUNCH-OUT |
| 3min+ | ~430+ | Chapters, each with a mini-hook + mini-payoff; re-hooks every 30–40s |

**Peak-end rule (Kahneman).** Viewers remember the peak and the ending. Engineer ONE
deliberate peak (the biggest number/reveal) and land the ending — the final scene is the
SHORTEST, a punch-out that calls back to the hook. Never end on a list item, disclaimers,
or an engagement CTA (hard-fail).

## 2. Language: spoken prose ≠ essay prose

- **Concrete nouns beat abstractions.** "Your coffee", not "caffeinated beverages". Every
  sentence should contain an image; if it doesn't, rewrite it. (Pixar: "you admire a
  character for trying more than for their successes" — people doing things, not concepts
  being the case.)
- **"You" carries the stakes.** Facts without an owner are trivia. Anchor consequences in
  the viewer ("your money", "your sleep") or one named character carried through the whole
  video. Advisory when a multi-beat script never says "you".
- **Translate every number** (the "naked hero stat" rule — Vox/Kurzgesagt discipline).
  A number lands only next to a comparison the ear can hold: "42% — nearly half of
  everything you drink". ONE hero number per scene spoken; the rest go on screen.
- **Rhythm is deliberate.** Vary sentence length: two short, one long, one very short.
  Three consecutive same-length sentences read as recitation (advisory). One idea per
  sentence; hard max ~20 spoken words (advisory at >24).
- **The tells to kill** (each regex-enforced):
  - Essay scaffolding — firstly/moreover/furthermore/in conclusion/to sum up/"in today's
    fast-paced world"/"without further ado"/"let's dive in"/delve/"needless to say"/"so
    there you have it"/"hope you enjoyed" → HARD FAIL.
  - Engagement CTAs — like-and-subscribe/smash-that/link-in-bio/comment-below → HARD FAIL.
  - Hype promises — "you won't believe"/mind-blowing/shocking/insane/game-changer → HARD
    FAIL (if the fact is good, the fact carries it).
  - AI lexicon — tapestry/realm/unlock/unleash/harness/elevate/embark/journey-of/navigate-
    the/robust/seamless/pivotal/foster/garner/underscore/testament-to/revolutionize/deep-
    dive/"the world of"/boasts → advisory (replace with plain concrete words).
  - Empty intensifiers — truly/incredibly/extremely/absolutely/utterly/remarkably/
    undeniably/very/really → advisory at ≥2 (delete, or upgrade the base word).
  - Hedges — perhaps/possibly/potentially/somewhat/relatively/"seems to"/"tends to" →
    advisory at ≥2 (an explainer asserts or omits; at most ONE deliberate hedge on a
    genuinely contested claim).

## 3. Write for the ear (TTS delivery)

- **Contractions always** (it's, don't, that's) — spoken register. Exception: avoid
  "-'ve" after nouns ("the results've") which TTS mangles; spell "have" there.
- **No abbreviations/symbols/parentheses**: "about 40 percent", never "(~40%)". Expand
  acronyms on first use unless universally spoken as a word.
- **End-focus**: the ear weights sentence endings — put the payoff word LAST. "The real
  cause is *sugar*", not "Sugar is the real cause of this."
- **Landing-strip last line**: final sentence ≤8 words, concrete, hook-callback.
- **Breath test**: anywhere you'd stumble reading aloud, split the sentence.
- **Redundancy hurts** (Mayer's modality principle): on-screen text never duplicates the
  narration verbatim — keyword labels (5–12 words), placed next to what they name.

## 4. Enforcement map (what's code vs. what's doctrine)

| Rule | Where | Severity |
| --- | --- | --- |
| Throat-clearing opener / >30-word hook | `hookProblems` (qc.ts) | HARD, pre-TTS |
| Narration overshoots target_seconds >25% | word budget (qc.ts) | HARD, pre-TTS |
| Essay scaffolding / CTA ending / hype | `scriptProblems.hard` | HARD, pre-TTS |
| Zero connectives in ≥3 beats (But/Therefore) | `scriptProblems.hard` | HARD, pre-TTS |
| ≥2 intensifiers / ≥2 hedges / AI lexicon | `scriptProblems.advisory` | advisory, returned as SCRIPT NOTES |
| Sentence monotony / >24-word sentence / no "you" | `scriptProblems.advisory` | advisory |
| Beat templates, open loops, number translation, end-focus | MOTION.md SCRIPT DOCTRINE | doctrine (prompt-enforced) |

Advisories ship (the render completes) but come back in the tool result as
"SCRIPT NOTES" so the agent fixes the narration on the next pass — same philosophy as the
QC gradesheet: the agent iterates internally so the user never does.
