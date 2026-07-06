import { ToolError } from './tools/common';

/**
 * PATTERN sheets for generate_spreadsheet — the compact, structurally-safe dialect for
 * time-series/financial models (2026-07-06 bake-off, EXCEL_BAKEOFF.md round 2).
 *
 * Why it exists: the verbose schema makes the model dictate every cell — slow (6–25k output
 * tokens) and FRAGILE (the bake-off caught a model whose Assumptions refs were off by one
 * row: "Rent" = the bean-cost cell — self-consistent, so the structural audit passed it).
 * Pattern sheets are ~1k tokens and reference rows BY LABEL, never by address, so the
 * entire off-by-one class is impossible by construction. Expansion is deterministic; all
 * existing audits (refs, cached-vs-computed, plausibility) run on the EXPANDED result.
 *
 * Dialect (a sheet is a pattern sheet when its rows are label objects, not cell arrays):
 *   {"name":"Revenue","months":24,"rows":[
 *     {"label":"Units","first":"={ROW:Assumptions!base units}","then":"={PREV}*(1+{ROW:Assumptions!growth})"},
 *     {"label":"Revenue","each":"={ROW:Units}*{ROW:Assumptions!price}"}]}
 *   {"name":"Assumptions","rows":[{"label":"growth","value":0.04}, ...]}   // value-only sheet
 * In formulas: {PREV} = this row's previous-month cell; {ROW:Label} = that row's cell in the
 * current month's column (same sheet); {ROW:Sheet!Label} = the same on another sheet — and
 * when the target sheet is value-only it resolves to the single value absolutely ($B$n).
 */

export interface PatternRow {
  label: string;
  value?: number | string;
  first?: string;
  then?: string;
  each?: string;
}

const MAX_MONTHS = 120;

const colLetter = (i: number): string => {
  let s = '';
  i += 1;
  while (i > 0) {
    s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
};

/** True when a sheet spec is written in the pattern dialect (label objects, not cell arrays). */
export function isPatternSheet(s: any): boolean {
  return (
    s &&
    Array.isArray(s.rows) &&
    s.rows.length > 0 &&
    s.rows.every((r: any) => r && typeof r === 'object' && !Array.isArray(r) && typeof r.label === 'string')
  );
}

const isValueOnly = (s: any): boolean => (s?.rows ?? []).every((r: any) => r.value !== undefined);

/** Tolerant label match — models abbreviate ("opening cash" vs "opening cash (AED)"). */
const norm = (x: unknown): string =>
  String(x).toLowerCase().replace(/[^a-z0-9% ]+/g, ' ').replace(/\s+/g, ' ').trim();

function findRow(rows: PatternRow[], label: string): number {
  const want = norm(label);
  const ns = (rows ?? []).map((r) => norm(r.label));
  let i = ns.findIndex((l) => l === want);
  if (i < 0) i = ns.findIndex((l) => l.startsWith(want) || want.startsWith(l));
  if (i < 0) i = ns.findIndex((l) => l.includes(want) || want.includes(l));
  return i;
}

/**
 * Expand every pattern sheet in a generate_spreadsheet `sheets` array into the standard
 * {name, columns, rows} shape (tool contract: columns render as row 1, data starts at row 2).
 * Non-pattern sheets pass through untouched, so mixed workbooks work. Throws ToolError with
 * an actionable message (including the available labels) on a bad reference.
 */
export function expandPatternSheets(sheets: any[]): any[] {
  const patternByName = new Map<string, any>();
  for (const s of sheets) if (isPatternSheet(s)) patternByName.set(String(s.name), s);
  if (!patternByName.size) return sheets;

  return sheets.map((sh) => {
    if (!isPatternSheet(sh)) return sh;
    const rowsIn: PatternRow[] = sh.rows;
    const n = Math.max(1, Math.min(MAX_MONTHS, Number(sh.months) || 24));
    const valueOnly = isValueOnly(sh);
    const columns = valueOnly
      ? [{ header: 'Driver', type: 'text' }, { header: 'Value', type: 'number' }]
      : [{ header: String(sh.item_header ?? 'Item'), type: 'text' }, ...Array.from({ length: n }, (_, m) => ({ header: monthHeader(sh, m), type: 'number' }))];

    const rows: any[] = [];
    rowsIn.forEach((r, ri) => {
      const rowNum = ri + 2; // columns are row 1; data starts at row 2
      const row: any[] = [String(r.label)];
      const subst = (f: string, m: number): string => {
        // m = 0-based month index; M1 lives in column B.
        const col = colLetter(m + 1);
        let out = String(f);
        out = out.replaceAll('{PREV}', `${colLetter(m)}${rowNum}`);
        out = out.replaceAll('{COL}', col);
        out = out.replace(/\{ROW:([^}]+)\}/g, (_, ref: string) => {
          const bang = ref.indexOf('!');
          if (bang > 0) {
            const sheetName = ref.slice(0, bang);
            const label = ref.slice(bang + 1);
            const target = patternByName.get(sheetName) ?? [...patternByName.values()].find((x) => norm(x.name) === norm(sheetName));
            if (!target)
              throw new ToolError(`pattern ref "{ROW:${ref}}" points at sheet "${sheetName}" which is not a pattern sheet in this call. Pattern refs only resolve between pattern sheets.`);
            const idx = findRow(target.rows, label);
            if (idx < 0)
              throw new ToolError(`pattern ref "{ROW:${ref}}": no row labeled like "${label}" on "${target.name}". Its rows are: ${target.rows.map((x: any) => `"${x.label}"`).join(', ')}.`);
            return isValueOnly(target) ? `'${target.name}'!$B$${idx + 2}` : `'${target.name}'!${col}${idx + 2}`;
          }
          const idx = findRow(rowsIn, ref);
          if (idx < 0)
            throw new ToolError(`pattern ref "{ROW:${ref}}": no row labeled like "${ref}" on this sheet. Its rows are: ${rowsIn.map((x) => `"${x.label}"`).join(', ')}.`);
          return `${col}${idx + 2}`;
        });
        return out;
      };

      if (r.value !== undefined) {
        row.push(r.value);
      } else if (r.each) {
        for (let m = 0; m < n; m++) row.push(subst(r.each, m));
      } else if (r.first) {
        if ((r.then ?? r.first).includes('{PREV}') && !r.then)
          throw new ToolError(`row "${r.label}": {PREV} needs a "then" formula (M1 has no previous month — give "first" without {PREV}).`);
        row.push(subst(r.first, 0));
        for (let m = 1; m < n; m++) row.push(subst(r.then ?? r.first, m));
      } else {
        throw new ToolError(`pattern row "${r.label}" needs one of: value, each, or first(+then).`);
      }
      rows.push(row);
    });
    return { ...sh, months: undefined, columns, rows };
  });
}

function monthHeader(sh: any, m: number): string {
  const labels = Array.isArray(sh.month_headers) ? sh.month_headers : null;
  return String(labels?.[m] ?? `M${m + 1}`);
}
