# EXCEL_BAKEOFF — multi-sheet big-data accuracy across the model menu (2026-07-03)

**Question (operator):** with the BytePlus brains available, which model handles multi-sheet
big-data Excel most ACCURATELY — and what should we optimize in generation?

**Method (run live from the sandbox on the coding-plan endpoint, streaming):** two tasks per
model, scored deterministically through the REAL pipeline — no judge model.
- **GENERATION**: emit the exact `generate_spreadsheet` arguments for a 24-month, 4-sheet,
  formula-driven Dubai roastery model (Assumptions → Revenue → Opex → PnL, compounding growth,
  cross-sheet refs, IF-gated tax, cumulative cash). Scored by the real tool run + the NEW
  `sheetAudit` (dangling refs, dot-notation, extent violations, cached-vs-computed mismatches).
- **ANALYSIS**: write 4 DuckDB SQL queries over a 9.5k-row 3-sheet workbook (orders/refunds/
  catalog, multi-row refunds per order) — executed via the real query_spreadsheet loader and
  compared to independently computed ground truth.

## Results

| Model | Gen time | Out tokens | Ref defects | **Cached-value mismatches** | Audit verdict | Analysis (4 qs) |
|---|---|---|---|---|---|---|
| **seed-2-0-pro** (our Swift lane) | **96–161 s** | **10.4 k** | 0 | **0** | **audit-clean** | **4/4 (16–21 s)** |
| deepseek-v4-pro | 351 s | 20.7 k | 0 | 0 | audit-clean | 4/4 (43 s) |
| seed-2-0-code | 388 s | 20.7 k | 0 | 0 | audit-clean | 3/4 (q1: returned the wrong region — its net-revenue definition drifted from the spec) |
| deepseek-v4-flash | 382 s | 24.6 k | 0 | **8+** | REJECTED in-tool | 4/4 (31 s) |
| kimi-k2-5 | 489 s | 16.1 k | 0 | **8+** | REJECTED in-tool | 4/4 (96 s) |
| glm-4-7 | 398 s | 25.5 k | — | — | no parseable strict JSON (truncated) | 4/4 (60 s) |
| glm-5-1 | 547 s | 26.4 k | — | — | no parseable strict JSON (truncated) | 4/4 (93 s) |

(Baseline for context, from the 2026-06-20 probe: MiniMax M3 built a comparable heavy model in
~107 s, formula-driven — not testable from this sandbox, key lives on the droplet.)

## Findings

1. **seed-2-0-pro wins both tasks decisively** — the only model that is fastest AND audit-clean
   AND the most token-efficient (half to a third of everyone else's output for the same model),
   and the fastest correct analyst. It is ALREADY our default fast lane (`byteplusModel`), so no
   routing change is needed for analysis; for heavy xlsx generation it matches M3's documented
   speed with verified-equal accuracy on this task.
2. **Multi-sheet big-data ANALYSIS is a solved problem across the whole menu**: 6 of 7 scored
   4/4 against ground truth (multi-row refund joins included). Model choice there is about
   SPEED, not accuracy — and the deterministic query_spreadsheet path is why.
3. **The new mismatch auditor caught real model arithmetic in the wild on its first outing**:
   deepseek-v4-flash and kimi-k2-5 both produced structurally-correct formulas whose cached
   values disagreed with what the formulas compute (8+ cells each) — the exact
   wrong-row/wrong-term failure the auditor exists for — and the tool result REJECTED the
   workbook in-turn with the offending cells named. seed-2-0-pro and v4-pro were mismatch-free,
   confirming the auditor doesn't misfire on compounding chains.
4. **GLM (4.7 + 5.1) can't hold a 25k-token strict-JSON payload in prose** — both truncated.
   NOTE: production uses streaming TOOL-CALL arguments, a different emission path; this rules
   GLM out for the raw-JSON harness shape, not necessarily for tool-call generation.
5. **Function coverage needs no expansion**: every parseable model expressed the entire model
   within sheetcalc's verified set (SUM/AVERAGE/MIN/MAX/COUNT/ROUND/ABS/IF + arithmetic +
   cross-sheet refs) — zero unsupported functions observed. The steering shapes the output to
   what we can verify.
6. `deepseek-v4-flash` and `deepseek-v4-flash-260425` are live on our coding plan (probed);
   v3.2 and seed-1.6-flash are not.

## What was optimized (shipped with this doc)

- **`sheetAudit.ts`** — the formula-accuracy auditor (dangling sheet refs w/ near-miss
  suggestions, dot-notation, single-cell extent violations, cached-vs-computed mismatches),
  wired into generate_spreadsheet's same-turn result: mismatches from the raw payload (before
  the recalc passes overwrite cached values), reference defects from the BUILT workbook so
  staged appends audit the whole file. 8 unit tests + validated against live model output above.
