import { toWorkbook, recalc, SUPPORTED_FNS, type Workbook } from './sheetcalc';

/**
 * Formula ACCURACY auditor for generated spreadsheets (the "excel perfect on the first go"
 * deepening, 2026-07-03). Three classes of defect the earlier audits couldn't see:
 *
 *  1. DANGLING REFERENCES — a formula pointing at a sheet that doesn't exist ("Asumptions!B2",
 *     "Cash Flow!C4" when the tab is "CashFlow") or at a single cell beyond the sheet's data
 *     extent (the classic banner-row / off-by-one shift). In Excel these read as #REF!/0 and
 *     silently corrupt every dependent number.
 *  2. DOT-NOTATION REFS — "Assumptions.B10" instead of "Assumptions!B10" (a known model quirk,
 *     seen live from M3): Excel treats it as a name error, the whole chain dies.
 *  3. CACHED-VALUE MISMATCHES — where the model supplied {f, v} and the formula is computable,
 *     recompute it: a material disagreement means the model's arithmetic and its formula tell
 *     two different stories, which almost always marks a WRONG formula (wrong row, wrong sign,
 *     missing term). The formula wins in the file; the mismatch is surfaced so the model
 *     re-checks those exact cells.
 *
 * PURE (no IO) — runs on the generate_spreadsheet `sheets` payload BEFORE the write, so the
 * model gets the defect list in the SAME tool result and fixes it in the same turn.
 */

export interface FormulaAudit {
  /** Hard defects: broken sheet refs + dot-notation (each entry names cell + formula + fix). */
  refDefects: string[];
  /** Cells whose cached value disagrees with the computed formula by >1% (top offenders). */
  mismatches: { cell: string; formula: string; cached: number; computed: number }[];
  /** Function names used that the recalc engine can't verify (telemetry, not user-facing). */
  unsupportedFns: string[];
  /** How many formula cells were checked / computable (coverage telemetry). */
  formulaCells: number;
  computedCells: number;
}

// Sheet-qualified ref: 'Quoted Name'!A1 or Name!A1 (captures the sheet part + the A1 part).
const SHEET_REF_RE = /(?:'([^']+)'|([A-Za-z_][A-Za-z0-9_ ]*))!\$?([A-Za-z]{1,3})\$?(\d{1,7})(:\$?[A-Za-z]{1,3}\$?\d{1,7})?/g;
// Dot-notation ref: Sheet.B10 (alpha-starting ident + dot + A1). Guarded against decimals.
const DOT_REF_RE = /\b([A-Za-z_][A-Za-z0-9_]{1,30})\.(\$?[A-Z]{1,3}\$?\d{1,7})\b/g;
// Function calls, to spot ones the verifier can't compute.
const FN_RE = /\b([A-Z][A-Z0-9_]{1,15})\s*\(/g;
// A formula that is NOTHING BUT one sheet-qualified single-cell ref ("=Assumptions!$B$4") —
// a passthrough row, where the source and target row labels should agree.
const BARE_PASSTHROUGH_RE = /^=?\s*(?:'([^']+)'|([A-Za-z_][A-Za-z0-9_ ]*))!\$?([A-Za-z]{1,3})\$?(\d{1,7})\s*$/;

// Content-token overlap between two row labels ("Rent" ↔ "rent per month (AED)" = yes;
// "Rent" ↔ "bean cost per unit (AED)" = no). Light plural stem; unit/glue words ignored.
const LABEL_NOISE = new Set(['per', 'month', 'monthly', 'aed', 'usd', 'the', 'of', 'a', 'an', 'and', 'rate', 'value', 'total', 'amount']);
const labelTokens = (s: string): Set<string> => {
  const out = new Set<string>();
  for (const m of s.toLowerCase().match(/[a-z]{2,}/g) ?? []) {
    const w = m.length > 4 && m.endsWith('s') ? m.slice(0, -1) : m;
    if (!LABEL_NOISE.has(w)) out.add(w);
  }
  return out;
};
export function labelsOverlap(a: string, b: string): boolean {
  const ta = labelTokens(a);
  const tb = labelTokens(b);
  if (!ta.size || !tb.size) return true; // unscoreable labels never accuse
  return [...ta].some((t) => tb.has(t));
}

