import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Throwaway SQLite DB + crypto key, set BEFORE any import (the robotsV2 pattern).
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-robotools-'));
process.env.ENCRYPTION_KEY = 'test-key-robotools';
process.env.APP_PASSWORD = 'test-operator';
delete process.env.DATABASE_URL;
delete process.env.MINIMAX_API_KEY;
delete process.env.DEEPSEEK_API_KEY;

let db: typeof import('../src/db');
let store: typeof import('../src/robots/store');
let tools: typeof import('../src/robots/tools');
let tasks: typeof import('../src/robots/tasks');
let orgId = '';

before(async () => {
  db = await import('../src/db');
  await db.initDb();
  const orgs = await import('../src/orgs/store');
  const org = await orgs.createOrg('ToolsCo', 'toolsco');
  orgId = org.id;
  store = await import('../src/robots/store');
  tools = await import('../src/robots/tools');
  tasks = await import('../src/robots/tasks');
});

// ---------------- classifier: the FULL production surface reaches the build lane ----------------

test('BUILD_HINT_RE covers media production asks (video/creative/image/logo/music)', () => {
  for (const ask of [
    'make me a 30 second explainer video about our onboarding',
    'create an ad creative for the summer sale',
    'generate an image of our product on a beach',
    'design a logo for my cafe',
    'make a jingle for the radio spot',
    'produce an animated short about recycling',
    'make an infographic from these numbers',
  ])
    assert.ok(tasks.BUILD_HINT_RE.test(ask), `build hint matches: ${ask}`);
  assert.ok(!tasks.BUILD_HINT_RE.test('what time is my meeting tomorrow?'), 'chit-chat still no match');
});

// ---------------- pure converters ----------------

test('csvToRows: headers + typed rows; rejects headerless input', () => {
  const { headers, rows } = tools.csvToRows('Month,Revenue\nJan,1200\nFeb,1,450'.replace('1,450', '"1,450"'));
  assert.deepEqual(headers, ['Month', 'Revenue']);
  assert.equal(rows[0].Month, 'Jan');
  assert.equal(rows[0].Revenue, 1200, 'numeric strings become numbers');
  assert.throws(() => tools.csvToRows('just-one-line'), /header row/);
});

test('mdToBlocks: headings, bullets, numbered, quotes, paragraphs', () => {
  const blocks = tools.mdToBlocks(
    '# Title\n\nFirst paragraph line one\ncontinues here.\n\n## Section\n- one\n- two\n\n1. first\n2. second\n\n> a quote',
  );
  const kinds = blocks.map((b: any) => b.kind);
  assert.deepEqual(kinds, ['heading', 'paragraph', 'subheading', 'bullets', 'numbered', 'quote']);
  assert.equal((blocks[1] as any).text, 'First paragraph line one continues here.');
  assert.deepEqual((blocks[3] as any).items, ['one', 'two']);
});

// ---------------- adapters ----------------

test('studio adapters map flat params onto real tool args (and validate)', () => {
  const chart = tools.STUDIO_TOOLS.find((s) => s.name === 'make_chart')!;
  const args: any = chart.build({ chart_type: 'bar', title: 'Q3 Sales', csv: 'Region,Sales\nEast,10\nWest,14' });
  assert.equal(args.type, 'bar');
  assert.equal(args.x, 'Region');
  assert.equal(args.y, 'Sales');
  assert.equal(args.data.length, 2);
  assert.throws(() => chart.build({ chart_type: 'sparkle', csv: 'a,b\n1,2' }), /unknown chart_type/);

  const sheet = tools.STUDIO_TOOLS.find((s) => s.name === 'make_spreadsheet')!;
  const sArgs: any = sheet.build({ title: 'Pipeline', csv: 'Deal,Value\nAcme,5000' });
  assert.equal(sArgs.sheets[0].columns[0].header, 'Deal');
  assert.equal(sArgs.sheets[0].rows[0].Value, 5000);
  assert.match(sArgs.output, /^pipeline\.xlsx$/);

  const img = tools.STUDIO_TOOLS.find((s) => s.name === 'make_image')!;
  assert.deepEqual(img.build({ description: 'a red bicycle' }), { prompt: 'a red bicycle' });

  // Every adapter's underlying tool exists in the agent registry.
  const { ALL_TOOLS } = require('../src/agent/tools');
  for (const s of tools.STUDIO_TOOLS) {
    assert.ok(ALL_TOOLS.some((t: any) => t.name === s.tool), `${s.name} wraps a real tool (${s.tool})`);
    for (const r of s.required) assert.ok(s.params.some((p) => p.name === r), `${s.name} required "${r}" is a declared param`);
  }
});

