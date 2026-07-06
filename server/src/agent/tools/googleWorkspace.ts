import fs from 'node:fs';
import path from 'node:path';
import { ToolError, resolveInWorkspace, type ToolCtx, type ToolDef } from './common';
import { googleConfigured, getValidAccessToken } from '../../googleConnect';
import { extractText } from '../../lib/extract';

/**
 * Google Workspace tools — Gmail / Calendar / Drive / Sheets over the CURRENT USER's
 * connected Google account (Settings → Connections). The token is resolved server-side
 * per session creator and never enters the model context. Every tool degrades to an
 * honest "connect Google first" error when the user hasn't linked an account.
 *
 * Data-minimization: read tools return only what was asked for (bounded digests, not
 * mailbox dumps). Outbound actions (send_gmail, create_calendar_event with attendees)
 * leave the workspace — the agent confirms with the user first, same as send_email.
 */

// Injectable for tests (the repo pattern: tests inject fetch, no live calls).
let httpFetch: typeof fetch = fetch;
export function __setGoogleFetch(f: typeof fetch | null): void {
  httpFetch = f ?? fetch;
}

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const CAL = 'https://www.googleapis.com/calendar/v3';
const DRIVE = 'https://www.googleapis.com/drive/v3';
const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';

async function tokenFor(ctx: ToolCtx): Promise<string> {
  const userId = (ctx.session as any).createdBy ?? null;
  if (!userId) throw new ToolError('This session has no signed-in user, so a personal Google account cannot be resolved.');
  const token = await getValidAccessToken(userId);
  if (!token)
    throw new ToolError('No Google account is connected for this user. Ask them to connect it in Settings → Connections → Google, then try again.');
  return token;
}

