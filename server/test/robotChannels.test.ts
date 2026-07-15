import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Throwaway SQLite DB + crypto key, set BEFORE any import.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-robochan-'));
process.env.ENCRYPTION_KEY = 'test-key-channels';
process.env.APP_PASSWORD = 'test-operator';
delete process.env.DATABASE_URL;
delete process.env.MINIMAX_API_KEY;
delete process.env.DEEPSEEK_API_KEY;

let db: typeof import('../src/db');
let store: typeof import('../src/robots/store');
let chStore: typeof import('../src/robots/channels/store');
let telegram: typeof import('../src/robots/channels/telegram');
let inbound: typeof import('../src/robots/channels/inbound');
let personas: typeof import('../src/robots/personas');
let tasks: typeof import('../src/robots/tasks');
let reply: typeof import('../src/robots/reply');
let app: any;

before(async () => {
  db = await import('../src/db');
  await db.initDb();
  const orgs = await import('../src/orgs/store');
  await orgs.bootstrapOrgs();
  store = await import('../src/robots/store');
  chStore = await import('../src/robots/channels/store');
  telegram = await import('../src/robots/channels/telegram');
  inbound = await import('../src/robots/channels/inbound');
  personas = await import('../src/robots/personas');
  tasks = await import('../src/robots/tasks');
  reply = await import('../src/robots/reply');
  const appMod = await import('../src/app');
  app = await appMod.buildApp();
});

after(async () => {
  await app?.close?.();
});

// ---- channel store ----

test('channel store: secrets encrypted at rest, write-only, merge-on-update', async () => {
  const r = await store.createRobot('o-ch', { name: 'TG', role: 'custom' });
  const c = await chStore.upsertChannel(r.id, 'o-ch', 'telegram', {
    label: 'My bot',
    secrets: { botToken: '12345:SECRET-TOKEN' },
    meta: { botUsername: 'mybot' },
  });
  assert.equal(c.hasSecrets, true);
  assert.equal(c.meta.botUsername, 'mybot');
  assert.equal((c as any).secrets, undefined); // never serialized outward

  // Encrypted at rest: the raw row must NOT contain the plaintext token.
  const raw = await db.qOne<any>('SELECT secrets FROM robot_channels WHERE robot_id = $1', [r.id]);
  assert.ok(raw?.secrets);
  assert.ok(!String(raw.secrets).includes('SECRET-TOKEN'));

  // Server-side decrypt round-trips.
  const secrets = await chStore.channelSecrets(r.id, 'telegram');
  assert.equal(secrets.botToken, '12345:SECRET-TOKEN');

  // Update WITHOUT re-sending the secret keeps it (write-only semantics).
  await chStore.upsertChannel(r.id, 'o-ch', 'telegram', { label: 'Renamed', secrets: { botToken: '' } });
  const kept = await chStore.channelSecrets(r.id, 'telegram');
  assert.equal(kept.botToken, '12345:SECRET-TOKEN');

  // State round-trip (the getUpdates offset).
  await chStore.setChannelState(r.id, 'telegram', { offset: 42 });
  assert.equal((await chStore.getChannelState(r.id, 'telegram')).offset, 42);

  await chStore.deleteChannel(r.id, 'o-ch', 'telegram');
  assert.equal(await chStore.getChannel(r.id, 'telegram'), null);
});

// ---- telegram adapter (mocked fetch) ----

function tgFetchMock(handlers: Record<string, (body: any) => any>): typeof fetch {
  return (async (url: any, init?: any) => {
    const method = String(url).split('/').pop()!;
    const body = init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : init?.body;
    const h = handlers[method];
    if (!h) return { ok: false, status: 404, json: async () => ({ ok: false, description: `no mock for ${method}` }) } as any;
    return { ok: true, status: 200, json: async () => ({ ok: true, result: h(body) }) } as any;
  }) as typeof fetch;
}

