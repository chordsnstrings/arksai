/**
 * Pure formula recalculator for generated spreadsheets.
 *
 * The in-app xlsx PREVIEW (SheetJS) shows each formula cell's CACHED value. Models often write
 * a wrong/0/empty cached value, so a genuinely formula-driven model can look broken in-app
 * even though the DOWNLOADED file recalculates correctly in Excel/Sheets. This recomputes the
 * cached value for the common finance-model formula shapes (cell + cross-sheet refs, ranges,
 * + - * / ^ % and parens, and SUM/AVERAGE/MIN/MAX/COUNT/ROUND/ABS/IF).
 *
 * The formula string is ALWAYS preserved, so this is strictly preview-improving and has no
 * downside: anything it can't confidently evaluate is left EXACTLY as the model provided it
 * (and Excel will recompute it on open regardless). Pure + unit-tested.
 */

export interface RawCell {
  f?: string; // formula WITHOUT the leading "="
  v?: any; // cached value (number | string | …)
}
export type SheetGrid = Map<string, RawCell>; // "A1" -> cell
export type Workbook = Map<string, SheetGrid>; // sheet name -> grid

const colToNum = (c: string): number => {
  let n = 0;
  for (const ch of c.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
};
const colLet = (n: number): string => {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = ((n - m - 1) / 26) | 0;
  }
  return s;
};

/** Parse a generate_spreadsheet cell (literal | "=formula" | {f,v}) into a RawCell. */
function parseCell(cell: any): RawCell {
  if (typeof cell === 'string' && cell.length > 1 && cell[0] === '=') return { f: cell.slice(1) };
  if (cell && typeof cell === 'object' && typeof cell.f === 'string') return { f: cell.f, v: cell.v };
  return { v: cell };
}
const rowToArray = (row: any, cols: any[]): any[] =>
  Array.isArray(row) ? row : cols.map((c, i) => row?.[c?.key ?? c?.header ?? `c${i}`]);

/**
 * Recompute the cached values of formula cells in a generate_spreadsheet `sheets` structure,
 * IN PLACE, so the in-app preview shows correct numbers. Header is row 1, data rows are 2+,
 * columns are A,B,C… in order. Only confidently-evaluable formula cells are updated (rewritten
 * as {f,v}); the formula is preserved, so this never harms the downloaded file. Handles array
 * rows and object rows. Best-effort: any structural surprise is swallowed (leaves data as-is).
 */
export function recalcSheetData(sheets: any[]): void {
  if (!Array.isArray(sheets)) return;
  try {
    const wb: Workbook = new Map();
    const norm = sheets.map((s) => ({
      name: String(s?.name || 'Sheet').slice(0, 31),
      cols: Array.isArray(s?.columns) ? s.columns : [],
      rows: Array.isArray(s?.rows) ? s.rows : [],
    }));
    for (const s of norm) {
      const grid: SheetGrid = new Map();
      s.rows.forEach((row: any, ri: number) => {
        rowToArray(row, s.cols).forEach((cell: any, ci: number) => {
          grid.set(colLet(ci + 1) + (ri + 2), parseCell(cell));
        });
      });
      wb.set(s.name, grid);
    }
    recalc(wb);
    for (const s of norm) {
      const grid = wb.get(s.name)!;
      s.rows.forEach((row: any, ri: number) => {
        const arr = rowToArray(row, s.cols);
        arr.forEach((_cell: any, ci: number) => {
          const computed = grid.get(colLet(ci + 1) + (ri + 2));
          if (!computed?.f || typeof computed.v !== 'number') return;
          const val = { f: computed.f, v: computed.v };
          if (Array.isArray(row)) row[ci] = val;
          else {
            const key = s.cols[ci]?.key ?? s.cols[ci]?.header ?? `c${ci}`;
            if (key in row) row[key] = val;
          }
        });
      });
    }
  } catch {
    /* best-effort preview improvement — never block generation */
  }
}