async function gfetch(token: string, url: string, signal: AbortSignal, init?: RequestInit): Promise<any> {
  const res = await httpFetch(url, {
    ...init,
    signal,
    headers: { Authorization: `Bearer ${token}`, ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON (media downloads use gfetchRaw) */
  }
  if (!res.ok) {
    const msg = json?.error?.message || text.slice(0, 200) || `HTTP ${res.status}`;
    if (res.status === 401) throw new ToolError('Google rejected the token (401) — the connection may have been revoked; reconnect in Settings → Connections.');
    if (res.status === 403) throw new ToolError(`Google denied the request (403): ${msg}. The granted scopes may not cover this action.`);
    throw new ToolError(`Google API error ${res.status}: ${msg}`);
  }
  return json;
}

async function gfetchRaw(token: string, url: string, signal: AbortSignal, capBytes: number): Promise<Buffer> {
  const res = await httpFetch(url, { signal, headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new ToolError(`Google download failed (${res.status}).`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > capBytes) throw new ToolError(`File is ${(buf.length / 1e6).toFixed(1)}MB — over the ${(capBytes / 1e6).toFixed(0)}MB tool limit.`);
  return buf;
}

// ---------------- pure helpers (unit-tested) ----------------

/** Base64url without padding — Gmail's raw-message encoding. */
export function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Build a minimal RFC-822 plain-text message for Gmail send. Pure. */
export function buildRfc822(o: { to: string; subject: string; body: string; cc?: string; inReplyTo?: string; references?: string }): string {
  const lines = [`To: ${o.to}`];
  if (o.cc) lines.push(`Cc: ${o.cc}`);
  // RFC 2047 the subject only when needed (non-ASCII) — keeps plain subjects readable.
  const subject = /[^\x20-\x7e]/.test(o.subject) ? `=?UTF-8?B?${Buffer.from(o.subject).toString('base64')}?=` : o.subject;
  lines.push(`Subject: ${subject}`);
  if (o.inReplyTo) lines.push(`In-Reply-To: ${o.inReplyTo}`);
  if (o.references) lines.push(`References: ${o.references}`);
  lines.push('MIME-Version: 1.0', 'Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: 8bit', '', o.body);
  return lines.join('\r\n');
}

/** Strip an HTML email body to readable text (crude but bounded — email HTML is hostile). Pure. */
export function stripHtmlToText(html: string): string {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Accept a bare spreadsheet id or any docs.google.com/spreadsheets URL. Pure. */
export function extractSpreadsheetId(input: string): string {
  const m = input.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/);
  if (m) return m[1];
  const clean = input.trim();
  if (/^[A-Za-z0-9_-]{20,}$/.test(clean)) return clean;
  throw new ToolError('Not a Google Sheets id or URL. Pass the spreadsheet URL or its id.');
}

/** Sheets values → TSV text (tabs survive commas-in-cells; bounded downstream). Pure. */
export function sheetValuesToTsv(values: unknown[][]): string {
  return (values ?? []).map((row) => (row ?? []).map((c) => String(c ?? '').replace(/\t/g, ' ').replace(/\n/g, ' ')).join('\t')).join('\n');
}

/** Pull the named headers out of a Gmail metadata payload. Pure. */
export function gmailHeaders(payload: any): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of payload?.headers ?? []) out[String(h.name).toLowerCase()] = String(h.value ?? '');
  return out;
}

/** Walk a Gmail payload tree for the best readable body (text/plain, else stripped text/html). Pure. */
export function decodeGmailBody(payload: any): { text: string; attachments: string[] } {
  const attachments: string[] = [];
  let plain = '';
  let html = '';
  const walk = (part: any) => {
    if (!part) return;
    if (part.filename) attachments.push(part.filename);
    const data = part.body?.data;
    if (data) {
      const decoded = Buffer.from(String(data).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
      if (part.mimeType === 'text/plain' && !plain) plain = decoded;
      if (part.mimeType === 'text/html' && !html) html = decoded;
    }
    for (const p of part.parts ?? []) walk(p);
  };
  walk(payload);
  return { text: (plain || stripHtmlToText(html)).slice(0, 20_000), attachments: attachments.filter(Boolean) };
}

const esc = (s: string) => s.replace(/'/g, "\\'");

// ---------------- Gmail ----------------

export const readGmailTool: ToolDef = {
  name: 'read_gmail',
  description:
    "Read the USER'S OWN Gmail (their connected Google account). Without message_id: lists messages matching " +
    'a Gmail search query (e.g. "in:inbox is:unread", "from:acme.com invoice", default in:inbox, newest first) ' +
    'as From/Subject/Date/snippet digests. With message_id: returns that message\'s full text body + attachment ' +
    'names. Read ONLY what the user asked about — never dump a mailbox into a reply.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Gmail search query (same syntax as the Gmail search box). Default "in:inbox".' },
      max_results: { type: 'number', description: 'How many messages to list (1–20, default 10).' },
      message_id: { type: 'string', description: 'A message id from a previous listing — returns the full body.' },
    },
  },
  modes: ['chat', 'code'],
  available: () => googleConfigured(),
  summarize: (a) => (a?.message_id ? `gmail: read message ${a.message_id}` : `gmail: ${a?.query ?? 'in:inbox'}`),
  async run(args, ctx) {
    const token = await tokenFor(ctx);
    if (args?.message_id) {
      const msg = await gfetch(token, `${GMAIL}/messages/${encodeURIComponent(args.message_id)}?format=full`, ctx.signal);
      const h = gmailHeaders(msg.payload);
      const { text, attachments } = decodeGmailBody(msg.payload);
      return [
        `From: ${h.from ?? '?'}`,
        `To: ${h.to ?? '?'}`,
        `Date: ${h.date ?? '?'}`,
        `Subject: ${h.subject ?? '(none)'}`,
        attachments.length ? `Attachments: ${attachments.join(', ')}` : '',
        '',
        text || '(no readable body)',
      ]
        .filter((l, i) => l !== '' || i === 5)
        .join('\n');
    }
    const n = Math.max(1, Math.min(20, Number(args?.max_results) || 10));
    const q = String(args?.query || 'in:inbox');
    const list = await gfetch(token, `${GMAIL}/messages?q=${encodeURIComponent(q)}&maxResults=${n}`, ctx.signal);
    const ids: string[] = (list.messages ?? []).map((m: any) => m.id);
    if (!ids.length) return `No messages match "${q}".`;
    const rows: string[] = [];
    for (const id of ids) {
      const m = await gfetch(
        token,
        `${GMAIL}/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
        ctx.signal,
      );
      const h = gmailHeaders(m.payload);
      rows.push(`- [${id}] ${h.date ?? ''} · ${h.from ?? '?'} · ${h.subject ?? '(no subject)'}\n  ${String(m.snippet ?? '').slice(0, 160)}`);
    }
    return `${rows.length} message(s) for "${q}":\n${rows.join('\n')}\n\nUse message_id to read one in full.`;
  },
};

export const sendGmailTool: ToolDef = {
  name: 'send_gmail',
  description:
    "Send an email FROM THE USER'S OWN Gmail address (their connected Google account) — it will appear in " +
    'their Sent mail, from their identity. Use ONLY when the user explicitly asked to send; CONFIRM the ' +
    'recipient and message with them first (this leaves the workspace as the user themselves). To reply ' +
    'in-thread, pass reply_to_message_id from a read_gmail listing.',
  parameters: {
    type: 'object',
    properties: {
      to: { type: 'string', description: 'Recipient address(es), comma-separated.' },
      subject: { type: 'string', description: 'Subject line.' },
      body: { type: 'string', description: 'Plain-text body.' },
      cc: { type: 'string', description: 'Optional CC address(es).' },
      reply_to_message_id: { type: 'string', description: 'Optional Gmail message id to reply to (keeps the thread).' },
    },
    required: ['to', 'subject', 'body'],
  },
  modes: ['chat', 'code'],
  available: () => googleConfigured(),
  summarize: (a) => `gmail send → ${a?.to ?? '?'}: ${a?.subject ?? ''}`,
  async run(args, ctx) {
    const token = await tokenFor(ctx);
    let threadId: string | undefined;
    let inReplyTo: string | undefined;
    let subject = String(args.subject);
    if (args.reply_to_message_id) {
      const orig = await gfetch(
        token,
        `${GMAIL}/messages/${encodeURIComponent(args.reply_to_message_id)}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=Subject`,
        ctx.signal,
      );
      threadId = orig.threadId;
      const h = gmailHeaders(orig.payload);
      inReplyTo = h['message-id'];
      if (!/^re:/i.test(subject) && h.subject) subject = `Re: ${h.subject}`;
    }
    const raw = b64url(buildRfc822({ to: String(args.to), cc: args.cc ? String(args.cc) : undefined, subject, body: String(args.body), inReplyTo, references: inReplyTo }));
    const sent = await gfetch(token, `${GMAIL}/messages/send`, ctx.signal, {
      method: 'POST',
      body: JSON.stringify(threadId ? { raw, threadId } : { raw }),
    });
    return `Sent from the user's Gmail to ${args.to} (message id ${sent.id}${threadId ? ', in-thread' : ''}).`;
  },
};

// ---------------- Calendar ----------------

export const readCalendarTool: ToolDef = {
  name: 'read_calendar',
  description:
    "List events from the USER'S OWN Google Calendar (primary calendar of their connected account). " +
    'Defaults to the next 14 days; pass ISO time_min/time_max to change the window, or a query to search titles.',
  parameters: {
    type: 'object',
    properties: {
      time_min: { type: 'string', description: 'ISO start of the window (default: now).' },
      time_max: { type: 'string', description: 'ISO end of the window (default: +14 days).' },
      query: { type: 'string', description: 'Optional free-text search over event fields.' },
      max_results: { type: 'number', description: 'Max events (1–50, default 20).' },
    },
  },
  modes: ['chat', 'code'],
  available: () => googleConfigured(),
  summarize: (a) => `calendar: ${a?.query ?? a?.time_min ?? 'next 14 days'}`,
  async run(args, ctx) {
    const token = await tokenFor(ctx);
    const min = args?.time_min ? new Date(args.time_min) : new Date();
    const max = args?.time_max ? new Date(args.time_max) : new Date(min.getTime() + 14 * 86_400_000);
    if (Number.isNaN(min.getTime()) || Number.isNaN(max.getTime())) throw new ToolError('time_min/time_max must be ISO dates.');
    const n = Math.max(1, Math.min(50, Number(args?.max_results) || 20));
    const p = new URLSearchParams({
      timeMin: min.toISOString(),
      timeMax: max.toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: String(n),
    });
    if (args?.query) p.set('q', String(args.query));
    const data = await gfetch(token, `${CAL}/calendars/primary/events?${p}`, ctx.signal);
    const items: any[] = data.items ?? [];
    if (!items.length) return `No events between ${min.toISOString().slice(0, 10)} and ${max.toISOString().slice(0, 10)}.`;
    const lines = items.map((e) => {
      const start = e.start?.dateTime ?? e.start?.date ?? '?';
      const end = e.end?.dateTime ?? e.end?.date ?? '';
      const who = (e.attendees ?? []).length ? ` · ${(e.attendees ?? []).length} attendee(s)` : '';
      return `- ${start}${end ? ` → ${end}` : ''} · ${e.summary ?? '(no title)'}${e.location ? ` @ ${e.location}` : ''}${who} [${e.id}]`;
    });
    return `${items.length} event(s):\n${lines.join('\n')}`;
  },
};

export const createCalendarEventTool: ToolDef = {
  name: 'create_calendar_event',
  description:
    "Create an event on the USER'S OWN Google Calendar. Times are ISO datetimes WITH a UTC offset " +
    '(e.g. 2026-07-08T15:00:00+04:00) or bare YYYY-MM-DD for an all-day event. Adding attendees emails ' +
    'them invitations — do that ONLY when the user explicitly asked to invite people, and confirm first.',
  parameters: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: 'Event title.' },
      start: { type: 'string', description: 'Start — ISO datetime with offset, or YYYY-MM-DD for all-day.' },
      end: { type: 'string', description: 'End — same format as start.' },
      description: { type: 'string', description: 'Optional details/agenda.' },
      location: { type: 'string', description: 'Optional location.' },
      attendees: { type: 'array', items: { type: 'string' }, description: 'Optional attendee emails — sends real invitations.' },
    },
    required: ['summary', 'start', 'end'],
  },
  modes: ['chat', 'code'],
  available: () => googleConfigured(),
  summarize: (a) => `calendar event: ${a?.summary ?? '?'} @ ${a?.start ?? '?'}`,
  async run(args, ctx) {
    const token = await tokenFor(ctx);
    const allDay = /^\d{4}-\d{2}-\d{2}$/.test(String(args.start));
    const when = (v: string) => (allDay ? { date: v } : { dateTime: v });
    if (!allDay && !/[+-]\d{2}:\d{2}|Z$/.test(String(args.start)))
      throw new ToolError('Datetimes need a UTC offset (e.g. 2026-07-08T15:00:00+04:00) so the event lands in the right timezone.');
    const attendees = Array.isArray(args.attendees) ? args.attendees.filter(Boolean).map((e: string) => ({ email: String(e) })) : [];
    const body: any = { summary: String(args.summary), start: when(String(args.start)), end: when(String(args.end)) };
    if (args.description) body.description = String(args.description);
    if (args.location) body.location = String(args.location);
    if (attendees.length) body.attendees = attendees;
    const sendUpdates = attendees.length ? 'all' : 'none';
    const ev = await gfetch(token, `${CAL}/calendars/primary/events?sendUpdates=${sendUpdates}`, ctx.signal, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return `Event created: "${ev.summary}" ${ev.start?.dateTime ?? ev.start?.date} → ${ev.end?.dateTime ?? ev.end?.date}${
      attendees.length ? ` — invitations sent to ${attendees.length} attendee(s)` : ''
    }. Link: ${ev.htmlLink ?? '(none)'}`;
  },
};

// ---------------- Drive + Sheets ----------------

export const searchDriveTool: ToolDef = {
  name: 'search_drive',
  description:
    "Search the USER'S OWN Google Drive (their connected account) by name/content. Returns file name, type, " +
    'modified date and id — pass an id to read_drive_file (documents) or read_gsheet (spreadsheets).',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'What to find — matched against file names and full text.' },
      max_results: { type: 'number', description: 'Max files (1–25, default 10).' },
    },
    required: ['query'],
  },
  modes: ['chat', 'code'],
  available: () => googleConfigured(),
  summarize: (a) => `drive search: ${a?.query ?? ''}`,
  async run(args, ctx) {
    const token = await tokenFor(ctx);
    const n = Math.max(1, Math.min(25, Number(args?.max_results) || 10));
    const q = `(name contains '${esc(String(args.query))}' or fullText contains '${esc(String(args.query))}') and trashed = false`;
    const p = new URLSearchParams({
      q,
      pageSize: String(n),
      fields: 'files(id,name,mimeType,modifiedTime,size)',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    });
    const data = await gfetch(token, `${DRIVE}/files?${p}`, ctx.signal);
    const files: any[] = data.files ?? [];
    if (!files.length) return `No Drive files match "${args.query}".`;
    const kind = (m: string) =>
      m === 'application/vnd.google-apps.document' ? 'Doc' :
      m === 'application/vnd.google-apps.spreadsheet' ? 'Sheet' :
      m === 'application/vnd.google-apps.presentation' ? 'Slides' :
      m === 'application/vnd.google-apps.folder' ? 'Folder' : m.split('/').pop() ?? m;
    return `${files.length} file(s):\n${files
      .map((f) => `- [${f.id}] ${f.name} · ${kind(f.mimeType)} · modified ${String(f.modifiedTime ?? '').slice(0, 10)}`)
      .join('\n')}`;
  },
};