test('telegram: verify + long-poll inbound (offset advances, bots/non-text skipped) + send splits', async () => {
  const r = await store.createRobot('o-tg', { name: 'TG2', role: 'custom' });
  await chStore.upsertChannel(r.id, 'o-tg', 'telegram', { secrets: { botToken: 't0k' } });
  const ch = (await chStore.withSecrets(r.id, 'telegram'))!;

  const sent: any[] = [];
  telegram.__setTelegramFetch(
    tgFetchMock({
      getMe: () => ({ username: 'arks_bot' }),
      getUpdates: () => [
        { update_id: 7, message: { message_id: 1, from: { id: 9, first_name: 'Kam' }, chat: { id: 9, type: 'private' }, date: 1751600000, text: 'hello' } },
        { update_id: 8, message: { message_id: 2, from: { id: 5, is_bot: true }, chat: { id: 5 }, date: 1751600001, text: 'bot noise' } },
        { update_id: 9, message: { message_id: 3, from: { id: 9 }, chat: { id: 9 }, date: 1751600002 } }, // no text
      ],
      sendMessage: (b: any) => (sent.push(b), { message_id: 100 }),
    }),
  );

  const v = await telegram.telegramAdapter.verify(ch);
  assert.equal(v.ok, true);
  assert.match(v.detail, /@arks_bot/);

  const msgs = await telegram.telegramAdapter.fetchInbound!(ch);
  assert.equal(msgs.length, 1); // bot + textless updates skipped
  assert.equal(msgs[0].from, '9');
  assert.equal(msgs[0].fromName, 'Kam');
  assert.equal(msgs[0].id, 'tg-9-1');
  // Offset advanced past ALL updates (nothing replays).
  assert.equal((await chStore.getChannelState(r.id, 'telegram')).offset, 10);

  // Long text splits at the 4096 cap.
  await telegram.telegramAdapter.send(ch, '9', 'a'.repeat(5000));
  assert.equal(sent.length, 2);
  assert.ok(sent[0].text.length <= 4096);
});

// ---- the channel-agnostic inbound handler ----

test('handleChannelInbound: dedupe by message id, recipient locked, no-model → escalated draft', async () => {
  const r = await store.createRobot('o-in', { name: 'IN', role: 'customer_service' });
  await store.updateRobot(r.id, 'o-in', { status: 'active' });
  await chStore.upsertChannel(r.id, 'o-in', 'telegram', { secrets: { botToken: 'x' } });
  const ch = (await chStore.withSecrets(r.id, 'telegram'))!;
  const robot = (await store.getRobot(r.id, 'o-in'))!;

  const msg = { id: 'tg-9-55', from: '9', fromName: 'Kam', text: 'What are your prices?', ts: Date.now() };
  const s1 = await inbound.handleChannelInbound(robot, ch, msg);
  assert.equal(s1.drafted, 1);
  assert.equal(s1.escalated, 1); // no model keys in tests → honest escalation, never a guess

  const drafts = await store.listDrafts('o-in', r.id);
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].channel, 'telegram');
  assert.equal(drafts[0].toAddr, '9'); // LOCKED to the inbound chat id
  assert.equal(drafts[0].status, 'escalated');

  // Same message id again → skipped, never double-drafted.
  const s2 = await inbound.handleChannelInbound(robot, ch, msg);
  assert.equal(s2.drafted, 0);
  assert.equal(s2.skipped, 1);
});

// ---- reply engine: channel style + persona + KB ----

test('buildSystem: chat channels get the style note and NEVER an email signature', () => {
  const robot: any = {
    id: 'x', orgId: 'o', name: 'CS', role: 'customer_service', status: 'active', autonomy: 'ask',
    model: 'arksai-max', lastPolledAt: null, createdAt: 0, updatedAt: 0,
    config: { signature: '— Acme Corp' },
  };
  const email = reply.buildSystem(robot);
  assert.match(email, /— Acme Corp/);
  const tg = reply.buildSystem(robot, undefined, { channel: 'telegram' });
  assert.match(tg, /Telegram chat/);
  assert.doesNotMatch(tg, /— Acme Corp/);
  const sms = reply.buildSystem(robot, undefined, { channel: 'sms' });
  assert.match(sms, /~450 characters/);
});

