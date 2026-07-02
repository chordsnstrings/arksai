import type { TaskProfile } from './taskProfile';

/**
 * Auto-Brief — closes the gap between a novice's one-liner and an expert's brief.
 *
 * The promise is "describe it once → get an expert-grade result", but a thin request and
 * a carefully-written brief produce wildly different output. Auto-Brief injects the brief
 * the user *would* have written, deterministically, into the system prompt — at zero
 * latency, with no per-request LLM guess (so no intent drift) and no fabricated specifics.
 *
 * Three layers compose into the injected block:
 *  - BRIEF_FIRST  — compile the request into an explicit brief: restate the goal, state
 *                   assumptions for anything unspecified, and ask AT MOST one question only
 *                   when an input is genuinely critical (Phases 2–3, invisible/auto-proceed).
 *  - a per-family OPERATING PROCEDURE — ROLE · SUCCESS CRITERIA · METHOD · VERIFICATION
 *                   RULES · OUTPUT CONTRACT · SELF-AUDIT (the domain rigor).
 *  - SELF_AUDIT_GATE — do not deliver output that fails its own audit (Phase 4).
 *
 * Visual builds are deliberately left untouched: they already get the design system + the
 * functional/design verify gates, so a scaffold there would just duplicate.
 */

export type BriefFamily =
  | 'research'
  | 'financial-model'
  | 'report'
  | 'analysis'
  | 'document'
  | 'generic';

// "Verify a set of things" asks — often free-form, so session.task is null and no
// expertise fires. These are exactly the prompts that come back padded/unsourced.
const RESEARCH_RE =
  /\b(research|investigate|due diligence|landscape|market scan|find (me|out|the|all)|look up|list of|shortlist|compile a list|which (vc|vcs|funds?|investors?|companies|firms|vendors|suppliers|tools|providers|grants?)|investors?|competitors?\b|market research|sources?\b|who (is|are) the)\b/;
const ANALYSIS_RE =
  /\b(analy[sz]e|analysis|interpret|breakdown|insights?|cohort|trend(s)?|correlat|segment|what does (the|this) data|make sense of)\b/;
const FINMODEL_RE =
  /\b(financial model|cash[\s-]?flow model|3[\s-]?statement|three[\s-]?statement|dcf\b|valuation model|forecast model|p&l model|budget model|unit econ(omics)?|scenario model)\b/;
// Formal/business writing — letters, policies, proposals, memos, JDs, SOPs, etc.
const DOCUMENT_RE =
  /\b(write|draft|compose|rewrite|prepare)\b[\s\S]{0,40}\b(letter|policy|policies|proposal|memo|email|message|job description|cover letter|complaint|contract|agreement|nda|essay|script|speech|statement|summary|sop|procedure|handbook|guide|terms|bio|press release|blog|article|post|plan|brief|note|response|reply)\b|\b(job description|cover letter|press release|standard operating procedure|terms (of service|and conditions))\b/;
// A "produce a deliverable" verb — gates the conservative non-visual generic fallback.
const DELIVERABLE_RE =
  /\b(write|draft|create|make|generate|produce|plan|compile|prepare|build|put together|come up with|summari[sz]e|outline|list|draw up|give me a)\b/;

/**
 * Pick the deliverable family for a request. Conservative: returns null (no scaffold,
 * today's behaviour) unless a family is clearly indicated. Detection uses the resolved
 * task key, the TaskProfile, and the raw text (free-form research/writing has no key).
 */
export function briefFamily(
  userText: string,
  profile: TaskProfile | undefined,
  task: string | null | undefined,
): BriefFamily | null {
  const t = (userText || '').toLowerCase().trim();
  if (!t) return null;

  // 1. Financial model — strongest signal (a finance task key, or explicit model words).
  if ((task && /^finance\./.test(task) && /(cashflow|model|forecast|valuation|budget|statement|scenario|unit|pricing)/.test(task)) || FINMODEL_RE.test(t)) {
    return 'financial-model';
  }
  // 2. Report mode → the designed-document family (carries its own verification rigor).
  if (profile?.type === 'report') return 'report';
  // 3. Research — verify-a-set-of-things asks.
  if (RESEARCH_RE.test(t)) return 'research';
  // 4. Non-visual analysis / interpretation (dashboards stay on the visual QC path).
  if (!profile?.isVisual && ANALYSIS_RE.test(t)) return 'analysis';
  // 5. Formal writing (non-visual).
  if (!profile?.isVisual && DOCUMENT_RE.test(t)) return 'document';
  // 6. Conservative non-visual fallback: a clear "produce a deliverable" ask that none of
  //    the above matched. Gated on a deliverable verb + length so casual chat is untouched.
  if (!profile?.isVisual && t.length >= 24 && DELIVERABLE_RE.test(t)) return 'generic';
  return null;
}