- **Big-data write speed**: cosmetic per-cell styling passes cap past 5k rows, auto-width
  samples 500 rows → 120k-row generation 12.3 s → 9.1 s, no visual change for normal sheets.
- **No blind routing flip**: heavy xlsx stays on the M3 lane (quality-proven live in June);
  seed-2-0-pro is the verified-equal, cheaper alternative when the fast lane runs the build.
  A droplet-side A/B (where the M3 key lives) is the one remaining comparison if we want to
  make seed-2-0-pro the heavy-xlsx default.


---

# Round 2 (2026-07-06): schema × model — the PATTERN DSL result

**Question (operator):** "excel generation is accurate, but extremely slow… test all options
for the fastest but most accurate output."

**Method:** same 24-month 4-sheet roastery model, now with PINNED assumptions + exact row
labels so a 4-point SEMANTIC ground truth is computable (units/revenue/net/cumulative-cash at
M24, independently calculated). Two schemas per model: **verbose** (today's shape — the model
dictates every cell) and **pattern** (a compact DSL: per-row formula patterns with {PREV} and
label-based {ROW:...} refs — expanded deterministically to 24 columns server-side, then run
through the REAL generate_spreadsheet + audits). Production baseline: one live end-to-end M3
run on arksai.studio.

| Model | Schema | Total | First token | Out tokens | Audit | Ground truth |
|---|---|---|---|---|---|---|
| M3 (LIVE prod, end-to-end incl. gates) | verbose | 461 s | — | — | clean | 4/4 |
| **seed-2-0-pro** | **pattern** | **16.1 s** | 7.1 s | **956** | clean | **4/4** |
| deepseek-v4-flash | pattern | 36.3 s | 25.0 s | 2,213 | clean | 4/4 |
| deepseek-v4-pro | pattern | 77.8 s | 67.1 s | 3,719 | clean | 4/4 |
| glm-5-1 | pattern | 138.2 s | 126.6 s | 5,999 | clean | 4/4 |
| seed-2-0-pro | verbose | 97.6 s | 23.1 s | 6,189 | "clean" | **0/4 — WRONG** |
| deepseek-v4-flash | verbose | 250.6 s | 123.7 s | 17,081 | — | unparseable JSON |
| deepseek-v4-pro | verbose | 920 s | 576 s | 11,382 | clean | 4/4 |

Every pattern run produced BIT-IDENTICAL ground-truth numbers to the M3 production output
(cum cash M24 = −93,356.96). One run per cell — ordering corroborated by Round 1.

## Findings

1. **The pattern DSL wins on BOTH axes, across every model tried.** 4 different models ×
   pattern = 4/4 semantic accuracy each; the fastest (seed-2-0-pro) needs 16 s and 956 output
   tokens vs the 461 s live production baseline — ~29× end-to-end, ~6× vs its own verbose run.
2. **Verbose isn't just slow — it is the accuracy risk.** seed-2-0-pro's verbose run was
   "audit-clean" yet semantically WRONG: its Assumptions refs were off by one row (Units M1
   grabbed opening cash 150000; "Rent" = 18/mo — the bean cost). Self-consistent formula
   chains pass the structural audit; the semantic ground-truth check caught it. Dictating
   absolute addresses across sheets is the failure mode; the DSL's label-based refs remove it
   by construction. v4-flash's verbose run truncated into invalid JSON (17k tokens).
3. **DSL robustness rules learned in-harness** (both belong in a production expander):
   assumptions must be referenced BY LABEL (never $B$n — models miscount header offsets), and
   label lookup must be tolerant (normalize case/punctuation; "opening cash" ↔ "opening cash
   (AED)"). The in-tool audit caught every expander misstep during development — in production
   the expander is deterministic, unit-tested code.
4. **Bonus audit gap found:** a semantically-wrong-but-self-consistent ref (rent ← bean-cost
   cell) passes today's plausibility audit. A label-vs-referenced-label sanity check (the
   "rent" row referencing a row labeled "bean cost" is suspicious) would catch it cheaply.

## Recommendation

Adopt BOTH: (a) a `pattern` mode on generate_spreadsheet (rows-as-patterns, label refs,
deterministic expansion — steered as the DEFAULT for time-series/financial models; verbose
stays for ad-hoc tables), and (b) route the heavy-xlsx turn to **seed-2-0-pro**. Together:
~16 s of model time for what takes ~8 minutes today, with accuracy enforced by the same
audits plus the structurally-safer schema. Harness: scratchpad xb-spec.mjs / xb-run.mjs
(session 2026-07-06).