test('buildSystem: resolved persona voice + KB snippets fold in (free-text persona wins)', () => {
  const robot: any = {
    id: 'x', orgId: 'o', name: 'CS', role: 'custom', status: 'active', autonomy: 'ask',
    model: 'arksai-max', lastPolledAt: null, createdAt: 0, updatedAt: 0, config: {},
  };
  const sys = reply.buildSystem(robot, undefined, {
    personaVoice: 'Speak like a friendly barista.',
    knowledgeSnippets: ['(menu.txt) Flat white AED 18', '(hours.txt) Open 7am-11pm'],
  });
  assert.match(sys, /friendly barista/);
  assert.match(sys, /Flat white AED 18/);
  assert.match(sys, /KNOWLEDGE BASE EXCERPTS/);
  // Free-text config.persona beats the resolved persona.
  const sys2 = reply.buildSystem({ ...robot, config: { persona: 'Formal counsel.' } }, undefined, {
    personaVoice: 'Casual.',
  });
  assert.match(sys2, /Formal counsel/);
  assert.doesNotMatch(sys2, /PERSONA \/ TONE:\nCasual/);
});

// ---- personas + knowledge base ----

test('personas: CRUD + replyExtrasFor resolves voice/language/signature', async () => {
  const p = await personas.createPersona('o-p', {
    name: 'Concierge',
    voice: 'Warm, brief, five-star hotel tone.',
    language: 'Arabic',
    signature: 'فريق الخدمة',
  });
  assert.equal((await personas.listPersonas('o-p')).length, 1);
  assert.equal(await personas.getPersona(p.id, 'other-org'), null); // cross-org denied

  const r = await store.createRobot('o-p', { name: 'C', role: 'custom', config: { personaId: p.id } });
  const extras = await personas.replyExtrasFor((await store.getRobot(r.id, 'o-p'))!, 'o-p', 'hello');
  assert.match(extras.personaVoice || '', /five-star hotel/);
  assert.match(extras.personaVoice || '', /Always respond in Arabic/);
  assert.equal(extras.personaSignature, 'فريق الخدمة');

  await personas.updatePersona(p.id, 'o-p', { voice: 'New voice.' });
  assert.equal((await personas.getPersona(p.id, 'o-p'))?.voice, 'New voice.');
  await personas.deletePersona(p.id, 'o-p');
  assert.equal((await personas.listPersonas('o-p')).length, 0);
});

test('knowledge base: docs store + deterministic retrieval picks only RELEVANT slices', async () => {
  const r = await store.createRobot('o-kb', { name: 'KB', role: 'customer_service' });
  await personas.addKbDoc(r.id, 'o-kb', 'shipping.md',
    'Shipping policy\n\nWe ship across the UAE in 2-3 business days. Free shipping over AED 200.\n\n' +
    'Returns\n\nReturns are accepted within 14 days with the original receipt.');
  await personas.addKbDoc(r.id, 'o-kb', 'menu.md',
    'Espresso AED 12\n\nFlat white AED 18\n\nCold brew AED 22');

  const docs = await personas.kbDocTexts(r.id);
  const hits = personas.selectKnowledge(docs, 'how long does shipping take to Dubai?');
  assert.ok(hits.length >= 1);
  assert.match(hits[0], /2-3 business days/);
  assert.ok(!hits.some((h) => /Espresso/.test(h))); // unrelated doc contributes nothing

  // Unrelated query → nothing (data-minimization holds).
  assert.equal(personas.selectKnowledge(docs, 'quarterly financials variance').length, 0);

  const listed = await personas.listKbDocs(r.id, 'o-kb');
  assert.equal(listed.length, 2);
  assert.ok(listed[0].chars > 10);
  await personas.deleteKbDoc(listed[0].id, 'o-kb');
  assert.equal((await personas.listKbDocs(r.id, 'o-kb')).length, 1);
});

