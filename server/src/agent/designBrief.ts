import { generateTextM3 } from '../engines/minimax';
import { config } from '../config';
import { paletteMenu } from './palettes';
import type { TaskProfile } from './taskProfile';

/**
 * Design-brief compiler — the per-request "think first" layer that ArksAI was missing for
 * VISUAL builds.
 *
 * Auto-Brief (brief.ts) deliberately skips visual work, so an artifact/app build used to get
 * the big STATIC designCore + the user's RAW casual prompt and nothing in between. A casual
 * one-liner ("make me a weather thing") and an expert art-directed spec produce wildly different
 * output from the same model — which is exactly why hand-feeding a precise brief made M3 match
 * Claude. This module automates that brief: an upfront, bounded M3 pass rewrites the casual
 * request into a tight, specific BUILD BRIEF (concept · palette · type · layout · signature ·
 * data · details · avoid), which the build turn then follows. It mirrors the planning Claude
 * does internally before it builds.
 *
 * Fail-OPEN: if the key is missing, the model errors, or it times out, we return null and the
 * build proceeds exactly as before — the compiler can only ever ADD specificity, never block.
 */

const COMPILER_SYSTEM =
  'You are a senior design director and prompt engineer. You convert a casual user request into a ' +
  'tight, concrete BUILD BRIEF that a builder model will follow to produce a result on par with the ' +
  'best AI design tools — DISTINCTIVE, art-directed for its subject, and genuinely polished. ' +
  'The result is graded by a design review that FAILS "competent-but-generic": restraint must be a ' +
  'deliberate choice, never the default. Commit the brief to one recognizable modern direction that ' +
  'fits THIS subject, then SPECIFY it with real choices — never restate generic principles. ' +
  'Output ONLY the brief (no preamble, no sign-off).';

function compilerPrompt(userText: string, profile: TaskProfile): string {
  return `USER REQUEST: "${userText.slice(0, 800)}"

This is a VISUAL build (type: ${profile.type}). Write a BUILD BRIEF specific to THIS request — name real, decisive choices. Keep it under ~200 words, as terse labeled lines. Skip a line only if it truly doesn't apply.

- CONCEPT: one line — the art-direction idea grounded in the subject, so it feels bespoke not template.
- DIRECTION: name the ONE modern archetype the page commits to, chosen for THIS subject (product dashboard with a focal metric, bento grid, command-bar app, split-screen, editorial magazine, glass stack, data-poster…). The structure must BE that archetype — that commitment is what design review rewards.
- PALETTE: pick ONE palette by NAME from the menu below that fits the subject's mood; note the accent is used sparingly (~5-10%) on one focal thing.
- TYPE: which role each face plays — a display face for headings/hero, a clean sans for body, and where the MONO/data face carries figures (numbers, labels, codes, time).
- LAYOUT: the concrete structure — the sections in order, the grid, what floats. Only a genuinely single-widget build floats one centered card; anything richer must fill its archetype's structure, capped width, never edge-to-edge.
- SIGNATURE: the ONE memorable, art-directed moment keyed to real content (a hero number, a ring/gauge, a focal data viz) — everything else stays quiet around it.
- DATA: concrete, real-looking sample content to populate it (specific names/numbers/labels) — never lorem or "placeholder".
- DETAILS: hairline dividers over heavy borders, soft tinted elevation, tabular-nums on any changing number, real hover/focus/empty/loading states.
- AVOID (these are the named FAIL patterns in design review): the generic minimal-muted AI look (grey/blue desaturated accent on white + a big centered hero + a glowing card + Inter everywhere); cream + serif + terracotta pastiche; black + acid-neon-green; emoji as icons (use inline line-SVG, stroke=currentColor, one consistent stroke/size); dead flat grey; low-contrast washed-out text; content bleeding to the screen edges.

PALETTE MENU (choose one name):
${paletteMenu()}`;
}

/**
 * Compile the user's casual request into an expert build brief. Returns the brief text, or null
 * (key off / disabled / error / timeout) so the caller proceeds without it.
 */
export async function compileDesignBrief(
  userText: string,
  profile: TaskProfile,
  signal: AbortSignal,
): Promise<string | null> {
  if (!config.designBrief || !config.minimaxApiKey) return null;
  if (!userText.trim()) return null;
  try {
    const r = await generateTextM3(compilerPrompt(userText, profile), signal, {
      maxTokens: 900,
      system: COMPILER_SYSTEM,
    });
    if (!r.ok || !r.text) return null;
    const brief = r.text.trim();
    // Guard against a degenerate/echoed response — a real brief carries the labeled sections.
    if (brief.length < 80 || !/CONCEPT|PALETTE|LAYOUT/i.test(brief)) return null;
    return brief;
  } catch {
    return null;
  }
}

/** Wrap a compiled brief as the system-prompt block the build turn follows. */
export function designBriefBlock(brief: string): string {
  return (
    `\n## Build brief (compiled for THIS request — FOLLOW IT)\n` +
    `An expert has translated the user's request into the brief below. It encodes the specific design ` +
    `decisions a great result needs. Build to it faithfully — honour the palette, type roles, layout, ` +
    `the single signature moment, and the AVOID list. Do not regress to a generic template.\n\n` +
    `${brief}\n`
  );
}
