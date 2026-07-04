import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Throwaway SQLite DB + crypto key, set BEFORE any import.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-robov2-'));
process.env.ENCRYPTION_KEY = 'test-key-robov2';
delete process.env.DATABASE_URL;
delete process.env.MINIMAX_API_KEY;
delete process.env.DEEPSEEK_API_KEY;

let db: typeof import('../src/db');
let store: typeof import('../src/robots/store');
let chStore: typeof import('../src/robots/channels/store');
let telegram: typeof import('../src/robots/channels/telegram');
let notify: typeof import('../src/robots/notify');
let media: typeof import('../src/robots/media');
let ics: typeof import('../src/robots/ics');
let tasks: typeof import('../src/robots/tasks');
let jobs: typeof import('../src/robots/jobs');
let actions: typeof import('../src/robots/actions');
let analytics: typeof import('../src/robots/analytics');
let reply: typeof import('../src/robots/reply');

before(async () => {
  db = await import('../src/db');
  await db.initDb();
  const orgs = await import('../src/orgs/store');
  await orgs.bootstrapOrgs();
  store = await import('../src/robots/store');
  chStore = await import('../src/robots/channels/store');
  telegram = await import('../src/robots/channels/telegram');
  notify = await import('../src/robots/notify');
  media = await import('../src/robots/media');
  ics = await import('../src/robots/ics');
  tasks = await import('../src/robots/tasks');
  jobs = await import('../src/robots/jobs');
  actions = await import('../src/robots/actions');
  analytics = await import('../src/robots/analytics');
  reply = await import('../src/robots/reply');
});

const mkDraft = (robotId: string, orgId: string, over: Partial<Parameters<typeof store.createDraft>[0]> = {}) =>
  store.createDraft({
    robotId, orgId, inboundMessageId: `<${Math.random().toString(36).slice(2)}@t>`,
    inboundFrom: 'cust@x.com', inboundName: 'Cust', inboundSubject: 'Hi', inboundSnippet: 'hello',
    inboundBody: 'hello there', toAddr: 'cust@x.com', subject: 'Re: Hi', draftText: 'Sure!',
    modelUsed: 'm', escalated: false, ...over,
  });

// ---- #2 conversation memory ----

test('memory: thread history is sender-isolated and formats sent/escalated correctly', async () => {
  const r = await store.createRobot('o-mem', { name: 'M', role: 'customer_service' });
  const a1 = await mkDraft(r.id, 'o-mem', { inboundFrom: 'alice@x.com', inboundBody: 'Do you ship to Dubai?', draftText: 'Yes, 2-3 days.', channel: 'email' });
  await store.markDraftStatus(a1.id, 'o-mem', 'sent', Date.now());
  await mkDraft(r.id, 'o-mem', { inboundFrom: 'alice@x.com', inboundBody: 'And how much is shipping?', draftText: '', escalated: true, channel: 'email' });
  await mkDraft(r.id, 'o-mem', { inboundFrom: 'bob@y.com', inboundBody: 'BOB SECRET QUESTION', draftText: 'bob reply', channel: 'email' });

  const thread = await store.listThreadDrafts(r.id, 'email', 'ALICE@X.COM'); // case-insensitive
  assert.equal(thread.length, 2);
  const lines = store.buildHistoryLines(thread);
  assert.ok(lines.some((l) => l.includes('Do you ship to Dubai?')));
  assert.ok(lines.some((l) => l.includes('You replied: Yes, 2-3 days.')));
  assert.ok(lines.some((l) => l.includes('escalated'))); // unanswered exchange marked, not shown as sent
  assert.ok(!lines.some((l) => l.includes('BOB SECRET'))); // cross-sender isolation
});