/**
 * AUTHORITATIVE recalc: compute and cache every formula cell's result on a BUILT
 * ExcelJS workbook, using each cell's REAL coordinates. This is bulletproof where
 * recalcSheetData's row-mapping guesswork fails (a title row, object rows, merged
 * cells), because it reads the actual grid ExcelJS produced — the same coordinates
 * the model's formulas reference. Without this, a formula cell ships with NO cached
 * value and the in-app preview (and any non-recalculating viewer) shows BLANK.
 *
 * Duck-typed against the ExcelJS Worksheet/Cell API (no import needed). Best-effort:
 * never throws — the formula string is always preserved, so the download recalculates
 * in Excel regardless. Pure compute (no IO).
 */
export function recalcWorkbook(wbExcel: any): void {
  try {
    const colOf = (cell: any, cn: number): number => (typeof cn === 'number' ? cn : colToNum(String(cell?.col || 'A')));
    const formulaOf = (v: any): string | undefined => {
      if (v && typeof v === 'object') {
        if (typeof v.formula === 'string') return v.formula;
        if (typeof v.sharedFormula === 'string') return v.sharedFormula;
      }
      return undefined;
    };
    // 1) Build a grid (sheet -> "A1" -> {f?,v?}) from the real cells.
    const wb: Workbook = new Map();
    wbExcel.eachSheet((ws: any) => {
      const grid: SheetGrid = new Map();
      ws.eachRow({ includeEmpty: false }, (row: any, rn: number) => {
        row.eachCell({ includeEmpty: false }, (cell: any, cn: number) => {
          const addr = colLet(colOf(cell, cn)) + rn;
          const v = cell.value;
          const f = formulaOf(v);
          if (f) grid.set(addr, { f, v: typeof (v as any).result === 'number' ? (v as any).result : undefined });
          else if (typeof v === 'number') grid.set(addr, { v });
          else if (v && typeof v === 'object' && typeof (v as any).result === 'number') grid.set(addr, { v: (v as any).result });
          else grid.set(addr, { v });
        });
      });
      wb.set(ws.name, grid);
    });
    // 2) Recompute.
    recalc(wb);
    // 3) Write computed results back onto the real ExcelJS formula cells.
    //    CRITICAL: ExcelJS DROPS a formula cell that has no `result` — it writes an EMPTY
    //    cell and the formula string is LOST (verified). So EVERY formula cell must carry a
    //    result. We use the recomputed value when we have one; otherwise we keep whatever the
    //    model supplied; and as a last resort we stamp 0 so the formula survives (Excel/Sheets
    //    recalculates on open regardless, so a placeholder only affects the static preview).
    wbExcel.eachSheet((ws: any) => {
      const grid = wb.get(ws.name);
      if (!grid) return;
      ws.eachRow({ includeEmpty: false }, (row: any, rn: number) => {
        row.eachCell({ includeEmpty: false }, (cell: any, cn: number) => {
          const cur = cell.value;
          const f = formulaOf(cur);
          if (!f) return;
          const computed = grid.get(colLet(colOf(cell, cn)) + rn);
          const existing =
            cur && typeof cur === 'object' && typeof (cur as any).result === 'number' && Number.isFinite((cur as any).result)
              ? (cur as any).result
              : undefined;
          if (computed && typeof computed.v === 'number' && Number.isFinite(computed.v)) {
            cell.value = { formula: f, result: computed.v };
          } else if (existing === undefined) {
            cell.value = { formula: f, result: 0 }; // keep the formula alive (ExcelJS would drop it with no result)
          }
        });
      });
    });
  } catch {
    /* best-effort — never block generation; formula string is preserved either way */
  }
}

/** Recompute cached `v` for every confidently-evaluable formula cell, in place. */
export function recalc(wb: Workbook): void {
  const memo = new Map<string, number | undefined>(); // "sheet!A1" -> value (undefined = not numeric)
  const inProgress = new Set<string>(); // cycle guard

  const cellVal = (sheet: string, addr: string): number | undefined => {
    const key = `${sheet}!${addr}`;
    if (memo.has(key)) return memo.get(key);
    if (inProgress.has(key)) return undefined; // cycle → bail
    const grid = wb.get(sheet);
    const cell = grid?.get(addr);
    if (!cell) {
      memo.set(key, undefined);
      return undefined;
    }
    if (cell.f) {
      inProgress.add(key);
      let r: number | undefined;
      try {
        r = evalFormula(cell.f, sheet, cellVal);
      } catch {
        r = undefined;
      }
      inProgress.delete(key);
      memo.set(key, r);
      return r;
    }
    const n = typeof cell.v === 'number' ? cell.v : undefined;
    memo.set(key, n);
    return n;
  };

  for (const [sheet, grid] of wb) {
    for (const [addr, cell] of grid) {
      if (!cell.f) continue;
      const r = cellVal(sheet, addr);
      // Round away binary-float noise (110.00000000000001 → 110) so previews are clean.
      if (typeof r === 'number' && Number.isFinite(r)) cell.v = Math.round(r * 1e9) / 1e9;
      // else: leave the model's cached value untouched
    }
  }
}