const HEADER = '## Operating procedure for this request — follow it precisely';

// Phases 2–3 (invisible, auto-proceed): compile the request into an expert brief first.
const BRIEF_FIRST = `BEFORE YOU ACT — compile the request into an expert brief (briefly, at the top): (1) restate the goal in one line; (2) state any ASSUMPTIONS you are making for details the user did not specify — assume sensibly and flag them, never invent specifics; (3) ONLY if a single input is genuinely critical and you cannot proceed sensibly without it, ask that ONE question and stop (the same one-round intake rule as everywhere else — the fewest questions that unblock you, in one message; on an unattended scheduled run, never ask) — otherwise proceed on your stated assumptions. Then do the work.`;

// Phase 4: make the self-audit a hard gate, not a suggestion.
const SELF_AUDIT_GATE = `BEFORE YOU DELIVER — run the self-audit above and fix anything that fails; do NOT hand over output that fails its own audit. Label every factual figure as verified (with a dated source) or unverified.`;

const NO_FABRICATION =
  'Never invent specifics (names, numbers, dates, sources, quotes). If a needed input is missing, state it as an explicit assumption up front, use a clearly-marked [placeholder], or ask ONE crisp question — do not fabricate or pad.';

const PROCEDURES: Record<BriefFamily, string> = {
  research: `ROLE: a meticulous research analyst. Accuracy beats breadth — a short list where every line is true is worth far more than a long list with guessed or scraped facts.
SUCCESS CRITERIA: define up front what makes an item QUALIFY, then admit only items that pass; put partial matches in a separate "Adjacent / stretch" section with the reason they fall short.
METHOD: (1) restate the target profile you're matching against; (2) gather candidates; (3) corroborate each against a primary or credible source; (4) resolve entities — merge duplicates/arms of one group, disambiguate different firms sharing a name; (5) rank by fit.
VERIFICATION RULES: cite a source AND its date for every item; prefer sources from the last ~18–24 months and flag anything older as possibly stale; distinguish VERIFIED from UNVERIFIED facts; report the RIGHT metric, not a look-alike (e.g. the typical INITIAL cheque a fund writes, NEVER the largest round it ever joined — and label which one you have); if you cannot verify an item, put it under "Could not verify" rather than padding the main list. Use web_search to corroborate when it is available.
OUTPUT CONTRACT: a scannable table/list — one row per item — with: name · one-line fit to THIS specific request (not generic) · the key qualifying attributes · source + date · confidence as the literal word High, Medium or Low (not a star or emoji rating). Then the "Adjacent / stretch" and "Could not verify" sections.
SELF-AUDIT (run before you answer, fix what fails): (a) every item passes the stated criteria; (b) every figure is the correct metric, not a look-alike; (c) no duplicates / merged entities; (d) every item has a dated source and a High/Medium/Low confidence; (e) nothing is padded to pad the count.`,

  'financial-model': `ROLE: an FP&A-grade modeller. The model must be genuinely computed, not a table of typed-in numbers.
SUCCESS CRITERIA: a reviewer can change ONE assumption and watch it flow through every dependent figure.
METHOD: a dedicated Assumptions/Drivers tab feeds linked statements; state units, currency and periods explicitly; structure it the way a finance lead would (clear sheets, period columns, a summary).
VERIFICATION RULES: every derived cell (totals, growth, net, ending balances, ratios) is a LIVE formula referencing the assumptions or other cells — NEVER a hard-coded literal; use cross-sheet references; ensure there are no #REF!/#DIV/0! errors and the statements tie (e.g. the cash flow reconciles to the balance sheet); make every assumption explicit and editable.
OUTPUT CONTRACT: clearly-labelled sheets, an Assumptions tab, period columns, and a one-screen summary.
SELF-AUDIT (run before you finish): (a) every derived figure is a formula, not a literal; (b) the model balances/ties; (c) assumptions are explicit and editable; (d) changing a driver visibly flows through; (e) no formula errors.`,

  report: `ROLE: a senior analyst and editor. The report must be insight-led and grounded in the data — not a wall of tables, and never decorative filler.
SUCCESS CRITERIA: a reader gets the bottom line first and can act on it; every claim traces to a figure or source.
METHOD: analyse FIRST (profile the data, run the relevant cross-tabs, reconcile any conflicting inputs) → lead with the thesis/bottom line → support with specific figures → close with ranked, specific recommendations.
VERIFICATION RULES: never fabricate figures; attribute/cite data; when inputs conflict, reconcile them and say how; include a short Methodology/Notes section (proxies used, gaps, limitations, sources). (The design protocol for this mode still applies — this layer governs the ANALYSIS, not the layout.)
OUTPUT CONTRACT: a cover, an executive summary (the thesis), sectioned analysis with charts/tables where they earn their place, ranked recommendations, and a methodology/sources section.
SELF-AUDIT (run before you finish): (a) every figure traces to a source or input; (b) the thesis is actually supported; (c) conflicts are reconciled; (d) recommendations are specific and tied to the data; (e) methodology + limitations are stated.`,

  analysis: `ROLE: a rigorous data analyst. Correctness and reconciliation come before presentation.
SUCCESS CRITERIA: the right findings, reconciled, with the "so what" made explicit.
METHOD: profile the data; compute the cuts that actually answer the question; reconcile conflicting fields; separate signal from noise.
VERIFICATION RULES: never invent numbers — every figure must be traceable to the input; state the sample size, the period, and any caveats; flag data-quality issues rather than smoothing over them.
OUTPUT CONTRACT: the headline finding first, then the supporting cuts, then the caveats/limitations.
SELF-AUDIT (run before you answer): (a) every number reconciles to the source data; (b) each claim is supported by a cut you actually computed; (c) caveats and limits are stated; (d) no fabricated or assumed figures.`,

  document: `ROLE: an expert business writer and editor for this exact document type.
SUCCESS CRITERIA: it reads as if a seasoned professional wrote it — correct register and structure, complete, and ready to use with minimal edits.
METHOD: use the conventional structure for THIS document type; include every section a professional version would have; be concrete and specific to the user's situation, not generic boilerplate.
VERIFICATION RULES: never fabricate facts, names, figures, citations or quotes — use a clearly-marked [placeholder] for any specific the user must supply; if the document makes factual claims, attribute them; match the required tone and (where relevant) jurisdiction/format.
OUTPUT CONTRACT: the finished, properly-formatted document, with bracketed placeholders for any unknown specifics.
SELF-AUDIT (run before you deliver): (a) every section a professional would include is present; (b) no fabricated specifics — placeholders instead; (c) tone/register/format are correct; (d) it is usable as-is.`,

  generic: `ROLE: an expert at exactly what is being asked.
SUCCESS CRITERIA: the output precisely matches the request and is complete and usable — a finished thing, not a sketch or an outline of one.
METHOD: do the full job a competent professional would do for this request; be specific and concrete; cover what a thorough version needs.
VERIFICATION RULES: never fabricate facts, figures, sources or quotes; use stated assumptions or clearly-marked [placeholders] for unknowns.
OUTPUT CONTRACT: deliver the finished result in the format most useful for this request.
SELF-AUDIT (run before you deliver): (a) it fully answers the ask; (b) nothing is fabricated; (c) it is usable as-is, not a stub.`,
};

/**
 * The operating-procedure block for a request, or null when no family applies (behaviour
 * unchanged). Pure + synchronous. Composes: brief-first compilation → the family's domain
 * procedure → the self-audit gate → the no-fabrication rule.
 */
export function briefScaffold(
  userText: string,
  profile: TaskProfile | undefined,
  task: string | null | undefined,
): string | null {
  const family = briefFamily(userText, profile, task);
  if (!family) return null;
  return `${HEADER}\n${BRIEF_FIRST}\n${PROCEDURES[family]}\n${SELF_AUDIT_GATE}\n${NO_FABRICATION}`;
}