const colToNum = (c: string): number => {
  let n = 0;
  for (const ch of c.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
};

interface SheetExtent {
  name: string;
  lastRow: number; // header row 1 + data rows
  lastCol: number;
}

function extents(sheets: any[]): SheetExtent[] {
  return (Array.isArray(sheets) ? sheets : []).map((s) => {
    const rows = Array.isArray(s?.rows) ? s.rows : [];
    const cols = Array.isArray(s?.columns) ? s.columns : [];
    const width = Math.max(cols.length, ...rows.map((r: any) => (Array.isArray(r) ? r.length : cols.length)), 1);
    return { name: String(s?.name || 'Sheet').slice(0, 31), lastRow: rows.length + 1, lastCol: width };
  });
}

/** Case/space-insensitive sheet lookup, so we can SUGGEST the intended tab on a near-miss. */
function findSheet(name: string, all: SheetExtent[]): SheetExtent | null {
  const norm = (x: string) => x.toLowerCase().replace(/[\s_]+/g, '');
  return all.find((s) => norm(s.name) === norm(name)) || null;
}

/** Extents measured from a pure Workbook map (used for the built-workbook path). */
function extentsFromWorkbook(wb: Workbook): SheetExtent[] {
  const out: SheetExtent[] = [];
  for (const [name, grid] of wb) {
    let lastRow = 1;
    let lastCol = 1;
    for (const addr of grid.keys()) {
      const m = /^([A-Z]{1,3})(\d+)$/.exec(addr);
      if (!m) continue;
      lastRow = Math.max(lastRow, parseInt(m[2], 10));
      lastCol = Math.max(lastCol, colToNum(m[1]));
    }
    out.push({ name, lastRow, lastCol });
  }
  return out;
}

/** Adapt a BUILT ExcelJS workbook (duck-typed) into the pure Workbook map — this sees ALL
 *  sheets including ones loaded from a prior append call, so cross-sheet refs audit correctly
 *  on staged builds. */
export function excelToWorkbook(wbExcel: any): Workbook {
  const wb: Workbook = new Map();
  try {
    for (const ws of wbExcel.worksheets ?? []) {
      const grid = new Map<string, { f?: string; v?: any }>();
      ws.eachRow({ includeEmpty: false }, (row: any, rowNum: number) => {
        row.eachCell({ includeEmpty: false }, (cell: any, colNum: number) => {
          const v = cell.value;
          let letters = '';
          let n = colNum;
          while (n > 0) {
            const m = (n - 1) % 26;
            letters = String.fromCharCode(65 + m) + letters;
            n = ((n - m - 1) / 26) | 0;
          }
          const addr = letters + rowNum;
          if (v && typeof v === 'object' && typeof v.formula === 'string') {
            grid.set(addr, { f: v.formula, v: typeof v.result === 'number' ? v.result : undefined });
          } else if (typeof v === 'number') {
            grid.set(addr, { v });
          } else if (v !== null && v !== undefined) {
            grid.set(addr, { v });
          }
        });
      });
      wb.set(String(ws.name), grid);
    }
  } catch {
    /* best-effort */
  }
  return wb;
}

/** Audit a BUILT ExcelJS workbook (append-safe: sees every sheet in the file). */
export function auditExcelWorkbook(wbExcel: any): FormulaAudit {
  return auditWorkbook(excelToWorkbook(wbExcel));
}

export function auditFormulaRefs(sheets: any[]): FormulaAudit {
  if (!Array.isArray(sheets) || !sheets.length) {
    return { refDefects: [], mismatches: [], unsupportedFns: [], formulaCells: 0, computedCells: 0 };
  }
  return auditWorkbook(toWorkbook(sheets), extents(sheets));
}

function auditWorkbook(wbSource: Workbook, extOverride?: SheetExtent[]): FormulaAudit {
  const out: FormulaAudit = { refDefects: [], mismatches: [], unsupportedFns: [], formulaCells: 0, computedCells: 0 };
  const ext = extOverride ?? extentsFromWorkbook(wbSource);
  const seenDefect = new Set<string>();
  const defect = (msg: string) => {
    if (!seenDefect.has(msg) && out.refDefects.length < 12) {
      seenDefect.add(msg);
      out.refDefects.push(msg);
    }
  };
  const unsupported = new Set<string>();

  const allFormulaCells: { sheet: string; addr: string; f: string }[] = [];
  for (const [sheetName, grid] of wbSource) {
    for (const [addr, cell] of grid) {
      if (cell.f) allFormulaCells.push({ sheet: sheetName, addr, f: cell.f });
    }
  }
  for (const { sheet, addr, f } of allFormulaCells) {
    out.formulaCells++;
    // 1. Dot-notation (check FIRST — it also fails the sheet-ref regex silently otherwise).
    for (const m of f.matchAll(DOT_REF_RE)) {
      const [, name, a1] = m;
      if (findSheet(name, ext)) {
        defect(
          `${sheet}!${addr}: "${name}.${a1}" uses DOT notation — Excel needs "!" (write ${name}!${a1}). Dot refs break the whole dependent chain.`,
        );
      }
    }
    // 2. Sheet-qualified refs: existence + single-cell extent.
    for (const m of f.matchAll(SHEET_REF_RE)) {
      const name = (m[1] ?? m[2] ?? '').trim();
      const col = m[3].toUpperCase();
      const row = parseInt(m[4], 10);
      const isRange = !!m[5];
      const target = ext.find((s) => s.name === name) || null;
      if (!target) {
        const near = findSheet(name, ext);
        defect(
          near
            ? `${sheet}!${addr}: references sheet "${name}" but the tab is named "${near.name}" — fix the reference (sheet names must match EXACTLY).`
            : `${sheet}!${addr}: references sheet "${name}" which does not exist in this workbook.`,
        );
        continue;
      }
      // Ranges legitimately over-extend (SUM(B2:B100) padding); only single-cell refs beyond
      // the extent are the banner-shift bug.
      if (!isRange && (row > target.lastRow || colToNum(col) > target.lastCol)) {
        defect(
          `${sheet}!${addr}: references ${name}!${col}${row} but "${name}" only has ${target.lastRow} rows × ${target.lastCol} columns — the reference points at an EMPTY cell (reads as 0). Likely an off-by-one from a banner/section row.`,
        );
      }
    }
    // 3. Unsupported-function telemetry.
    for (const m of f.matchAll(FN_RE)) {
      if (!SUPPORTED_FNS.has(m[1])) unsupported.add(m[1]);
    }
    // 5. Label sanity on BARE PASSTHROUGH refs (bake-off round 2 blind spot: "Rent" =
    // Assumptions!$B$4 = the bean-cost cell — self-consistent, so nothing above fires).
    // Scope, to stay false-positive-safe: the WHOLE formula is one absolute-ish ref into a
    // narrow (≤3-col) assumptions-style sheet, the two row labels share no content token,
    // and a like-named row EXISTS on the target sheet — that is the off-by-one, name it.
    const bare = BARE_PASSTHROUGH_RE.exec(f);
    if (bare) {
      const name = (bare[1] ?? bare[2] ?? '').trim();
      const col = bare[3].toUpperCase();
      const row = parseInt(bare[4], 10);
      const target = ext.find((s) => s.name === name);
      const tgrid = wbSource.get(name);
      if (target && tgrid && target.lastCol <= 3) {
        const srcRow = parseInt(addr.replace(/^[A-Z]+/, ''), 10);
        const srcLabel = String(wbSource.get(sheet)?.get(`A${srcRow}`)?.v ?? '').trim();
        const tgtLabel = String(tgrid.get(`A${row}`)?.v ?? '').trim();
        if (srcLabel && tgtLabel && !labelsOverlap(srcLabel, tgtLabel)) {
          for (let r = 1; r <= target.lastRow; r++) {
            const cand = String(tgrid.get(`A${r}`)?.v ?? '').trim();
            if (r !== row && cand && labelsOverlap(srcLabel, cand)) {
              defect(
                `${sheet}!${addr}: row "${srcLabel}" is a passthrough of ${name}!${col}${row} ("${tgtLabel}") — the labels don't match. Did you mean ${name}!$${col}$${r} ("${cand}")? This is the classic off-by-one on the assumptions block.`,
              );
              break;
            }
          }
        }
      }
    }
  }
  out.unsupportedFns = [...unsupported].sort();

  // 4. Cached-vs-computed mismatches: snapshot the model's cached values, recompute on a
  // deep copy (recalc mutates), diff.
  try {
    const wb: Workbook = new Map();
    for (const [name, grid] of wbSource) {
      const copy = new Map<string, { f?: string; v?: any }>();
      for (const [addr, cell] of grid) copy.set(addr, { ...cell });
      wb.set(name, copy);
    }
    const cached = new Map<string, number>();
    for (const [sheet, grid] of wb) {
      for (const [addr, cell] of grid) {
        if (cell.f && typeof cell.v === 'number') cached.set(`${sheet}!${addr}`, cell.v);
      }
    }
    recalc(wb);
    for (const [sheet, grid] of wb) {
      for (const [addr, cell] of grid) {
        if (!cell.f) continue;
        const key = `${sheet}!${addr}`;
        const before = cached.get(key);
        const after = typeof cell.v === 'number' ? cell.v : undefined;
        if (after !== undefined) out.computedCells++;
        if (before === undefined || after === undefined) continue;
        const scale = Math.max(1, Math.abs(before), Math.abs(after));
        if (Math.abs(after - before) / scale > 0.01) {
          out.mismatches.push({ cell: key, formula: cell.f, cached: before, computed: after });
        }
      }
    }
    // Worst first, bounded.
    out.mismatches.sort((a, b) => {
      const ra = Math.abs(a.computed - a.cached) / Math.max(1, Math.abs(a.cached));
      const rb = Math.abs(b.computed - b.cached) / Math.max(1, Math.abs(b.cached));
      return rb - ra;
    });
    out.mismatches = out.mismatches.slice(0, 8);
  } catch {
    /* mismatch pass is best-effort */
  }
  return out;
}

/** Render the audit as tool-result lines (hard defects + a bounded mismatch warning). */
export function formulaAuditLines(a: FormulaAudit): string[] {
  const lines = [...a.refDefects];
  if (a.mismatches.length) {
    const tops = a.mismatches
      .slice(0, 5)
      .map((m) => `${m.cell} (=${m.formula}: you cached ${m.cached}, the formula computes ${m.computed})`)
      .join('; ');
    lines.push(
      `${a.mismatches.length} formula cell(s) where your cached value DISAGREES with what the formula computes — the formula wins in the file, but a disagreement usually means the FORMULA is wrong (wrong row/sign/term). Re-check: ${tops}.`,
    );
  }
  return lines;
}
