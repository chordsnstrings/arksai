import { fetchPublic } from '../../lib/web';
import type { ToolDef } from './common';

const MAX_ROWS = 500;
const MAX_COLS = 40;

/** Minimal, dependency-free CSV/TSV parse (handles quoted fields + escaped quotes). */
export function parseDelimited(text: string, delim: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === delim) {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') field += c;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

function summarizeTable(rows: string[][]): string {
  const total = rows.length;
  const clipped = rows.slice(0, MAX_ROWS).map((r) => r.slice(0, MAX_COLS).join(' | '));
  const note = total > MAX_ROWS ? `\n… (${total - MAX_ROWS} more rows omitted; ${total} total)` : `\n(${total} rows)`;
  return clipped.join('\n') + note;
}

/**
 * Pull live data from a public URL so the agent can build dashboards/reports off
 * real numbers — a Google-Sheets "publish to web" CSV link, a CSV/TSV/JSON file,
 * or an API endpoint. SSRF-guarded + size-capped. No credentials (private sources
 * are a separate, configured connector).
 */
export const fetchDataTool: ToolDef = {
  name: 'fetch_data',
  description:
    'Fetch live data from a PUBLIC url (a Google-Sheets "publish to web" CSV link, a CSV/TSV/JSON ' +
    'file, or a public API) and read it as a table/text — so you can build a dashboard, report, or ' +
    'analysis off real numbers instead of pasted data. For a PRIVATE (not published) Google Sheet on ' +
    "the user's connected Google account, use read_gsheet instead.",
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'A public http(s) URL to a CSV/TSV/JSON file, published sheet, or API.' },
    },
    required: ['url'],
  },
  modes: ['chat', 'code', 'report'],
  summarize: (a) => `fetch ${String(a.url ?? '').slice(0, 60)}`,
  async run(args, ctx) {
    const url = String(args.url ?? '').trim();
    if (!url) return 'Error: a url is required.';
    let res;
    try {
      res = await fetchPublic(url, ctx.signal);
    } catch (e: any) {
      return `Error: could not fetch — ${e?.message ?? e}`;
    }
    if (res.status >= 400) return `Error: the source returned HTTP ${res.status}.`;
    const body = res.body.trim();
    if (!body) return 'Error: the source returned no data.';

    const ct = res.contentType.toLowerCase();
    // JSON?
    if (ct.includes('json') || /^[[{]/.test(body)) {
      try {
        const json = JSON.parse(body);
        const pretty = JSON.stringify(json, null, 2);
        return `Fetched JSON from ${url}:\n\n${pretty.slice(0, 12000)}${pretty.length > 12000 ? '\n… (truncated)' : ''}`;
      } catch {
        /* fall through to delimited */
      }
    }
    // CSV/TSV — detect the delimiter from the first line.
    const firstLine = body.split('\n', 1)[0];
    const delim = (firstLine.match(/\t/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? '\t' : ',';
    const rows = parseDelimited(body, delim);
    if (rows.length <= 1 && !rows[0]?.length) {
      return `Fetched ${url} but it didn't parse as a table. Raw start:\n${body.slice(0, 4000)}`;
    }
    return `Fetched a table from ${url} (delimiter "${delim === '\t' ? 'tab' : 'comma'}"):\n\n${summarizeTable(rows)}`;
  },
};