const GOOGLE_EXPORT: Record<string, { mime: string; ext: string }> = {
  'application/vnd.google-apps.document': { mime: 'text/plain', ext: '.txt' },
  'application/vnd.google-apps.presentation': { mime: 'text/plain', ext: '.txt' },
  'application/vnd.google-apps.spreadsheet': { mime: 'text/csv', ext: '.csv' },
};

export const readDriveFileTool: ToolDef = {
  name: 'read_drive_file',
  description:
    "Read a file from the USER'S OWN Google Drive by id (from search_drive). Google Docs/Slides export as text, " +
    'Sheets as CSV (prefer read_gsheet for multi-tab ranges); PDFs/Office files download into the workspace ' +
    "drive/ folder and return extracted text; plain text returns directly. 15MB cap.",
  parameters: {
    type: 'object',
    properties: { file_id: { type: 'string', description: 'The Drive file id.' } },
    required: ['file_id'],
  },
  modes: ['chat', 'code'],
  available: () => googleConfigured(),
  summarize: (a) => `drive read: ${a?.file_id ?? '?'}`,
  async run(args, ctx) {
    const token = await tokenFor(ctx);
    const id = encodeURIComponent(String(args.file_id));
    const meta = await gfetch(token, `${DRIVE}/files/${id}?fields=id,name,mimeType,size&supportsAllDrives=true`, ctx.signal);
    const exp = GOOGLE_EXPORT[meta.mimeType];
    if (exp) {
      const buf = await gfetchRaw(token, `${DRIVE}/files/${id}/export?mimeType=${encodeURIComponent(exp.mime)}`, ctx.signal, 15e6);
      return `"${meta.name}" (${meta.mimeType} → ${exp.mime}):\n\n${buf.toString('utf8').slice(0, 20_000)}`;
    }
    const buf = await gfetchRaw(token, `${DRIVE}/files/${id}?alt=media&supportsAllDrives=true`, ctx.signal, 15e6);
    if (/^(text\/|application\/(json|csv|xml))/.test(String(meta.mimeType))) {
      return `"${meta.name}" (${meta.mimeType}):\n\n${buf.toString('utf8').slice(0, 20_000)}`;
    }
    // Binary (pdf/docx/xlsx/…): land it in the workspace so builds can use it, extract text when possible.
    const safe = String(meta.name ?? meta.id).replace(/[^\w.\- ]+/g, '_');
    const dest = resolveInWorkspace(ctx.repoDir, path.join('drive', safe));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
    const text = await extractText(dest).catch(() => null);
    return `"${meta.name}" saved to drive/${safe} (${(buf.length / 1024).toFixed(0)}KB).${text ? `\n\nExtracted text:\n${text.slice(0, 20_000)}` : ' (binary — no text extracted)'}`;
  },
};

