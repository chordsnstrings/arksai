import fs from 'node:fs';
import path from 'node:path';
import { execBash } from '../../lib/exec';
import { resolveInWorkspace, ToolError, type ToolDef } from './common';

const MAX_OUTPUT = 40_000; // chars returned to the model

/**
 * Turn a sheet name into a safe SQL table identifier (lowercase snake, deduped). Pure +
 * exported so read_spreadsheet can advertise the SAME names and tests can lock the mapping.
 * MUST stay in sync with the inline Python `_san` below.
 */
export function sanitizeTableName(name: string, used: Set<string>): string {
  let t = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  if (!t) t = 'sheet';
  if (/^[0-9]/.test(t)) t = 't_' + t;
  let final = t;
  let i = 2;
  while (used.has(final)) final = `${t}_${i++}`;
  used.add(final);
  return final;
}

/** The sanitized table name for each sheet, in order (for advertising in the manifest). */
export function tableNamesFor(sheetNames: string[]): { sheet: string; table: string }[] {
  const used = new Set<string>();
  return sheetNames.map((s) => ({ sheet: s, table: sanitizeTableName(s, used) }));
}

/**
 * The Python that loads EVERY tab into DuckDB and runs the SQL, printing only the table map +
 * the bounded result. Pure (returns the script text) so it's unit-testable. Path/SQL/limit are
 * passed via ENV (never interpolated) so there's no quoting/injection problem. Data stays in the
 * child process — only the answer comes back, the way a runtime query should.
 */
export function buildQueryScript(): string {
  return `
import os, sys, re
try:
    import pandas as pd
    import duckdb
except Exception as e:
    print("MISSING_DEPS: pandas/duckdb not installed in this environment — " + str(e))
    sys.exit(0)

path = os.environ["ARKSAI_XLSX"]
sql = os.environ["ARKSAI_SQL"]
try:
    limit = max(1, int(os.environ.get("ARKSAI_LIMIT", "50") or "50"))
except Exception:
    limit = 50

def _san(name, used):
    t = re.sub(r"_+", "_", re.sub(r"[^a-z0-9_]+", "_", str(name).lower())).strip("_")
    if not t: t = "sheet"
    if re.match(r"^[0-9]", t): t = "t_" + t
    final, i = t, 2
    while final in used:
        final = t + "_" + str(i); i += 1
    used.add(final)
    return final

ext = os.path.splitext(path)[1].lower()
con = duckdb.connect()
tables = []
used = set()
try:
    if ext in (".csv", ".tsv", ".txt"):
        df = pd.read_csv(path, sep=None, engine="python")
        con.register("data", df); used.add("data")
        tables.append(("data", os.path.basename(path), list(df.columns), len(df)))
    else:
        sheets = pd.read_excel(path, sheet_name=None)
        for name, df in sheets.items():
            df.columns = [str(c).strip() for c in df.columns]
            t = _san(name, used)
            con.register(t, df)
            tables.append((t, name, list(df.columns), len(df)))
except Exception as e:
    print("LOAD_ERROR: could not open the workbook — " + str(e))
    sys.exit(0)

print("TABLES (use these names in your SQL):")
for t, orig, cols, nrows in tables:
    shown = ", ".join(map(str, cols[:30])) + (" …" if len(cols) > 30 else "")
    print('  ' + t + '  ⟵ sheet "' + str(orig) + '"  (' + str(nrows) + ' rows, ' + str(len(cols)) + ' cols: ' + shown + ')')
print()

if os.environ.get("ARKSAI_PROFILE", "") == "1":
    # "What's in this messy file?" — per-column stats for every tab, no cells paged.
    for t, orig, cols, nrows in tables:
        print('— PROFILE: ' + t + ' (sheet "' + str(orig) + '", ' + str(nrows) + ' rows) —')
        try:
            summ = con.execute('SUMMARIZE "' + t + '"').df()
            keep = [c for c in ['column_name', 'column_type', 'min', 'max', 'approx_unique', 'avg', 'null_percentage'] if c in summ.columns]
            with pd.option_context("display.max_rows", 200, "display.width", 240, "display.max_colwidth", 28):
                print(summ[keep].to_string(index=False))
        except Exception as e:
            print('  (profile failed: ' + str(e) + ')')
        print()
    sys.exit(0)

if not sql.strip():
    print("No SQL given — above are the queryable tables. Call again with a sql query, e.g. SELECT * FROM " + (tables[0][0] if tables else "data") + " LIMIT 20.")
    sys.exit(0)

try:
    res = con.execute(sql).df()
except Exception as e:
    print("SQL_ERROR: " + str(e))
    print("(Check the table/column names against the list above; identifiers with spaces or symbols need double quotes.)")
    sys.exit(0)

n = len(res)
print("RESULT: " + str(n) + " row(s)" + ((" — showing first " + str(limit)) if n > limit else ""))
with pd.option_context("display.max_columns", 60, "display.width", 240, "display.max_colwidth", 40):
    print(res.head(limit).to_string(index=False))
`.trim();
}