test('chunkText splits on paragraphs and handles a huge single paragraph', () => {
  const chunks = personas.chunkText('one\n\ntwo\n\n' + 'x'.repeat(2500), 800);
  assert.ok(chunks.length >= 3);
  assert.ok(chunks.every((c) => c.length <= 900));
});

// ---- commander bridge ----

test('parseCommandJson: clean, fenced, aliases, and garbage', () => {
  const a = tasks.parseCommandJson('{"action":"build","mode":"code","brief":"Make a site","deliver_to":[{"channel":"email","address":"x@y.com"}]}');
  assert.equal(a?.action, 'build');
  assert.equal(a?.deliverTo[0].address, 'x@y.com');
  const b = tasks.parseCommandJson('```json\n{"action":"chat","mode":"code","brief":""}\n```');
  assert.equal(b?.action, 'chat');
  const c = tasks.parseCommandJson('{"action":"build","mode":"report","brief":"","deliver_to":[]}');
  assert.equal(c, null); // a build with no brief is invalid
  assert.equal(tasks.parseCommandJson('not json at all'), null);
  // Invalid channel in deliver_to is dropped, not trusted.
  const d = tasks.parseCommandJson('{"action":"build","mode":"code","brief":"x","deliver_to":[{"channel":"pigeon","address":"a"}]}');
  assert.equal(d?.deliverTo.length, 0);
});

test('commanders: CRUD + case-insensitive match; classify fails CLOSED without a model', async () => {
  const r = await store.createRobot('o-cmd', { name: 'PA', role: 'personal_assistant' });
  const c = await tasks.addCommander(r.id, 'o-cmd', 'telegram', '9911', 'Me');
  assert.equal(await tasks.isCommander(r.id, 'telegram', '9911'), true);
  assert.equal(await tasks.isCommander(r.id, 'whatsapp', '9911'), false); // per-channel
  assert.equal(await tasks.isCommander(r.id, 'telegram', '0000'), false);

  // No model key in tests → classifyCommand must return chat (a build NEVER starts on a guess).
  const ac = new AbortController();
  const cmd = await tasks.classifyCommand('build me a website for my cafe', ac.signal);
  assert.equal(cmd.action, 'chat');

  // The command lane is commander-gated: a stranger can never reach classification.
  const robot = (await store.getRobot(r.id, 'o-cmd'))!;
  assert.equal(await tasks.tryCommand(robot, 'telegram', 'stranger', null, 'build me a website', 'm1'), false);

  await tasks.deleteCommander(c.id, 'o-cmd');
  assert.equal(await tasks.isCommander(r.id, 'telegram', '9911'), false);
});

test('BUILD_HINT_RE prefilter: creation asks pass, chit-chat does not', () => {
  assert.ok(tasks.BUILD_HINT_RE.test('make me a website for the cafe'));
  assert.ok(tasks.BUILD_HINT_RE.test('create a presentation about Q3'));
  // Polite/question-form creation asks still pass the prefilter (reach the classifier).
  assert.ok(tasks.BUILD_HINT_RE.test('can you create an image of a cat?'));
  assert.ok(tasks.BUILD_HINT_RE.test('could you make me a logo please'));
  assert.ok(!tasks.BUILD_HINT_RE.test('what time is my meeting tomorrow?'));
});

test('the classifier prompt routes polite/question-form creation asks to build (not chat)', () => {
  // The Telegram-image bug: a polite "can you make an image…" was classified as chat and fell
  // to the reply lane, which then narrated a false async promise. The classifier must route
  // creation requests — including "can you"/"could you" forms — to the reliable build bridge.
  const src = fs.readFileSync(path.join(__dirname, '../src/robots/tasks.ts'), 'utf8');
  assert.match(src, /INCLUDING polite or/);
  assert.match(src, /"can you"\/"could you" does NOT make it chat/);
  assert.match(src, /When in doubt about a make-request, choose "build"/);
});

