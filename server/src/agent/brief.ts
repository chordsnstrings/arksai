import type { TaskProfile } from './taskProfile';

/**
 * Auto-Brief — Phase 1: deterministic "operating-procedure" scaffolds.
 *
 * The product promise is "describe it once → get an expert-grade result", but a thin
 * request and an expert brief produce wildly different output. The biggest, cheapest
 * lever is a REUSABLE per-deliverable operating procedure — ROLE · SUCCESS CRITERIA ·
 * METHOD · VERIFICATION · OUTPUT CONTRACT · SELF-AUDIT — that the model follows as if an
 * expert had written the prompt. It is injected into the system prompt at ZERO latency
 * and ZERO intent-drift risk (no LLM call, no per-request guessing).
 *
 * It deliberately adds RIGOR and STRUCTURE but NEVER invents specifics — missing inputs
 * are stated as assumptions or asked once, never fabricated. The later phases (a gated
 * fast rewrite that slots the user's specifics in, and an accuracy self-audit gate) build
 * on top of this; Phase 1 is the free backbone.
 */

export type BriefFamily = 'research' | 'financial-model' | 'report' | 'analysis';

// "Verify a set of things" asks — often free-form, so session.task is null and no
// expertise fires. These are exactly the prompts that come back padded/unsourced.
const RESEARCH_RE =
  /\b(research|investigate|due diligence|landscape|market scan|find (me|out|the|all)|look up|list of|shortlist|compile a list|which (vc|vcs|funds?|investors?|companies|firms|vendors|suppliers|tools|providers|grants?)|investors?|competitors?\b|market research|sources?\b|who (is|are) the)\b/;
const ANALYSIS_RE =
  /\b(analy[sz]e|analysis|interpret|breakdown|insights?|cohort|trend(s)?|correlat|segment|what does (the|this) data|make sense of)\b/;
const FINMODEL_RE =
  /\b(financial model|cash[\s-]?flow model|3[\s-]?statement|three[\s-]?statement|dcf\b|valuation model|forecast model|p&l model|budget model|unit econ(omics)?|scenario model)\b/;

/**
 * Pick the deliverable family for a request. Conservative: returns null (no scaffold,
 * today's behaviour) unless a Phase-1 family is clearly indicated. Detection uses the
 * resolved task key, the TaskProfile, and the raw text (for free-form research, which
 * has no task key).
 */
export function briefFamily(
  userText: string,
  profile: TaskProfile | undefined,
  task: string | null | undefined,
): BriefFamily | null {
  const t = (userText || '').toLowerCase();

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
  return null;
}

const HEADER = '## Operating procedure for this request — follow it precisely';
const NO_FABRICATION =
  'Never invent specifics (names, numbers, dates, sources, quotes). If a needed input is missing, state it as an explicit assumption up front, or ask ONE crisp question — do not fabricate or pad.';

const SCAFFOLDS: Record<BriefFamily, string> = {
  research: `ROLE: a meticulous research analyst. Accuracy beats breadth — a short list where every line is true is worth far more than a long list with guessed or scraped facts.
SUCCESS CRITERIA: define up front what makes an item QUALIFY, then admit only items that pass; put partial matches in a separate "Adjacent / stretch" section with the reason they fall short.
METHOD: (1) restate the target profile you're matching against; (2) gather candidates; (3) corroborate each against a primary or credible source; (4) resolve entities — merge duplicates/arms of one group, disambiguate different firms sharing a name; (5) rank by fit.
VERIFICATION RULES: cite a source AND its date for every item; prefer sources from the last ~18–24 months and flag anything older as possibly stale; distinguish VERIFIED from UNVERIFIED facts; report the RIGHT metric, not a look-alike (e.g. a typical/initial figure, not the largest one-off you found — label which it is); if you cannot verify an item, put it under "Could not verify" rather than padding the main list. Use web_search to corroborate when it is available.
OUTPUT CONTRACT: a scannable table/list — one row per item — with: name · one-line fit to THIS specific request (not generic) · the key qualifying attributes · source + date · confidence (High/Med/Low). Then the "Adjacent / stretch" and "Could not verify" sections.
SELF-AUDIT (run before you answer, fix what fails): (a) every item passes the stated criteria; (b) every figure is the correct metric, not a look-alike; (c) no duplicates / merged entities; (d) every item has a dated source; (e) nothing is padded to pad the count.`,

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
};

/**
 * The operating-procedure block for a request, or null when no Phase-1 family applies
 * (in which case behaviour is unchanged). Pure + synchronous.
 */
export function briefScaffold(
  userText: string,
  profile: TaskProfile | undefined,
  task: string | null | undefined,
): string | null {
  const family = briefFamily(userText, profile, task);
  if (!family) return null;
  return `${HEADER}\n${SCAFFOLDS[family]}\n${NO_FABRICATION}`;
}
