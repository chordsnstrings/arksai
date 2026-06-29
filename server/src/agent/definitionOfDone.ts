import type { TaskProfile } from './taskProfile';
import type { SessionMode } from '../../../shared/types';

/**
 * Definition of Done — the visual/structural twin of brief.ts's SELF_AUDIT_GATE.
 *
 * The verify/design gates run AFTER the build; the agent only learns the bar when a gate fails
 * it and forces a full re-loop. This injects the EXACT checks the gate enforces into the system
 * prompt UP FRONT, so the first build aims to pass them — no LLM call, no latency, no fabricated
 * specifics. The wording deliberately mirrors the gate's own defect strings (auditWebHygiene,
 * detectUnderfilledPages, auditFormulaModel, the contrast measurement) so "done" means "already
 * passes the gate". Auto-Brief (brief.ts) covers non-visual domain logic; this covers the
 * structural/visual defects that caused the repeated revise loops.
 */

// Spreadsheet / financial-model requests (no dedicated TaskType — detect from text). Conservative:
// real spreadsheet/model signals only, so a web "dashboard" or "budget app" doesn't trip it.
const XLSX_RE =
  /\b(spreadsheet|excel|xlsx|\.xls\b|financial model|cash[\s-]?flow|p&l|profit (and|&) loss|balance sheet|3[\s-]?statement|three[\s-]?statement|income statement|forecast model|budget model)\b/i;

const WEB_DOD = `## Definition of Done — your FIRST build must already pass these (they're the exact checks the gate runs; hit them up front so you don't iterate):
- <meta name="viewport" content="width=device-width, initial-scale=1"> is in <head>.
- EVERY <link>/<script>/<img> points at a file that actually EXISTS in the workspace — never link a landing.css/landing.js you didn't create (a 404 means those styles/scripts are silently missing and the page renders broken).
- No horizontal overflow at 390px (also 320/768): fluid widths, no fixed min-width >420px.
- The mobile menu / hamburger is WIRED to open (real toggle), not decorative.
- WCAG AA text contrast (≥4.5:1 body, 3:1 large) at REST, on HOVER, and in DARK mode — never colour text near its own background; if the design is dark, flip the ink tokens light (or pin color-scheme:light).
- For a progress ring/gauge, a KPI tile, or a data table, COMPOSE craft.css .gauge / .stat / .table-wrap — do not hand-build a fragile animated SVG ring or a custom responsive table.`;

const REPORT_DOD = `## Definition of Done — your FIRST render must already pass these (the exact gate checks):
- Every interior page is ≥60% full — no lonely near-empty page, no big blank lower band. Let content FLOW; do not force a page-break per section.
- No heading stranded at the bottom of a page — wrap each heading + its opening paragraph in a break-inside:avoid "lede" block.
- Every chart actually shows its bars/line — pass render_chart x/y/series that EXACTLY match the keys in your data rows (a name mismatch renders empty axes with no bars).
- No figure/chart clipped across a page break — wrap visuals in .fig / break-inside:avoid.
- Contrast safe: no text the same/near its background; callouts stay light.`;

const XLSX_DOD = `## Definition of Done — your FIRST workbook must already pass these (the exact gate checks):
- EVERY derived number is a LIVE formula (={f,v} / =SUM() / cross-sheet =Assumptions!$B$10), never a typed-in literal — a hard-coded Total/Net/Margin/Growth row IS rejected.
- EVERY statement sheet you include (P&L, Balance Sheet, Cash Flow) is FULLY POPULATED with line-item rows + formulas — never a header-only stub (an empty Cash Flow tab IS rejected).
- No decorative banner / section-divider rows inside a calc sheet (a "── CASH FLOW ──" row shifts every cell and breaks absolute references) — header on row 1, data from row 2.
- Totals via =SUM(); cross-sheet references use absolute $col$row and start with "=".
- For a 3-statement / multi-sheet model, START from the financial-model template (generate_spreadsheet template:"financial-model") so the cross-sheet wiring is correct by construction, then fill/rename the line items.
- If the model needs formulas generate_spreadsheet can't express (circular interest↔debt↔cash, NPV/IRR, VLOOKUP), build it with openpyxl (real formulas, not literals) and run recalc_spreadsheet ONCE — finish only with ZERO error cells. A correct model is worth a longer build.`;

/**
 * The Definition-of-Done block for this request, or null when none applies (today's behaviour).
 * Selection: report mode/type → report; a spreadsheet/model request → xlsx; a visual code build → web.
 */
export function definitionOfDone(
  userText: string,
  profile: TaskProfile | undefined,
  mode: SessionMode,
): string | null {
  if (mode === 'report' || profile?.type === 'report') return REPORT_DOD;
  if (XLSX_RE.test(userText || '')) return XLSX_DOD;
  if (profile?.isVisual && mode === 'code') return WEB_DOD;
  return null;
}