type Resolver = (sheet: string, addr: string) => number | undefined;

// ---- recursive-descent expression evaluator ----
// Grammar: expr = term (('+'|'-') term)* ; term = power (('*'|'/') power)* ;
//          power = unary ('^' unary)* ; unary = '-' unary | postfix ;
//          postfix = primary '%'? ; primary = number | '(' expr ')' | func | ref ;
function evalFormula(formula: string, sheet: string, resolve: Resolver): number | undefined {
  const src = formula.trim();
  let i = 0;
  const ws = () => {
    while (i < src.length && /\s/.test(src[i])) i++;
  };
  const peek = () => {
    ws();
    return src[i];
  };

  // FAIL sentinel: throw to abort (caught by recalc → leaves model value).
  const fail = (): never => {
    throw new Error('unsupported');
  };

  // Read a column+row like B2 / $B$2 (no sheet prefix here).
  function readA1(): { col: string; row: number } | null {
    const m = /^\$?([A-Za-z]{1,3})\$?([0-9]{1,7})/.exec(src.slice(i));
    if (!m) return null;
    i += m[0].length;
    return { col: m[1].toUpperCase(), row: parseInt(m[2], 10) };
  }

  // A reference, optionally sheet-qualified, optionally a range (for use inside funcs).
  function readRef(): { vals: number[]; single: number | undefined } {
    let refSheet = sheet;
    // sheet prefix: Name! or 'Name with spaces'!
    const q = /^'([^']+)'!/.exec(src.slice(i));
    const u = /^([A-Za-z_][A-Za-z0-9_ ]*)!/.exec(src.slice(i));
    if (q) {
      refSheet = q[1];
      i += q[0].length;
    } else if (u && src[i + u[0].length - 1] === '!') {
      refSheet = u[1].trim();
      i += u[0].length;
    }
    const a = readA1();
    if (!a) fail();
    ws();
    if (src[i] === ':') {
      i++;
      ws();
      // optional sheet prefix on the end is uncommon; ignore
      const b = readA1();
      if (!b) fail();
      const c1 = colToNum(a!.col),
        c2 = colToNum(b!.col);
      const r1 = a!.row,
        r2 = b!.row;
      const vals: number[] = [];
      for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++)
        for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) {
          const v = resolve(refSheet, colLetters(c) + r);
          if (typeof v === 'number') vals.push(v);
        }
      return { vals, single: undefined };
    }
    const v = resolve(refSheet, a!.col + a!.row);
    if (v === undefined) return fail();
    return { vals: [v], single: v };
  }

  function colLetters(n: number): string {
    let s = '';
    while (n > 0) {
      const m = (n - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      n = ((n - m - 1) / 26) | 0;
    }
    return s;
  }

  const FUNCS: Record<string, (args: number[][]) => number> = {
    SUM: (a) => a.flat().reduce((s, x) => s + x, 0),
    AVERAGE: (a) => {
      const f = a.flat();
      return f.length ? f.reduce((s, x) => s + x, 0) / f.length : 0;
    },
    MIN: (a) => Math.min(...a.flat()),
    MAX: (a) => Math.max(...a.flat()),
    COUNT: (a) => a.flat().length,
    ROUND: (a) => {
      const [x, d] = [a[0]?.[0] ?? 0, a[1]?.[0] ?? 0];
      const p = Math.pow(10, d);
      return Math.round(x * p) / p;
    },
    ABS: (a) => Math.abs(a[0]?.[0] ?? 0),
    IF: (a) => (a[0]?.[0] ? a[1]?.[0] ?? 0 : a[2]?.[0] ?? 0),
  };

  function primary(): number {
    const ch = peek();
    if (ch === '(') {
      i++;
      const v = expr();
      ws();
      if (src[i] !== ')') fail();
      i++;
      return v;
    }
    // number
    const num = /^[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?/.exec(src.slice(i));
    if (num && !/^[A-Za-z]/.test(src.slice(i))) {
      i += num[0].length;
      return parseFloat(num[0]);
    }
    // function or reference: read an identifier; if followed by '(' it's a func
    const id = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(src.slice(i));
    if (id) {
      const save = i;
      const name = id[0].toUpperCase();
      // a function only if the NEXT non-space char after the identifier is '('
      if (src[i + id[0].length] === '(') {
        i += id[0].length + 1; // consume name + '('
        const fn = FUNCS[name];
        if (!fn) fail();
        const args: number[][] = [];
        ws();
        if (src[i] !== ')') {
          for (;;) {
            args.push(argList());
            ws();
            if (src[i] === ',') {
              i++;
              continue;
            }
            break;
          }
        }
        ws();
        if (src[i] !== ')') fail();
        i++;
        return fn(args);
      }
      i = save; // not a function → must be a reference
    }
    // reference (single cell) — readRef handles sheet/range, but a bare primary ref is single
    const r = readRef();
    if (r.single !== undefined) return r.single;
    fail();
    return 0; // unreachable
  }

  // an argument may be a range (→ array) or a scalar expression (→ [value])
  function argList(): number[] {
    const save = i;
    // try a range/ref first
    try {
      const before = i;
      const r = tryRangeRef();
      if (r) return r;
      i = before;
    } catch {
      i = save;
    }
    return [expr()];
  }

  function tryRangeRef(): number[] | null {
    const start = i;
    // sheet prefix?
    const q = /^'([^']+)'!/.exec(src.slice(i));
    const u = /^([A-Za-z_][A-Za-z0-9_ ]*)!/.exec(src.slice(i));
    let refSheet = sheet;
    if (q) {
      refSheet = q[1];
      i += q[0].length;
    } else if (u) {
      refSheet = u[1].trim();
      i += u[0].length;
    }
    const a = readA1();
    if (!a) {
      i = start;
      return null;
    }
    ws();
    if (src[i] === ':') {
      i++;
      ws();
      const b = readA1();
      if (!b) {
        i = start;
        return null;
      }
      const c1 = colToNum(a.col),
        c2 = colToNum(b.col);
      const vals: number[] = [];
      for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++)
        for (let r = Math.min(a.row, b.row); r <= Math.max(a.row, b.row); r++) {
          const v = resolve(refSheet, colLetters(c) + r);
          if (typeof v === 'number') vals.push(v);
        }
      return vals;
    }
    // single ref but check it's not part of a larger expression (e.g. B2*C2)
    ws();
    if (src[i] === ',' || src[i] === ')') {
      const v = resolve(refSheet, a.col + a.row);
      return v === undefined ? null : [v];
    }
    i = start;
    return null;
  }

  function postfix(): number {
    let v = primary();
    ws();
    if (src[i] === '%') {
      i++;
      v = v / 100;
    }
    return v;
  }
  function unary(): number {
    ws();
    if (src[i] === '-') {
      i++;
      return -unary();
    }
    if (src[i] === '+') {
      i++;
      return unary();
    }
    return postfix();
  }
  function power(): number {
    let v = unary();
    for (;;) {
      ws();
      if (src[i] === '^') {
        i++;
        v = Math.pow(v, unary());
      } else break;
    }
    return v;
  }
  function term(): number {
    let v = power();
    for (;;) {
      ws();
      const op = src[i];
      if (op === '*') {
        i++;
        v *= power();
      } else if (op === '/') {
        i++;
        v /= power();
      } else break;
    }
    return v;
  }
  function expr(): number {
    let v = term();
    for (;;) {
      ws();
      const op = src[i];
      if (op === '+') {
        i++;
        v += term();
      } else if (op === '-') {
        i++;
        v -= term();
      } else break;
    }
    return v;
  }

  const result = expr();
  ws();
  if (i < src.length) fail(); // trailing junk → don't trust it
  return Number.isFinite(result) ? result : undefined;
}