export const readGsheetTool: ToolDef = {
  name: 'read_gsheet',
  description:
    "Read values from the USER'S OWN private Google Sheet (their connected account) — the tool for sheets that " +
    'fetch_data cannot reach because they are not published. Pass the spreadsheet URL or id; optionally an A1 ' +
    "range like 'Budget!A1:F50' (default: the first tab). Returns tab names + the values as TSV.",
  parameters: {
    type: 'object',
    properties: {
      spreadsheet: { type: 'string', description: 'Spreadsheet URL or id.' },
      range: { type: 'string', description: "Optional A1 range, e.g. 'Sheet1!A1:D100'." },
    },
    required: ['spreadsheet'],
  },
  modes: ['chat', 'code'],
  available: () => googleConfigured(),
  summarize: (a) => `gsheet: ${a?.range ?? 'first tab'}`,
  async run(args, ctx) {
    const token = await tokenFor(ctx);
    const id = extractSpreadsheetId(String(args.spreadsheet));
    const meta = await gfetch(token, `${SHEETS}/${id}?fields=properties.title,sheets.properties.title`, ctx.signal);
    const tabs: string[] = (meta.sheets ?? []).map((s: any) => s.properties?.title).filter(Boolean);
    const range = args?.range ? String(args.range) : `'${(tabs[0] ?? 'Sheet1').replace(/'/g, "''")}'`;
    const data = await gfetch(token, `${SHEETS}/${id}/values/${encodeURIComponent(range)}`, ctx.signal);
    const tsv = sheetValuesToTsv(data.values ?? []);
    if (!tsv) return `"${meta.properties?.title}" — range ${range} is empty. Tabs: ${tabs.join(', ')}.`;
    return `"${meta.properties?.title}" · tabs: ${tabs.join(', ')}\nRange ${data.range ?? range}:\n\n${tsv.slice(0, 18_000)}`;
  },
};

export const GOOGLE_WORKSPACE_TOOLS: ToolDef[] = [
  readGmailTool,
  sendGmailTool,
  readCalendarTool,
  createCalendarEventTool,
  searchDriveTool,
  readDriveFileTool,
  readGsheetTool,
];