test('memory: normalizeAddr matches phone formats; budget keeps the most recent exchanges', () => {
  assert.equal(store.normalizeAddr('+971 50 123 4567'), store.normalizeAddr('971501234567'));
  assert.equal(store.normalizeAddr('User@X.com'), 'user@x.com');
  assert.notEqual(store.normalizeAddr('12345'), store.normalizeAddr('54321'));
  const drafts = Array.from({ length: 30 }, (_, i) => ({
    inboundBody: `question number ${i} ${'x'.repeat(200)}`,
    inboundSnippet: '', draftText: `answer ${i}`, status: 'sent',
  })) as any[];
  const lines = store.buildHistoryLines(drafts);
  const joined = lines.join('\n');
  assert.ok(joined.length <= 3200);
  assert.ok(joined.includes('question number 29')); // newest survives
  assert.ok(!joined.includes('question number 0')); // oldest dropped first
});

// ---- #3 owner notifications + remote approval ----

function tgMock(sent: any[]): typeof fetch {
  return (async (url: any, init?: any) => {
    const method = String(url).split('/').pop()!;
    const body = init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    if (method === 'sendMessage') sent.push(body);
    return { ok: true, status: 200, json: async () => ({ ok: true, result: method === 'getMe' ? { username: 'b' } : {} }) } as any;
  }) as typeof fetch;
}

test('notify: escalation pings notify-enabled commanders once; own messages never ping', async () => {
  const r = await store.createRobot('o-nf', { name: 'NF', role: 'customer_service' });
  await store.updateRobot(r.id, 'o-nf', { status: 'active' });
  await chStore.upsertChannel(r.id, 'o-nf', 'telegram', { secrets: { botToken: 't' } });
  await tasks.addCommander(r.id, 'o-nf', 'telegram', '777', 'Me', true);
  const robot = (await store.getRobot(r.id, 'o-nf'))!;
  const sent: any[] = [];
  telegram.__setTelegramFetch(tgMock(sent));

  const d = await mkDraft(r.id, 'o-nf', { escalated: true, escalationReason: 'refund request', draftText: '' });
  assert.equal(await notify.notifyOwnersOfDraft(robot, d), 1);
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /refund request/);
  assert.equal(sent[0].chat_id, '777');
  // Second call: already notified → no duplicate ping.
  assert.equal(await notify.notifyOwnersOfDraft(robot, d), 0);
  // The owner's own conversation never generates a ping about itself.
  const own = await mkDraft(r.id, 'o-nf', { inboundFrom: '777', escalated: true, inboundMessageId: '<own@t>' });
  assert.equal(await notify.notifyOwnersOfDraft(robot, own), 0);
  // notify='off' silences everything.
  await store.updateRobot(r.id, 'o-nf', { config: { notify: 'off' } });
  const d2 = await mkDraft(r.id, 'o-nf', { escalated: true, inboundMessageId: '<off@t>' });
  assert.equal(await notify.notifyOwnersOfDraft((await store.getRobot(r.id, 'o-nf'))!, d2), 0);
});

test('notify: remote APPROVE sends the locked draft; IGNORE dismisses; strangers never resolve', async () => {
  const r = await store.createRobot('o-ap', { name: 'AP', role: 'customer_service' });
  await store.updateRobot(r.id, 'o-ap', { status: 'active' });
  await chStore.upsertChannel(r.id, 'o-ap', 'telegram', { secrets: { botToken: 't' } });
  await tasks.addCommander(r.id, 'o-ap', 'telegram', '888', 'Me', true);
  const robot = (await store.getRobot(r.id, 'o-ap'))!;
  const sent: any[] = [];
  telegram.__setTelegramFetch(tgMock(sent));

  // A pending TELEGRAM draft (so remote approval sends via the mocked adapter).
  const d = await mkDraft(r.id, 'o-ap', {
    inboundFrom: '555', toAddr: '555', channel: 'telegram', draftText: 'Our hours are 9-6.', escalated: true,
    escalationReason: 'check', inboundMessageId: '<tg-1@t>',
  });
  await store.updateRobot(r.id, 'o-ap', { config: { notify: 'escalations' } });
  await notify.notifyOwnersOfDraft((await store.getRobot(r.id, 'o-ap'))!, d);
  assert.equal(sent.length, 1);

  // A stranger's "approve" does nothing (no notification for that address).
  assert.equal(await notify.tryResolveNotification(robot, 'telegram', '999', null, 'approve', '<x1@t>'), false);

  // The owner approves → the draft goes out to the LOCKED recipient, status flips to sent.
  const handled = await notify.tryResolveNotification(robot, 'telegram', '888', 'Me', 'APPROVE', '<x2@t>');
  assert.equal(handled, true);
  const after = await store.getDraft(d.id);
  assert.equal(after?.status, 'sent');
  const outbound = sent.filter((s) => s.chat_id === '555');
  assert.equal(outbound.length, 1);
  assert.match(outbound[0].text, /9-6/);

  // A second pending draft → IGNORE dismisses it.
  const d2 = await mkDraft(r.id, 'o-ap', {
    inboundFrom: '556', toAddr: '556', channel: 'telegram', draftText: 'Draft 2', escalated: true,
    inboundMessageId: '<tg-2@t>',
  });
  await notify.notifyOwnersOfDraft((await store.getRobot(r.id, 'o-ap'))!, d2);
  await notify.tryResolveNotification(robot, 'telegram', '888', 'Me', 'ignore', '<x3@t>');
  assert.equal((await store.getDraft(d2.id))?.status, 'dismissed');
});