test('replyTools gating: commanders-only matches the owner, fail-closed on others', async () => {
  const robot = await store.createRobot(orgId, {
    name: 'Toolsy',
    role: 'custom',
    autonomy: 'auto',
    model: 'arksai-max',
    config: {},
  } as any);
  assert.equal(tools.replyToolsMode(robot), 'commanders', 'default policy');
  // Owner-specific: tools go only to the registered owner. A stranger never gets them.
  assert.equal(await tools.senderMayUseTools(robot, 'stranger@example.com'), false, 'unknown sender blocked');

  await db.q(
    `INSERT INTO robot_commanders(id, robot_id, org_id, channel, address, label, notify, created_at)
     VALUES ('rc1', $1, $2, 'email', 'Owner@Example.com', NULL, 1, $3)`,
    [robot.id, orgId, Date.now()],
  );
  assert.equal(await tools.senderMayUseTools(robot, 'owner@example.com'), true, 'commander matches case-insensitively');
  assert.equal(await tools.senderMayUseTools(robot, 'stranger@example.com'), false, 'strangers stay blocked');

  const off = { ...robot, config: { replyTools: 'off' } } as any;
  assert.equal(await tools.senderMayUseTools(off, 'owner@example.com'), false, 'off blocks even commanders');
  const everyone = { ...robot, config: { replyTools: 'everyone' } } as any;
  assert.equal(await tools.senderMayUseTools(everyone, 'stranger@example.com'), true, 'everyone opens it up');
});

// ---------------- real execution: make_document produces a real .docx in the studio ----------------

test('runStudioTool: make_document produces a real docx in the robot studio (e2e, offline)', async () => {
  const robot = await store.createRobot(orgId, {
    name: 'Docsy',
    role: 'custom',
    autonomy: 'auto',
    model: 'arksai-max',
    config: {},
  } as any);
  const ac = new AbortController();
  const res = await tools.runStudioTool(
    robot,
    'make_document',
    { title: 'Team Offsite Brief', content_markdown: '# Agenda\n\nWe meet at nine.\n\n- Coffee\n- Planning' },
    ac.signal,
  );
  assert.equal(res.ok, true, `tool ran: ${res.summary}`);
  assert.ok(res.files.some((f) => f.endsWith('.docx')), 'a .docx landed');
  const abs = res.files.find((f) => f.endsWith('.docx'))!;
  assert.ok(abs.includes(path.join('robots', robot.id, 'studio')), 'file lives in the robot studio under data/');
  assert.ok(fs.statSync(abs).size > 1000, 'non-trivial file');
  // Unknown tool + missing params fail soft with a usable message.
  assert.equal((await tools.runStudioTool(robot, 'nope', {}, ac.signal)).ok, false);
  const missing = await tools.runStudioTool(robot, 'make_document', { title: 'x' }, ac.signal);
  assert.match(missing.summary, /content_markdown/);
});

// ---------------- attachments round-trip + chat toolset registration ----------------

test('draft attachments persist and round-trip through the store', async () => {
  const robot = await store.createRobot(orgId, {
    name: 'Attachy',
    role: 'custom',
    autonomy: 'ask',
    model: 'arksai-max',
    config: {},
  } as any);
  const d = await store.createDraft({
    robotId: robot.id,
    orgId,
    inboundMessageId: 'm-att-1',
    inboundFrom: 'owner@example.com',
    inboundName: null,
    inboundSubject: null,
    inboundSnippet: 'make me a doc',
    toAddr: 'owner@example.com',
    subject: '',
    draftText: 'Here you go.',
    modelUsed: 'test',
    channel: 'telegram',
    attachments: ['/tmp/data/robots/x/studio/brief.docx'],
  });
  assert.deepEqual(d.attachments, ['/tmp/data/robots/x/studio/brief.docx']);
  const fetched = await store.getDraft(d.id);
  assert.deepEqual(fetched?.attachments, ['/tmp/data/robots/x/studio/brief.docx']);
});

test('chat mode carries the deliverable generators (operator: "add tools into the chat space")', async () => {
  const { getToolsForMode } = await import('../src/agent/tools');
  const names = getToolsForMode('chat').schemas.map((s: any) => s.function.name);
  for (const t of ['generate_doc', 'generate_spreadsheet', 'generate_pptx', 'render_chart', 'convert_document'])
    assert.ok(names.includes(t), `chat toolset includes ${t}`);
});