test('deterministicBuildCommand: clear creation asks build WITHOUT the LLM classifier', () => {
  const b = tasks.deterministicBuildCommand;
  // The exact live failure: a polite "create an image" must resolve to a build with no model call.
  const img = b('Can you create an image of a dog baking a cake');
  assert.equal(img?.action, 'build');
  assert.equal(img?.mode, 'code');
  assert.match(img!.brief, /dog baking a cake/);
  assert.deepEqual(img?.deliverTo, []); // delivers back to the commander's own channel
  // Other unambiguous make-requests across the deliverable surface.
  assert.equal(b('make me a logo')?.action, 'build');
  assert.equal(b('generate a short video of a sunset')?.mode, 'code');
  assert.equal(b('design a poster for our launch')?.action, 'build');
  assert.equal(b('write me a poem about the sea')?.action, 'build');
  // Report/deck deliverables route to report mode — but a "report app" stays a code build.
  assert.equal(b('create a pitch deck for investors')?.mode, 'report');
  assert.equal(b('build me a report app for sales')?.mode, 'code');
});

test('deterministicBuildCommand: questions, chit-chat, and named destinations do NOT fast-path', () => {
  const b = tasks.deterministicBuildCommand;
  // Questions and status — never a build.
  assert.equal(b('how long does it take?'), null);
  assert.equal(b('can it send images to chat?'), null);
  assert.equal(b('what can you do?'), null);
  assert.equal(b('hello'), null);
  assert.equal(b('did you send the image yet'), null); // "send", not a creation verb
  // A named third-party destination needs the LLM to extract deliverTo → defer (returns null).
  assert.equal(b('make a logo and email it to bob@acme.com'), null);
  assert.equal(b('create a flyer and send it to +971501234567'), null);
});

test('the reply lane forbids false async promises (no background render)', () => {
  // The studio-tool reply lane has NO background: a file only reaches the sender when its tool
  // runs THIS turn. The system prompt must forbid "generating now / almost there" stalling.
  const src = fs.readFileSync(path.join(__dirname, '../src/robots/reply.ts'), 'utf8');
  assert.match(src, /you have NO background or "later"/);
  assert.match(src, /generating now/);
  assert.match(src, /There is no async render/);
  // And when NO tools are offered to the sender, the reply must not promise media at all.
  assert.match(src, /CANNOT generate images, videos, documents or any file in this reply/);
  assert.match(src, /NO background job that will produce one later/);
});

test('collectDeliverables: produced files only, intermediates skipped, newest-first + dedupe', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deliv-'));
  const old = Date.now() - 60_000;
  fs.writeFileSync(path.join(dir, 'report.pdf'), 'newpdf');
  fs.writeFileSync(path.join(dir, 'deck.preview.html'), 'x'); // intermediate → skipped
  fs.writeFileSync(path.join(dir, 'stale.pdf'), 'old');
  fs.utimesSync(path.join(dir, 'stale.pdf'), new Date(old), new Date(old));
  fs.mkdirSync(path.join(dir, 'node_modules', 'p'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'node_modules', 'p', 'x.pdf'), 'dep'); // skipped dir
  fs.writeFileSync(path.join(dir, 'model.xlsx'), 'sheet');
  const got = tasks.collectDeliverables(dir, Date.now() - 10_000).map((p) => path.basename(p));
  assert.deepEqual(got.sort(), ['model.xlsx', 'report.pdf']);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---- public webhook routes ----

test('whatsapp webhook: hub.challenge verify handshake (matching token only)', async () => {
  const r = await store.createRobot('o-wa', { name: 'WA', role: 'customer_service' });
  await store.updateRobot(r.id, 'o-wa', { status: 'active' });
  await chStore.upsertChannel(r.id, 'o-wa', 'whatsapp', {
    secrets: { accessToken: 'tok' },
    meta: { phoneNumberId: '106540352242922', verifyToken: 'my-verify-123' },
  });

  const ok = await app.inject({
    url: '/api/hooks/whatsapp?hub.mode=subscribe&hub.verify_token=my-verify-123&hub.challenge=CHAL42',
  });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.body, 'CHAL42');

  const bad = await app.inject({
    url: '/api/hooks/whatsapp?hub.mode=subscribe&hub.verify_token=WRONG&hub.challenge=CHAL42',
  });
  assert.equal(bad.statusCode, 403);
});

