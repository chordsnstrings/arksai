# Spreadsheet / financial-model edge cases — and how each is handled

The catalog of known ways a generated `.xlsx` (especially a financial model) can be wrong, and the
mechanism that prevents or catches each. The governing principle (operator): **get a correct model on
the first try even if it takes longer — a wrong-but-fast model is the failure.** When the structured
`generate_spreadsheet` can't cleanly express a model, escalating to openpyxl is correct (it's what an
expert does); `recalc_spreadsheet` then verifies it authoritatively in ONE call.

| # | Edge case | How it shows up | Handled by |
|---|-----------|-----------------|------------|
| 1 | **Advanced formulas the in-tool JS recalc can't compute** (NPV, IRR, XIRR, VLOOKUP, INDEX/MATCH, AND/OR/NOT, STDEV, dates) | Preview shows the model's supplied cached value, which may be wrong/0/blank | **`recalc_spreadsheet`** (LibreOffice) recomputes every function authoritatively and writes the true value back; the gate runs the same recalc on delivery |
| 2 | **Circular references** (interest ↔ debt ↔ cash) | JS recalc's cycle guard leaves the cell; a true 3-statement model needs iterative calc | Escalate to **openpyxl** (build the linked model), then **`recalc_spreadsheet`** (LibreOffice iterative calc) |
| 3 | **Error cells only visible after a real recompute** (#REF!/#VALUE!/#DIV0!/#NAME?/#N/A) | A model-supplied cached value masks the error in the as-written file | **`recalc_spreadsheet`** + the gate's LibreOffice recalc surface every error cell; `functionalCheck` fails the gate on them |
| 4 | **Cross-sheet reference stored as TEXT** (missing leading `=`, e.g. `Assumptions!$B$10`) | Sits inert; every dependent cell breaks | Auto-healed in `toCell` (excel.ts); `auditFormulaModel` `STRINGY_REF_RE` flags any that slip through |
| 5 | **Hard-coded derived row** (a Total/Net/Margin/Growth row typed as literals while the model uses formulas elsewhere) | Looks right but doesn't flow when an assumption changes | `auditFormulaModel` (deliverableCheck.ts) — rejected, sent back |
| 6 | **Hard-coded Summary/output sheet** (0 formulas while the model computes elsewhere) | Summary goes stale when drivers change | `auditFormulaModel` (`SUMMARY_SHEET_RE`) |
| 7 | **Empty statement sheet** (a P&L / Balance Sheet / Cash Flow tab with a header but no data while the rest is built) | A header-only stub ships | `auditFormulaModel` (`STATEMENT_SHEET_RE`, `emptyStatementSheet`) |
| 8 | **Whole model hard-coded** (0 formulas, derived rows) | A value-dump, not a model | `auditFormulaModel`; steering forbids value-dumping scripts |
| 9 | **Decorative banner row inside data** (`── CASH FLOW ──`, `═══`) | Shifts every row down → absolute refs point at the wrong cell | `detectBannerRows` |
| 10 | **Section/divider label row inside a calc sheet** (`SPACE & LEASE`, `—— REVENUE ——`) | Same row-shift damage | `detectSectionRows` |
| 11 | **Mis-referenced formula → absurd outlier** (a 140-million line in a small model) | A formula landed on the wrong cell | `auditNumericSanity` (row-wise outlier) + `recalc_spreadsheet` recompute |
| 12 | **Rate/percent leaked into a money column** (revenue cell reads 0.30 not 6,000) | A whole money row of 0–1 values | `auditNumericSanity` (rate-leak) |
| 13 | **Derived row computes to 0** while inputs aren't zero | A Total/Net/Balance row all-zero beside real numbers | `auditNumericSanity` (derived-zero) |
| 14 | **ExcelJS drops a formula with no cached result** | The formula string + value vanish from the file | `recalcWorkbook` keeps a placeholder result (sheetcalc.ts); `recalc_spreadsheet` backfills the real value |
| 15 | **Over-building beyond the template** (the model rebuilds the seeded `financial-model` into a fuller, manually-linked model and loops to hand-verify) | A ~20-min runaway round-tripping openpyxl + LibreOffice by hand | Blessed **openpyxl escalation** + **`recalc_spreadsheet`** as the SINGLE authoritative verify (no hand-loop) |
| 16 | **Dropped / mis-filed source rows** (extracting a sheet from PDFs/scans) | A supplier/month silently lost | Reconcile-first steering in `generate_spreadsheet` description + FIN_SHEET |
| 17 | **Stale cached preview values** (formula correct, cached `v` wrong → preview/first-open shows a wrong number) | Preview disagrees with Excel's recompute | `recalcSheetData`/`recalcWorkbook` pre/post write; `recalc_spreadsheet` + gate writeback for advanced formulas |

## The two reinforcing mechanisms

- **`recalc_spreadsheet` tool** (`server/src/agent/tools/recalcSheet.ts`) — the authoritative "are my
  numbers right?" step. Runs the workbook through headless LibreOffice (every Excel function), writes
  the true computed values back as cached results, and reports error cells + sanity findings in ONE
  call. The model calls it after building/editing a model instead of hand-looping LibreOffice.
- **Gate integration** (`checkDeliverable`, `server/src/agent/deliverableCheck.ts`) — the same
  LibreOffice recalc runs on every delivered `.xlsx` before the functional + audit checks, so even a
  model that didn't call the tool ships with correct cached values and a real error-cell check.

Both degrade gracefully to the built-in JS recalculator (SUM/IF/arithmetic/refs) when LibreOffice is
unavailable. Escalation to openpyxl is blessed in the steering (excel.ts description, `expertise.ts`
FIN_SHEET, `prompts.ts`, `definitionOfDone.ts`) for models the structured tool can't cleanly express.