export const querySpreadsheetTool: ToolDef = {
  name: 'query_spreadsheet',
  description:
    'Run a SQL query across ALL tabs of a spreadsheet (.xlsx/.xls/.csv) and get back ONLY the result — ' +
    'the right way to analyse a LARGE or MULTI-TAB workbook (totals, group-bys, joins across tabs, pivots, ' +
    'filters, reconciliation) WITHOUT paging raw cells into the conversation. Every sheet is loaded into ' +
    'DuckDB as a table; the data stays in a separate process, so this scales to huge, many-tab files. ' +
    'Call with `path` + a `sql` query (DuckDB SQL). Each tab becomes a table named after the sheet ' +
    '(lower_snake_case); the result always lists the available table names + columns first, so you can ' +
    'call once with an empty/simple sql to discover them, then again with the real query. Identifiers with ' +
    'spaces/symbols need double quotes. Example: SELECT category, SUM(amount) FROM transactions GROUP BY 1 ' +
    'ORDER BY 2 DESC. Pass `profile: true` (no sql needed) to get per-column stats for EVERY tab — type, ' +
    'min/max, distinct count, average, % null — the ideal FIRST move on a messy/unfamiliar file. Use ' +
    'read_spreadsheet for a quick visual peek; use THIS for any real computation.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Workspace path to the spreadsheet, e.g. "uploads/data.xlsx".' },
      sql: {
        type: 'string',
        description:
          'A DuckDB SQL query over the tabs (each sheet is a table, lower_snake_case of its name). ' +
          'Leave empty to just list the queryable tables + columns first.',
      },
      profile: {
        type: 'boolean',
        description:
          'When true, skip sql and print per-column stats (type, min, max, distinct count, average, % null) ' +
          'for every tab — best for understanding an unfamiliar/messy file before querying it.',
      },
      limit: { type: 'number', description: 'Max result rows to print (default 50).' },
    },
    required: ['path'],
  },
  modes: ['chat', 'plan', 'code', 'report'],
  summarize: (a) => `query_spreadsheet ${String(a.path ?? '').slice(0, 50)}`,
  async run(args, ctx) {
    const p = String(args.path ?? '').trim();
    if (!p) return 'Error: a `path` is required.';
    let abs: string;
    try {
      abs = resolveInWorkspace(ctx.repoDir, p);
    } catch (e) {
      return `Error: ${e instanceof ToolError ? e.message : String(e)}`;
    }
    if (!fs.existsSync(abs)) return `Error: no file at "${p}".`;

    const scriptPath = path.join(ctx.repoDir, `.arksai_query_${Date.now()}.py`);
    try {
      fs.writeFileSync(scriptPath, buildQueryScript());
    } catch (e: any) {
      return `Error: could not stage the query — ${e?.message ?? e}`;
    }
    try {
      const res = await execBash(`python3 ${JSON.stringify(scriptPath)}`, {
        cwd: ctx.repoDir,
        timeoutMs: 90_000,
        signal: ctx.signal,
        env: {
          ARKSAI_XLSX: abs,
          ARKSAI_SQL: String(args.sql ?? ''),
          ARKSAI_LIMIT: String(args.limit ?? 50),
          ARKSAI_PROFILE: args.profile ? '1' : '',
        },
      });
      let out = res.output.trim();
      if (out.includes('MISSING_DEPS:')) {
        out +=
          '\n\n[query_spreadsheet needs pandas + duckdb. Install once with: ' +
          'pip3 install --break-system-packages pandas openpyxl duckdb — then retry. ' +
          'Or read the file with read_spreadsheet instead.]';
      }
      if (!out) out = '(no output — the query returned nothing)';
      return out.length > MAX_OUTPUT ? out.slice(0, MAX_OUTPUT) + '\n… [output truncated — add a tighter filter or LIMIT]' : out;
    } catch (e: any) {
      return `Error running the query: ${e?.message ?? e}`;
    } finally {
      try {
        fs.unlinkSync(scriptPath);
      } catch {
        /* best-effort cleanup */
      }
    }
  },
};
