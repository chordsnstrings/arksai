import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Throwaway SQLite DB + a fixed encryption key, set BEFORE any config read — app modules
// are dynamically imported in before() because static imports hoist above these lines.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-gws-'));
process.env.ENCRYPTION_KEY = 'test-gws-encryption-key';
delete process.env.DATABASE_URL;

let db: typeof import('../src/db');
let store: typeof import('../src/googleConnect/store');
let gws: typeof import('../src/agent/tools/googleWorkspace');
let registry: typeof import('../src/agent/tools/index');

before(async () => {
  db = await import('../src/db');
  store = await import('../src/googleConnect/store');
  gws = await import('../src/agent/tools/googleWorkspace');
  registry = await import('../src/agent/tools/index');
  await db.initDb();
});
after(() => {
  gws.__setGoogleFetch(null);
});

// ---------------- pure helpers ----------------

test('rfc822 builder: headers, utf-8 subject encoding, reply threading fields', () => {
  const plain = gws.buildRfc822({ to: 'a@b.com', subject: 'Hello there', body: 'Hi.' });
  assert.match(plain, /^To: a@b\.com\r\n/);
  assert.match(plain, /Subject: Hello there\r\n/);
  assert.match(plain, /Content-Type: text\/plain; charset="UTF-8"/);
  assert.ok(plain.endsWith('\r\n\r\nHi.'));

  const utf = gws.buildRfc822({ to: 'a@b.com', subject: 'مرحبا Kamran', body: 'x', cc: 'c@d.com', inReplyTo: '<m1@x>', references: '<m1@x>' });
  assert.match(utf, /Subject: =\?UTF-8\?B\?/, 'non-ASCII subject is RFC-2047 encoded');
  assert.match(utf, /Cc: c@d\.com/);
  assert.match(utf, /In-Reply-To: <m1@x>/);

  // Gmail's raw format: base64url, no padding, url-safe alphabet.
  const raw = gws.b64url(plain);
  assert.ok(!raw.includes('+') && !raw.includes('/') && !raw.includes('='));
});

test('gmail body decode: nested parts, base64url, html fallback, attachment names', () => {
  const enc = (s: string) => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
  const payload = {
    mimeType: 'multipart/mixed',
    headers: [
      { name: 'From', value: 'Ann <ann@x.com>' },
      { name: 'Subject', value: 'Q3 numbers' },
    ],
    parts: [
      { mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/plain', body: { data: enc('The plain body.') } }] },
      { mimeType: 'application/pdf', filename: 'q3.pdf', body: { attachmentId: 'x' } },
    ],
  };
  const h = gws.gmailHeaders(payload);
  assert.equal(h.from, 'Ann <ann@x.com>');
  const { text, attachments } = gws.decodeGmailBody(payload);
  assert.equal(text, 'The plain body.');
  assert.deepEqual(attachments, ['q3.pdf']);

  // HTML-only message falls back to stripped text.
  const htmlOnly = { mimeType: 'text/html', body: { data: enc('<div><p>Hello <b>world</b></p><style>.x{}</style></div>') } };
  assert.equal(gws.decodeGmailBody(htmlOnly).text, 'Hello world');
  assert.equal(gws.stripHtmlToText('a &amp; b&nbsp;<br>c'), 'a & b \nc');
});

test('spreadsheet id extraction + TSV rendering', () => {
  const id = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345678901234';
  assert.equal(gws.extractSpreadsheetId(`https://docs.google.com/spreadsheets/d/${id}/edit#gid=0`), id);
  assert.equal(gws.extractSpreadsheetId(id), id);
  assert.throws(() => gws.extractSpreadsheetId('not a sheet'), /Sheets id or URL/);

  assert.equal(
    gws.sheetValuesToTsv([
      ['Item', 'Cost'],
      ['Beans, dark', 42],
      [null, 'x\ty'],
    ]),
    'Item\tCost\nBeans, dark\t42\n\tx y',
  );
});

// ---------------- registry ----------------

test('all 7 workspace tools registered chat+code; read tools are report-eligible', () => {
  const names = gws.GOOGLE_WORKSPACE_TOOLS.map((t) => t.name);
  assert.deepEqual(names, ['read_gmail', 'send_gmail', 'read_calendar', 'create_calendar_event', 'search_drive', 'read_drive_file', 'read_gsheet']);
  for (const t of gws.GOOGLE_WORKSPACE_TOOLS) {
    assert.ok(registry.ALL_TOOLS.includes(t), `${t.name} in ALL_TOOLS`);
    assert.deepEqual(t.modes, ['chat', 'code'], `${t.name} modes`);
    assert.equal(typeof t.available, 'function', `${t.name} gated on googleConfigured`);
  }
  // The REPORT set is private — lock it via the source (a report can read private data, never send).
  const src = fs.readFileSync(path.join(__dirname, '../src/agent/tools/index.ts'), 'utf8');
  const report = src.slice(src.indexOf('REPORT_TOOLS'), src.indexOf('])', src.indexOf('REPORT_TOOLS')));
  for (const n of ['read_gmail', 'read_calendar', 'search_drive', 'read_drive_file', 'read_gsheet']) assert.ok(report.includes(`'${n}'`), `${n} report-eligible`);
  assert.ok(!report.includes("'send_gmail'"), 'send_gmail NOT in report mode');
  assert.ok(!report.includes("'create_calendar_event'"), 'create_calendar_event NOT in report mode');
});

// ---------------- mocked round-trip through the real token store ----------------

test('read_gmail: honest error unconnected, then lists via the stored token', async () => {
  const ctx: any = {
    session: { id: 's1', createdBy: 'user-g1', orgId: null },
    repoDir: process.env.DATA_DIR,
    mode: 'chat',
    signal: new AbortController().signal,
    addCost: () => {},
  };

  // No connection yet → the honest connect message, not a crash.
  await assert.rejects(() => gws.readGmailTool.run({ query: 'in:inbox' }, ctx), /connect it in Settings/);

  await store.saveConnection('user-g1', null, 'op@x.com', { accessToken: 'tok-live', refreshToken: 'r1', expiresAt: Date.now() + 3600_000 });

  const calls: string[] = [];
  gws.__setGoogleFetch((async (url: any, init?: any) => {
    calls.push(String(url));
    assert.equal(init?.headers?.Authorization, 'Bearer tok-live', 'stored token used');
    if (String(url).includes('/messages?')) {
      return new Response(JSON.stringify({ messages: [{ id: 'm1' }] }), { status: 200 });
    }
    return new Response(
      JSON.stringify({
        id: 'm1',
        snippet: 'Invoice attached…',
        payload: { headers: [{ name: 'From', value: 'billing@acme.com' }, { name: 'Subject', value: 'Invoice #42' }, { name: 'Date', value: 'Mon, 6 Jul 2026' }] },
      }),
      { status: 200 },
    );
  }) as any);

  const out = await gws.readGmailTool.run({ query: 'from:acme.com', max_results: 5 }, ctx);
  assert.match(out, /\[m1\].*billing@acme\.com.*Invoice #42/);
  assert.match(out, /Invoice attached/);
  assert.ok(calls[0].includes('q=from%3Aacme.com'), 'gmail query passed through');
});