// ---- #4 media ----

test('media: describeAttachments — docs extracted, voice transcribed, oversize + missing handled', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'med-'));
  const txt = path.join(dir, 'notes.txt');
  fs.writeFileSync(txt, 'Order 4412 was damaged in transit. Requesting replacement.');
  const big = path.join(dir, 'big.pdf');
  fs.writeFileSync(big, Buffer.alloc(11 * 1024 * 1024));
  media.__setMediaDeps({
    extract: async () => 'EXTRACTED PDF TEXT',
    transcribe: async () => ({ ok: true, text: 'please build me a landing page for the new offer' }),
  });
  const ac = new AbortController();
  const { notes, voiceText } = await media.describeAttachments(
    [
      { kind: 'document', name: 'notes.txt', path: txt, mime: 'text/plain' },
      { kind: 'audio', name: 'voice.ogg', path: txt, mime: 'audio/ogg' },
      { kind: 'document', name: 'big.pdf', path: big, mime: 'application/pdf' },
      { kind: 'image', name: 'gone.jpg', path: path.join(dir, 'nope.jpg'), mime: 'image/jpeg' },
    ],
    ac.signal,
  );
  assert.match(notes[0], /Order 4412/);
  assert.match(notes[1], /transcribed.*landing page/);
  assert.equal(voiceText, 'please build me a landing page for the new offer'); // feeds the command lane
  assert.match(notes[2], /too large/);
  assert.match(notes[3], /\(\+1 more attachment/); // cap note (MAX=3 → 4th collapses)

  // Transcription unavailable → the honest ask-them-to-type note; no-speech → its own note.
  media.__setMediaDeps({ transcribe: async () => ({ ok: false, error: 'no engine' }) });
  const fail = await media.describeAttachments([{ kind: 'audio', name: 'v.ogg', path: txt, mime: 'audio/ogg' }], ac.signal);
  assert.match(fail.notes[0], /could not be transcribed|type the key points/);
  assert.equal(fail.voiceText, '');
  media.__setMediaDeps({ transcribe: async () => ({ ok: true, text: '', noSpeech: true }) });
  const quiet = await media.describeAttachments([{ kind: 'audio', name: 'v.ogg', path: txt, mime: 'audio/ogg' }], ac.signal);
  assert.match(quiet.notes[0], /no clear speech/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('voice: transcribeAudio — no key fails closed; mocked ARK round-trip + no-speech marker', async () => {
  const voice = await import('../src/robots/voice');
  const ac = new AbortController();
  // No ARK key in tests → honest unavailability, never a throw.
  const off = await voice.transcribeAudio('/nonexistent.ogg', ac.signal);
  assert.equal(off.ok, false);

  // With a key + mocked fetch: mp3 input skips ffmpeg, round-trips the transcript.
  const { config } = await import('../src/config');
  (config as any).byteplusApiKey = 'test-key';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asr-'));
  const mp3 = path.join(dir, 'note.mp3');
  fs.writeFileSync(mp3, Buffer.from('fake-mp3-bytes'));
  try {
    voice.__setVoiceFetch((async (_url: any, init: any) => {
      const body = JSON.parse(init.body);
      assert.equal(body.messages[0].content[0].type, 'input_audio'); // the probe-validated shape
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'مرحبا، ابنِ لي موقعاً' } }] }) } as any;
    }) as typeof fetch);
    const r = await voice.transcribeAudio(mp3, ac.signal);
    assert.equal(r.ok, true);
    assert.match(r.text || '', /مرحبا/); // language preserved

    voice.__setVoiceFetch((async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '[no speech]' } }] }) })) as any);
    const quiet = await voice.transcribeAudio(mp3, ac.signal);
    assert.equal(quiet.ok, true);
    assert.equal(quiet.noSpeech, true);
  } finally {
    (config as any).byteplusApiKey = '';
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('media: classifyMime routes images/audio/docs', () => {
  assert.equal(media.classifyMime('image/png', 'a.png'), 'image');
  assert.equal(media.classifyMime('application/pdf', 'a.pdf'), 'document');
  assert.equal(media.classifyMime('', 'note.ogg'), 'audio');
});

// ---- #7 iCal ----

const SAMPLE_ICS = [
  'BEGIN:VCALENDAR',
  'METHOD:REQUEST',
  'PRODID:-//Test//EN',
  'BEGIN:VEVENT',
  'UID:evt-123@cal',
  'SEQUENCE:2',
  'SUMMARY:Board revi',
  ' ew meeting', // folded line
  'DTSTART;TZID=Asia/Dubai:20260710T140000',
  'ORGANIZER;CN=Sara:mailto:sara@corp.com',
  'ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:robot@acme.com',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

test('ics: parse (folded lines, TZID, sequence) + REPLY builder preserves UID/SEQUENCE', () => {
  const inv = ics.parseIcs(SAMPLE_ICS)!;
  assert.equal(inv.method, 'REQUEST');
  assert.equal(inv.uid, 'evt-123@cal');
  assert.equal(inv.sequence, 2);
  assert.equal(inv.summary, 'Board review meeting'); // unfolded
  assert.equal(inv.organizerEmail, 'sara@corp.com');
  assert.deepEqual(inv.attendees, ['robot@acme.com']);
  assert.match(ics.describeWhen(inv), /2026-07-10 14:00 \(Asia\/Dubai\)/);

  const out = ics.buildIcsReply(inv, 'robot@acme.com', 'ACCEPTED', new Date('2026-07-04T10:00:00Z'));
  assert.match(out, /METHOD:REPLY/);
  assert.match(out, /UID:evt-123@cal/);
  assert.match(out, /SEQUENCE:2/);
  assert.match(out, /ATTENDEE;PARTSTAT=ACCEPTED[^\r\n]*mailto:robot@acme\.com/);
  assert.match(out, /ORGANIZER:mailto:sara@corp\.com/);
  assert.ok(out.includes('\r\n')); // CRLF per RFC
  // Garbage in → null, never a throw.
  assert.equal(ics.parseIcs('not a calendar'), null);
  const cancel = ics.parseIcs(SAMPLE_ICS.replace('METHOD:REQUEST', 'METHOD:CANCEL'))!;
  assert.equal(cancel.method, 'CANCEL');
});

test('ics: the meeting JSON field only appears for a live invite; parse passes it through', () => {
  const robot: any = {
    id: 'x', orgId: 'o', name: 'PA', role: 'personal_assistant', status: 'active', autonomy: 'ask',
    model: 'arksai-max', lastPolledAt: null, createdAt: 0, updatedAt: 0, config: {},
  };
  const sys = reply.buildSystem(robot, undefined, { meeting: { summary: 'Sync', when: 'Thu 2pm', organizer: 'a@b.c' } });
  assert.match(sys, /"meeting": "accept"\|"decline"/);
  const sysCancel = reply.buildSystem(robot, undefined, { meeting: { summary: 'Sync', when: 'Thu', organizer: 'a@b.c', cancelled: true } });
  assert.doesNotMatch(sysCancel, /"meeting": "accept"/);
  const parsed = reply.parseReplyJson('{"escalate":false,"reason":"","reply":"See you then","meeting":"accept"}');
  assert.equal(parsed?.meeting, 'accept');
});

// ---- #6 commander controls ----

test('controls: STATUS/CANCEL regexes are precise; status with no tasks answers honestly', async () => {
  assert.ok(tasks.STATUS_RE.test('status'));
  assert.ok(tasks.STATUS_RE.test("how's it going?"));
  assert.ok(tasks.CANCEL_RE.test('cancel it'));
  assert.ok(!tasks.STATUS_RE.test('what is the status of my order 123?')); // customer-ish → NOT a control
  assert.ok(!tasks.CANCEL_RE.test('cancel my subscription please'));

  const r = await store.createRobot('o-ctl', { name: 'CTL', role: 'custom' });
  await store.updateRobot(r.id, 'o-ctl', { status: 'active' });
  await chStore.upsertChannel(r.id, 'o-ctl', 'telegram', { secrets: { botToken: 't' } });
  await tasks.addCommander(r.id, 'o-ctl', 'telegram', '42', null, true);
  const robot = (await store.getRobot(r.id, 'o-ctl'))!;
  const sent: any[] = [];
  telegram.__setTelegramFetch(tgMock(sent));
  assert.equal(await tasks.tryCommand(robot, 'telegram', '42', null, 'status', '<s1@t>'), true);
  assert.match(sent[0].text, /Nothing is building/);
  assert.equal(await tasks.tryCommand(robot, 'telegram', '42', null, 'cancel', '<s2@t>'), true);
  assert.match(sent[1].text, /nothing to cancel/);
  // Without a model, a build-ish message fails CLOSED (no task starts, falls to reply lane).
  assert.equal(await tasks.tryCommand(robot, 'telegram', '42', null, 'build me a website', '<s3@t>'), false);
});

// ---- #5 routines ----

test('routines: composeDigest — quiet day → null; activity + stale items → readable text', () => {
  const now = Date.now();
  assert.equal(jobs.composeDigest({ robotName: 'R', now, recentDrafts: [], needsYou: [], recentTasks: [] }), null);
  const text = jobs.composeDigest({
    robotName: 'Atlas',
    now,
    recentDrafts: [
      { status: 'sent', channel: 'telegram', createdAt: now - 3_600_000 },
      { status: 'escalated', channel: 'email', createdAt: now - 7_200_000 },
    ],
    needsYou: [
      { inboundFrom: 'a@x.com', inboundName: 'Ali', inboundSubject: 'Refund', createdAt: now - 50 * 3_600_000, status: 'escalated' },
    ],
    recentTasks: [{ status: 'delivered', request: 'site' }],
  })!;
  assert.match(text, /Atlas/);
  assert.match(text, /2 message/);
  assert.match(text, /1 replied, 1 flagged/);
  assert.match(text, /Ali · Refund \(50h\)/);
  assert.match(text, /waited over 48h/);
  assert.match(text, /1 delivered/);
});

test('routines: job CRUD computes next_run_at; due jobs advance BEFORE firing (paused robot skips)', async () => {
  const r = await store.createRobot('o-job', { name: 'J', role: 'custom' }); // status draft → skip
  const job = await jobs.createJob(r.id, 'o-job', { kind: 'digest', cadence: 'daily', atTime: '08:00' });
  assert.ok(job.nextRunAt > Date.now());
  // Force it due, then run: the robot isn't active → nothing sent, but next_run_at advanced.
  await db.q('UPDATE robot_jobs SET next_run_at = $1 WHERE id = $2', [Date.now() - 1000, job.id]);
  await jobs.runDueJobs(async (id) => store.getRobot(id));
  const after = (await jobs.listJobs(r.id, 'o-job'))[0];
  assert.ok(after.nextRunAt > Date.now()); // advanced (no double-fire window)
  assert.ok(after.lastRunAt != null);
  await jobs.deleteJob(job.id, 'o-job');
  assert.equal((await jobs.listJobs(r.id, 'o-job')).length, 0);
});

// ---- #8 actions ----

test('actions: input validation (https, declared slots, param names)', () => {
  const base = { name: 'order_status', description: 'Look up an order', urlTemplate: 'https://api.x.com/o/{{order_id}}', params: [{ name: 'order_id', description: 'the id' }] };
  assert.equal(actions.validateActionInput(base as any), null);
  assert.match(actions.validateActionInput({ ...base, urlTemplate: 'http://api.x.com/{{order_id}}' } as any)!, /https/);
  assert.match(actions.validateActionInput({ ...base, urlTemplate: 'https://api.x.com/{{oops}}' } as any)!, /no declared parameter/);
  assert.match(actions.validateActionInput({ ...base, name: 'bad name!' } as any)!, /Action name/);
});

test('actions: template rendering URL-encodes params; sanitize drops undeclared extras', () => {
  const url = actions.renderTemplate('https://api.x.com/o/{{id}}?q={{id}}', { id: 'AB 12/&?' }, 'url');
  assert.equal(url, 'https://api.x.com/o/AB%2012%2F%26%3F?q=AB%2012%2F%26%3F');
  const body = actions.renderTemplate('{"note":"{{note}}"}', { note: 'say "hi"\nplease' }, 'body');
  assert.equal(JSON.parse(body).note, 'say "hi"\nplease'); // escaped, valid JSON
  const action: any = { params: [{ name: 'id', description: '' }] };
  assert.deepEqual(actions.sanitizeParams(action, { id: ' 42 ', evil: 'x', extra: 'y' } as any), { id: '42' });
});

test('actions: upsert stores headers encrypted + write-only; rate limiter caps per hour', async () => {
  const r = await store.createRobot('o-act', { name: 'A', role: 'customer_service' });
  const a = await actions.upsertAction(r.id, 'o-act', {
    name: 'lookup', description: 'x', urlTemplate: 'https://api.x.com/{{q}}',
    params: [{ name: 'q', description: 'query' }], headers: { Authorization: 'Bearer SECRET-KEY' }, mode: 'ask',
  });
  assert.equal(a.hasHeaders, true);
  const raw = await db.qOne<any>('SELECT headers FROM robot_actions WHERE id = $1', [a.id]);
  assert.ok(!String(raw.headers).includes('SECRET-KEY')); // encrypted at rest
  // Update without re-sending headers keeps them.
  const a2 = await actions.upsertAction(r.id, 'o-act', { name: 'lookup', description: 'y', urlTemplate: 'https://api.x.com/{{q}}', params: [{ name: 'q', description: 'query' }] });
  assert.equal(a2.hasHeaders, true);
  assert.equal(a2.description, 'y');

  let allowed = 0;
  for (let i = 0; i < 25; i++) if (actions.underRateLimit('rate-test-robot')) allowed++;
  assert.equal(allowed, 20);
});

// ---- #9 analytics ----

test('analytics: computeRobotStats — deflection, median, receipts excluded, day buckets', () => {
  const now = Date.now();
  const day = 86_400_000;
  const rows = [
    { status: 'sent', channel: 'email', created_at: now - 1000, sent_at: now, model_used: 'm' },
    { status: 'sent', channel: 'telegram', created_at: now - day, sent_at: now - day + 60_000, model_used: 'm' },
    { status: 'escalated', channel: 'email', created_at: now - 2 * day, sent_at: null, model_used: 'm' },
    { status: 'sent', channel: 'telegram', created_at: now, sent_at: now, model_used: 'command-lane' }, // receipt → excluded
  ];
  const s = analytics.computeRobotStats(rows as any, [{ status: 'delivered' }, { status: 'error' }], [{ ok: 1 }, { ok: 0 }], now);
  assert.equal(s.total, 3);
  assert.equal(s.sent, 2);
  assert.equal(s.escalated, 1);
  assert.equal(Math.round((s.deflectionRate ?? 0) * 100), 67);
  assert.equal(s.medianResponseMs, 60_000); // [1000, 60000] → idx 1
  assert.deepEqual(s.byChannel, { email: 2, telegram: 1 });
  assert.equal(s.byDay.length, 14);
  assert.equal(s.byDay[13][1], 1); // today: 1 real draft
  assert.deepEqual(s.tasks, { delivered: 1, error: 1, running: 0 });
  assert.deepEqual(s.actions, { calls: 2, failures: 1 });
});