test('whatsapp webhook: inbound message routes by phone_number_id → locked channel draft', async () => {
  const payload = {
    object: 'whatsapp_business_account',
    entry: [{
      id: '1', changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: '15550783881', phone_number_id: '106540352242922' },
          contacts: [{ profile: { name: 'Sheena' }, wa_id: '16505551234' }],
          messages: [{ from: '16505551234', id: 'wamid.TEST1', timestamp: '1749416383', type: 'text', text: { body: 'Do you deliver?' } }],
        },
      }],
    }],
  };
  const res = await app.inject({ method: 'POST', url: '/api/hooks/whatsapp', payload });
  assert.equal(res.statusCode, 200);
  await new Promise((r) => setTimeout(r, 300)); // handler processes after the fast 200

  const robots = await store.listRobots('o-wa');
  const drafts = await store.listDrafts('o-wa', robots[0].id);
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].channel, 'whatsapp');
  assert.equal(drafts[0].toAddr, '16505551234'); // locked to the sender's wa number
  assert.equal(drafts[0].inboundName, 'Sheena');
  assert.match(drafts[0].inboundBody || '', /Do you deliver/);

  // Same wamid again → idempotent.
  await app.inject({ method: 'POST', url: '/api/hooks/whatsapp', payload });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal((await store.listDrafts('o-wa', robots[0].id)).length, 1);
});

test('whatsapp webhook: a stored app secret REQUIRES a valid signature (spoof dropped)', async () => {
  const r = await store.createRobot('o-was', { name: 'WAS', role: 'customer_service' });
  await store.updateRobot(r.id, 'o-was', { status: 'active' });
  await chStore.upsertChannel(r.id, 'o-was', 'whatsapp', {
    secrets: { accessToken: 'tok', appSecret: 'shh' },
    meta: { phoneNumberId: '222000111', verifyToken: 'v' },
  });
  const payload = {
    object: 'whatsapp_business_account',
    entry: [{
      id: '1', changes: [{
        field: 'messages',
        value: {
          metadata: { phone_number_id: '222000111' },
          contacts: [],
          messages: [{ from: '97150000000', id: 'wamid.SPOOF', timestamp: '1', type: 'text', text: { body: 'spoofed' } }],
        },
      }],
    }],
  };
  // No signature → dropped.
  await app.inject({ method: 'POST', url: '/api/hooks/whatsapp', payload });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal((await store.listDrafts('o-was', r.id)).length, 0);

  // Valid signature → accepted.
  const { createHmac } = await import('node:crypto');
  const raw = JSON.stringify(payload);
  const sig = 'sha256=' + createHmac('sha256', 'shh').update(raw).digest('hex');
  await app.inject({
    method: 'POST', url: '/api/hooks/whatsapp', payload: raw,
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig },
  });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal((await store.listDrafts('o-was', r.id)).length, 1);
});

test('sms webhook: hookKey gates inbound; wrong key or mismatched channel number dropped', async () => {
  const r = await store.createRobot('o-sms', { name: 'SMS', role: 'customer_service' });
  await store.updateRobot(r.id, 'o-sms', { status: 'active' });
  const ch = await chStore.upsertChannel(r.id, 'o-sms', 'sms', {
    secrets: { apiId: 'A', apiPassword: 'P' },
    meta: { senderId: 'ARKS', channelNumber: '2222222', hookKey: 'k-good-key' },
  });
  assert.equal(ch.meta.hookKey, 'k-good-key');

  // Wrong key → dropped.
  await app.inject({ url: '/api/hooks/sms/k-WRONG?ChannelNumber=2222222&IncomingNumber=971501234567&MessageText=Hi' });
  await new Promise((r) => setTimeout(r, 200));
  assert.equal((await store.listDrafts('o-sms', r.id)).length, 0);

  // Mismatched channel number → dropped.
  await app.inject({ url: '/api/hooks/sms/k-good-key?ChannelNumber=999&IncomingNumber=971501234567&MessageText=Hi' });
  await new Promise((r) => setTimeout(r, 200));
  assert.equal((await store.listDrafts('o-sms', r.id)).length, 0);

  // Good → a locked sms draft.
  await app.inject({ url: '/api/hooks/sms/k-good-key?ChannelNumber=2222222&IncomingNumber=971501234567&MessageText=What are your hours?' });
  await new Promise((r) => setTimeout(r, 300));
  const drafts = await store.listDrafts('o-sms', r.id);
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].channel, 'sms');
  assert.equal(drafts[0].toAddr, '971501234567');
});

test('sms adapter: unicode detection picks the right encoding flag', async () => {
  const sms = await import('../src/robots/channels/sms');
  assert.equal(sms.needsUnicode('Hello, your order shipped.'), false);
  assert.equal(sms.needsUnicode('مرحبا — تم شحن طلبك'), true);
});

test('channel + persona + kb + commander routes are org-gated (401 without auth)', async () => {
  for (const url of [
    '/api/orgs/o-ch/robots/x/channels',
    '/api/orgs/o-p/personas',
    '/api/orgs/o-kb/robots/x/kb',
    '/api/orgs/o-cmd/robots/x/commanders',
    '/api/orgs/o-cmd/robots/x/tasks',
  ]) {
    const res = await app.inject({ url });
    assert.equal(res.statusCode, 401, url);
  }
});

test('robot-file token route: mint → fetch → expiry-shaped 404 for junk', async () => {
  const rf = await import('../src/routes/robotFiles');
  const dataDir = path.join(process.env.DATA_DIR!, 'data', 'sessions');
  fs.mkdirSync(dataDir, { recursive: true });
  const f = path.join(dataDir, 'report.pdf');
  fs.writeFileSync(f, 'PDFDATA');
  const token = rf.mintRobotFileToken(f);
  const ok = await app.inject({ url: `/api/robot-file/${token}` });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.headers['content-type'], 'application/pdf');
  assert.equal(ok.body, 'PDFDATA');
  const bad = await app.inject({ url: '/api/robot-file/notatoken123' });
  assert.equal(bad.statusCode, 404);
  // Outside the data tree → refuses to mint.
  const outside = path.join(os.tmpdir(), 'x.pdf');
  fs.writeFileSync(outside, 'x');
  assert.throws(() => rf.mintRobotFileToken(outside));
});

test('telegram sendFile renders images/videos inline (sendPhoto/sendVideo), else sendDocument', async () => {
  const { pickTelegramMedia } = telegram;
  assert.deepEqual(pickTelegramMedia('creative-123.jpg', 2_000_000), { method: 'sendPhoto', field: 'photo' });
  assert.deepEqual(pickTelegramMedia('logo.png', 500_000), { method: 'sendPhoto', field: 'photo' });
  assert.deepEqual(pickTelegramMedia('explainer-final.mp4', 8_000_000), { method: 'sendVideo', field: 'video' });
  // A .docx / .pdf / .xlsx always a document.
  assert.deepEqual(pickTelegramMedia('report.pdf', 300_000), { method: 'sendDocument', field: 'document' });
  assert.deepEqual(pickTelegramMedia('model.xlsx', 40_000), { method: 'sendDocument', field: 'document' });
  // Oversized image/video degrade to a document (never dropped).
  assert.equal(pickTelegramMedia('huge.png', 20 * 1024 * 1024).method, 'sendDocument');
  assert.equal(pickTelegramMedia('big.mp4', 80 * 1024 * 1024).method, 'sendDocument');
  // gif stays a document (sendPhoto would flatten the animation).
  assert.equal(pickTelegramMedia('loop.gif', 1_000_000).method, 'sendDocument');
});
