import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-robots-'));
process.env.ENCRYPTION_KEY = 'test-key-robots';
delete process.env.DATABASE_URL;
// ModelArk is the only model provider; an explicit '' keeps the repo-root .env loader from filling
// the key in. Reply-lane tests toggle it in memory (__setByteplusKeyForTest) and stub fetch.
process.env.ARK_API_KEY = '';

let db: typeof import('../src/db');
let store: typeof import('../src/robots/store');
let reply: typeof import('../src/robots/reply');
// Loaded in before() (AFTER the env above) — a static import would evaluate config first and
// point the DB at the real data dir.
let config: typeof import('../src/config').config;
let __setByteplusKeyForTest: typeof import('../src/agent/byteplusRuntime').__setByteplusKeyForTest;

before(async () => {
  db = await import('../src/db');
  store = await import('../src/robots/store');
  reply = await import('../src/robots/reply');
  config = (await import('../src/config')).config;
  __setByteplusKeyForTest = (await import('../src/agent/byteplusRuntime')).__setByteplusKeyForTest;
  __setByteplusKeyForTest('');
  await db.initDb();
  const orgs = await import('../src/orgs/store');
  await orgs.bootstrapOrgs();
});

test('create / list / update / delete a robot (org-scoped)', async () => {
  const r = await store.createRobot('o1', { name: 'Support', role: 'customer_service', model: 'compare' });
  assert.equal(r.role, 'customer_service');
  assert.equal(r.status, 'draft');
  assert.equal(r.autonomy, 'ask'); // safe default
  assert.equal(r.model, 'compare');

  // Cross-org read is denied (not found).
  assert.equal(await store.getRobot(r.id, 'other-org'), null);
  assert.ok(await store.getRobot(r.id, 'o1'));

  const upd = await store.updateRobot(r.id, 'o1', { status: 'active', config: { knowledge: 'We ship in 3 days.' } });
  assert.equal(upd?.status, 'active');
  assert.equal(upd?.config.knowledge, 'We ship in 3 days.');

  const active = await store.listActiveRobots();
  assert.ok(active.find((x) => x.id === r.id));

  await store.deleteRobot(r.id, 'o1');
  assert.equal(await store.getRobot(r.id, 'o1'), null);
});

test('draft is idempotent per inbound message id and locks the recipient', async () => {
  const r = await store.createRobot('o1', { name: 'CS', role: 'customer_service' });
  const d = await store.createDraft({
    robotId: r.id, orgId: 'o1', inboundMessageId: '<abc@mail>',
    inboundFrom: 'cust@x.com', inboundName: 'Cust', inboundSubject: 'Help', inboundSnippet: 'hi',
    toAddr: 'cust@x.com', subject: 'Re: Help', draftText: 'Sure!', modelUsed: 'arksai-max',
  });
  assert.equal(d.toAddr, 'cust@x.com');
  assert.equal(d.status, 'pending');
  assert.equal(await store.draftExistsFor(r.id, '<abc@mail>'), true);
  assert.equal(await store.draftExistsFor(r.id, '<nope@mail>'), false);

  assert.equal(await store.countPendingDrafts('o1'), 1);
  await store.markDraftStatus(d.id, 'o1', 'sent', Date.now());
  assert.equal(await store.countPendingDrafts('o1'), 0);
});

test('an escalated draft is stored as escalated, not pending', async () => {
  const r = await store.createRobot('o1', { name: 'CS2', role: 'customer_service' });
  const d = await store.createDraft({
    robotId: r.id, orgId: 'o1', inboundMessageId: '<esc@mail>',
    inboundFrom: 'angry@x.com', inboundName: null, inboundSubject: 'Refund', inboundSnippet: 'I want my money back',
    toAddr: 'angry@x.com', subject: 'Re: Refund', draftText: '', modelUsed: 'arksai-max',
    escalated: true, escalationReason: 'refund request',
  });
  assert.equal(d.status, 'escalated');
  assert.equal(d.escalated, true);
});

test('a robot has a type (defaults to email) and a draft round-trips its full body', async () => {
  const r = await store.createRobot('o-t', { name: 'T', role: 'custom' });
  assert.equal(r.type, 'email'); // existing/default robots are email
  const d = await store.createDraft({
    robotId: r.id, orgId: 'o-t', inboundMessageId: '<b@m>', inboundFrom: 'q@x.com', inboundName: 'Q',
    inboundSubject: 'Hi', inboundSnippet: 'short', inboundBody: 'the full multi-line body of the email',
    toAddr: 'q@x.com', subject: 'Re: Hi', draftText: 'reply', modelUsed: 'm', escalated: false, escalationReason: null,
  });
  assert.equal(d.inboundBody, 'the full multi-line body of the email'); // responder gets the full body
  assert.equal(d.inboundSnippet, 'short'); // snippet kept for the compact feed
});

test('"Needs You" includes escalated drafts (not just pending) — the bug fix', async () => {
  const r = await store.createRobot('o-ny', { name: 'NY', role: 'customer_service' });
  // a pending draft + an escalated draft + a sent one (sent must NOT count)
  await store.createDraft({
    robotId: r.id, orgId: 'o-ny', inboundMessageId: '<p@m>', inboundFrom: 'a@x.com', inboundName: null,
    inboundSubject: 'Q1', inboundSnippet: null, toAddr: 'a@x.com', subject: 'Re: Q1', draftText: 'ready',
    modelUsed: 'm', escalated: false, escalationReason: null,
  });
  await store.createDraft({
    robotId: r.id, orgId: 'o-ny', inboundMessageId: '<e@m>', inboundFrom: 'b@x.com', inboundName: null,
    inboundSubject: 'Q2', inboundSnippet: null, toAddr: 'b@x.com', subject: 'Re: Q2', draftText: '',
    modelUsed: 'm', escalated: true, escalationReason: 'needs a human',
  });
  const sent = await store.createDraft({
    robotId: r.id, orgId: 'o-ny', inboundMessageId: '<s@m>', inboundFrom: 'c@x.com', inboundName: null,
    inboundSubject: 'Q3', inboundSnippet: null, toAddr: 'c@x.com', subject: 'Re: Q3', draftText: 'done',
    modelUsed: 'm', escalated: false, escalationReason: null,
  });
  await store.markDraftStatus(sent.id, 'o-ny', 'sent', Date.now());

  const needs = await store.listNeedsYouDrafts('o-ny');
  const statuses = needs.map((d) => d.status).sort();
  assert.deepEqual(statuses, ['escalated', 'pending']); // both surface; sent excluded
  assert.equal(await store.countPendingDrafts('o-ny'), 2); // badge counts escalated too
});

test('snooze leaves "needs you", and wakeSnoozedDrafts returns due items', async () => {
  const r = await store.createRobot('o-sz', { name: 'S', role: 'custom' });
  const d = await store.createDraft({
    robotId: r.id, orgId: 'o-sz', inboundMessageId: '<z@m>', inboundFrom: 'a@x.com', inboundName: null,
    inboundSubject: 'Later', inboundSnippet: null, toAddr: 'a@x.com', subject: 'Re', draftText: 'x',
    modelUsed: 'm', escalated: false, escalationReason: null,
  });
  await store.snoozeDraft(d.id, 'o-sz', Date.now() - 1000); // already due
  assert.equal((await store.listNeedsYouDrafts('o-sz')).length, 0); // snoozed → not in needs you
  await store.wakeSnoozedDrafts();
  assert.equal((await store.listNeedsYouDrafts('o-sz')).length, 1); // due → back to pending
});

test('forward allowlist gates who a robot may forward to', async () => {
  assert.equal(await store.isAllowedForwardTarget('o-fwd', 'boss@co.com'), false);
  const t = await store.addForwardTarget('o-fwd', 'boss@co.com', 'Boss');
  assert.equal(await store.isAllowedForwardTarget('o-fwd', 'BOSS@co.com'), true); // case-insensitive
  assert.equal(await store.isAllowedForwardTarget('o-fwd', 'stranger@x.com'), false);
  await store.deleteForwardTarget('o-fwd', t.id);
  assert.equal(await store.isAllowedForwardTarget('o-fwd', 'boss@co.com'), false);
});

test('learned rules: CRUD + injected into the reply prompt (the learning loop)', async () => {
  const r = await store.createRobot('o-rules', { name: 'PA', role: 'personal_assistant' });
  const rule = await store.createRule('o-rules', r.id, 'meeting requests', 'accept Tue/Thu and propose a time');
  assert.equal(rule.pattern, 'meeting requests');
  assert.deepEqual((await store.listActiveRules(r.id)).map((x) => x.instruction), ['accept Tue/Thu and propose a time']);

  // the engine grounds on the rule + is told not to re-escalate a covered email
  const sys = reply.buildSystem({ ...r } as any, [{ pattern: rule.pattern, instruction: rule.instruction }]);
  assert.match(sys, /STANDING RULES/);
  assert.match(sys, /meeting requests/);
  assert.match(sys, /do NOT escalate/i);

  await store.deleteRule('o-rules', rule.id);
  assert.equal((await store.listActiveRules(r.id)).length, 0);
});

test('buildSystem injects persona/knowledge/escalation + locks the recipient + demands JSON', () => {
  const robot: any = {
    id: 'x', orgId: 'o1', name: 'CS', role: 'customer_service', status: 'active', autonomy: 'ask',
    model: 'arksai-max', lastPolledAt: null, createdAt: 0, updatedAt: 0,
    config: { persona: 'Warm and brief', knowledge: 'We ship in 3 days', escalateOn: 'refunds', signature: '— Acme' },
  };
  const sys = reply.buildSystem(robot);
  assert.match(sys, /Warm and brief/);
  assert.match(sys, /We ship in 3 days/);
  assert.match(sys, /refunds/);
  assert.match(sys, /only to the original sender/i);
  assert.match(sys, /STRICT JSON/);
  assert.match(sys, /— Acme/);
});

test('buildSystem folds a department persona into a specialist (custom + dept)', () => {
  const robot: any = {
    id: 'x', orgId: 'o1', name: 'Finance Agent', role: 'custom', status: 'active', autonomy: 'ask',
    model: 'arksai-max', lastPolledAt: null, createdAt: 0, updatedAt: 0, mailboxReady: true,
    config: { dept: 'finance', mandate: 'Keep the model current', persona: 'Keep the model current' },
  };
  const sys = reply.buildSystem(robot);
  assert.match(sys, /DOMAIN EXPERTISE \(finance\)/);
  assert.match(sys, /FP&A/); // the finance persona text
  // A plain customer_service robot has no department fold.
  const cs: any = { ...robot, role: 'customer_service', config: { knowledge: 'x' } };
  assert.doesNotMatch(reply.buildSystem(cs), /DOMAIN EXPERTISE/);
});

test('a newly created robot is mailbox-less until one is connected', async () => {
  const r = await store.createRobot('o1', { name: 'NeedsBox', role: 'customer_service' });
  const fetched = await store.getRobot(r.id, 'o1');
  assert.equal(fetched?.mailboxReady, false);
});

test('parseReplyJson handles clean JSON, fenced JSON, and bare prose', () => {
  const a = reply.parseReplyJson('{"escalate": false, "reason": "", "reply": "Hello there"}');
  assert.equal(a?.escalate, false);
  assert.equal(a?.text, 'Hello there');

  const b = reply.parseReplyJson('```json\n{"escalate": true, "reason": "refund", "reply": ""}\n```');
  assert.equal(b?.escalate, true);
  assert.equal(b?.reason, 'refund');

  const c = reply.parseReplyJson('Here is the reply: thanks for reaching out!');
  assert.equal(c?.escalate, false);
  assert.match(c?.text || '', /thanks for reaching out/);
});

// ---- reply lanes: every robot model id drafts on ModelArk chat/completions ----

const csRobot = (model: string): any => ({
  id: 'lane', orgId: 'o1', name: 'CS', role: 'customer_service', status: 'active', autonomy: 'ask',
  model, lastPolledAt: null, createdAt: 0, updatedAt: 0, config: { knowledge: 'We ship in 3 days.' },
});
const inboundMsg: any = {
  uid: 1, seq: 1, from: 'cust@x.com', fromName: 'Cust', to: 'support@acme.test', subject: 'Shipping?',
  date: '', messageId: '<m1@x>', snippet: 'How long does shipping take?', text: 'How long does shipping take?',
};

/** Stub ModelArk: record each chat/completions body; `respond(body, n)` → the assistant content
 *  (a string) or an HTTP status to fail with. */
async function withArkStub<T>(respond: (body: any, n: number) => string | number, fn: (calls: { url: string; body: any }[]) => Promise<T>): Promise<T> {
  const realFetch = globalThis.fetch;
  const calls: { url: string; body: any }[] = [];
  globalThis.fetch = (async (url: any, init: any) => {
    const body = JSON.parse(init.body);
    calls.push({ url: String(url), body });
    const r = respond(body, calls.length);
    if (typeof r === 'number') return new Response(JSON.stringify({ error: { message: 'upstream unavailable' } }), { status: r });
    return new Response(JSON.stringify({ choices: [{ message: { content: r }, finish_reason: 'stop' }] }), { status: 200 });
  }) as any;
  __setByteplusKeyForTest('ark-test');
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = realFetch;
    __setByteplusKeyForTest('');
  }
}

const json = (reply: string, escalate = false) => JSON.stringify({ escalate, reason: escalate ? 'refund' : '', reply });
const chatUrl = () => `${config.byteplusBaseUrl.replace(/\/$/, '')}/chat/completions`;

test('reply lane arksai-max: ONE ModelArk call on the Max lane model, thinking off, system + one inbound message', async () => {
  await withArkStub(() => json('We ship in 3 days.'), async (calls) => {
    const out = await reply.draftReply(csRobot('arksai-max'), inboundMsg, new AbortController().signal);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, chatUrl());
    const b = calls[0].body;
    assert.equal(b.model, config.modelarkModels['arksai-max'].model);
    assert.deepEqual(b.thinking, { type: 'disabled' });
    assert.equal(b.max_tokens, 1200);
    assert.equal(b.messages[0].role, 'system');
    assert.match(b.messages[0].content, /STRICT JSON/);
    assert.equal(b.messages[1].role, 'user');
    assert.match(b.messages[1].content, /How long does shipping take\?/);
    assert.equal(out.primary.text, 'We ship in 3 days.');
    assert.equal(out.primary.model, 'arksai-max');
    assert.equal(out.primary.escalate, false);
    assert.equal(out.alt, undefined);
  });
});

test('reply lane deepseek-v4: ONE call on DeepSeek-V4-Pro, labelled deepseek-v4', async () => {
  await withArkStub(() => json('', true), async (calls) => {
    const out = await reply.draftReply(csRobot('deepseek-v4'), inboundMsg, new AbortController().signal);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, chatUrl());
    assert.equal(calls[0].body.model, reply.DEEPSEEK_REPLY_MODEL);
    assert.equal(reply.DEEPSEEK_REPLY_MODEL, 'deepseek-v4-pro-ga-260813');
    assert.deepEqual(calls[0].body.thinking, { type: 'disabled' });
    assert.equal(out.primary.model, 'deepseek-v4');
    assert.equal(out.primary.escalate, true);
    assert.equal(out.primary.reason, 'refund');
  });
});

test('reply lane compare: Max lane + a DIFFERENT model (GLM-5.2) — Max is primary, GLM-5.2 the alt', async () => {
  // Defaults: the Max lane resolves to DeepSeek-V4-Pro, the alt lane to GLM-5.2 — two distinct
  // concrete models, so the bake-off is an actual comparison (not the same model twice).
  assert.equal(reply.compareAltModel(), 'glm-5-2-260617');
  assert.notEqual(reply.replyLane('alt').model, reply.replyLane('max').model);
  const maxModel = config.modelarkModels['arksai-max'].model;
  await withArkStub((b) => json(b.model === 'glm-5-2-260617' ? 'from glm' : 'from max'), async (calls) => {
    const out = await reply.draftReply(csRobot('compare'), inboundMsg, new AbortController().signal);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls.map((c) => c.body.model).sort(), [maxModel, 'glm-5-2-260617'].sort());
    for (const c of calls) {
      assert.equal(c.url, chatUrl());
      assert.deepEqual(c.body.thinking, { type: 'disabled' }, 'thinking is off on BOTH lanes');
    }
    assert.equal(out.primary.model, 'arksai-max');
    assert.equal(out.primary.text, 'from max');
    assert.equal(out.alt?.model, 'glm-5.2', 'the alt draft is labelled with the model that actually ran');
    assert.equal(out.alt?.text, 'from glm');
  });
  // A failed lane is never a silent empty reply: it becomes an escalated draft, and the
  // other lane's draft still rides along for the human.
  await withArkStub((b) => (b.model === maxModel ? 503 : json('from glm')), async (calls) => {
    const out = await reply.draftReply(csRobot('compare'), inboundMsg, new AbortController().signal);
    assert.equal(calls.length, 2);
    assert.equal(out.primary.model, 'arksai-max');
    assert.equal(out.primary.escalate, true);
    assert.match(out.primary.reason, /^Draft failed: HTTP 503/);
    assert.equal(out.alt?.text, 'from glm');
  });
});

test('reply lane compare: runs SINGLE-lane when both lanes resolve to the same concrete model', async () => {
  // Max lane pointed at GLM-5.2 (e.g. ARK_MAX_MODEL) → the alt lane would be the same model:
  // ONE call, no alt draft, no double cost.
  const lane = config.modelarkModels['arksai-max'];
  const saved = lane.model;
  lane.model = 'glm-5-2-260617';
  try {
    await withArkStub(() => json('only max'), async (calls) => {
      const out = await reply.draftReply(csRobot('compare'), inboundMsg, new AbortController().signal);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].body.model, 'glm-5-2-260617');
      assert.equal(out.primary.model, 'arksai-max');
      assert.equal(out.primary.text, 'only max');
      assert.equal(out.alt, undefined);
    });
  } finally {
    lane.model = saved;
  }
  // Same rule for the env override of the alt lane.
  const savedEnv = process.env.ARK_REPLY_ALT_MODEL;
  process.env.ARK_REPLY_ALT_MODEL = config.modelarkModels['arksai-max'].model;
  try {
    await withArkStub(() => json('only max'), async (calls) => {
      const out = await reply.draftReply(csRobot('compare'), inboundMsg, new AbortController().signal);
      assert.equal(calls.length, 1);
      assert.equal(out.alt, undefined);
    });
  } finally {
    if (savedEnv === undefined) delete process.env.ARK_REPLY_ALT_MODEL;
    else process.env.ARK_REPLY_ALT_MODEL = savedEnv;
  }
});

test('reply lane compare: ARK_REPLY_ALT_MODEL overrides the alt model, and its label names it', async () => {
  const savedEnv = process.env.ARK_REPLY_ALT_MODEL;
  process.env.ARK_REPLY_ALT_MODEL = 'kimi-k3-test-260101';
  try {
    assert.deepEqual(reply.replyLane('alt'), { label: 'kimi-k3-test-260101', model: 'kimi-k3-test-260101' });
    await withArkStub((b) => json(b.model === 'kimi-k3-test-260101' ? 'from kimi' : 'from max'), async (calls) => {
      const out = await reply.draftReply(csRobot('compare'), inboundMsg, new AbortController().signal);
      assert.equal(calls.length, 2);
      assert.ok(calls.some((c) => c.body.model === 'kimi-k3-test-260101'));
      assert.equal(out.alt?.model, 'kimi-k3-test-260101');
      assert.equal(out.alt?.text, 'from kimi');
    });
  } finally {
    if (savedEnv === undefined) delete process.env.ARK_REPLY_ALT_MODEL;
    else process.env.ARK_REPLY_ALT_MODEL = savedEnv;
  }
});

test('reply lanes: prose replies are kept as text; no key → escalate without any network call', async () => {
  await withArkStub(() => 'Thanks — it ships in 3 days.', async () => {
    const out = await reply.draftReply(csRobot('arksai-max'), inboundMsg, new AbortController().signal);
    assert.equal(out.primary.text, 'Thanks — it ships in 3 days.');
    assert.equal(out.primary.escalate, false);
  });
  const realFetch = globalThis.fetch;
  let called = 0;
  globalThis.fetch = (async () => {
    called++;
    return new Response('{}');
  }) as any;
  __setByteplusKeyForTest('');
  try {
    assert.equal(reply.replyModelAvailable(), false);
    for (const m of ['arksai-max', 'deepseek-v4', 'compare']) {
      const out = await reply.draftReply(csRobot(m), inboundMsg, new AbortController().signal);
      assert.equal(out.primary.model, 'none');
      assert.equal(out.primary.escalate, true);
    }
    const regen = await reply.regenerateDraft(csRobot('arksai-max'), { inboundFrom: 'c@x.com', inboundName: null, inboundSubject: 's', inboundBody: 'b', inboundSnippet: 'b' }, 'decline politely', new AbortController().signal);
    assert.equal(regen.model, 'none');
    assert.equal(called, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('regenerateDraft: the human direction rides the system prompt; deepseek-v4 keeps its lane, compare redrafts on Max', async () => {
  const draft = { inboundFrom: 'c@x.com', inboundName: 'C', inboundSubject: 'Refund?', inboundBody: 'Can I get a refund?', inboundSnippet: 'Can I get a refund?' };
  await withArkStub(() => json('Happy to help with that refund.'), async (calls) => {
    const ds = await reply.regenerateDraft(csRobot('deepseek-v4'), draft, 'offer store credit instead', new AbortController().signal);
    assert.equal(calls[0].body.model, reply.DEEPSEEK_REPLY_MODEL);
    assert.match(calls[0].body.messages[0].content, /offer store credit instead/);
    assert.match(calls[0].body.messages[1].content, /Can I get a refund\?/);
    assert.equal(ds.model, 'deepseek-v4');
    const cmp = await reply.regenerateDraft(csRobot('compare'), draft, 'be brief', new AbortController().signal);
    assert.equal(calls.length, 2, 'a regenerate is ONE call, even for compare robots');
    assert.equal(calls[1].body.model, config.modelarkModels['arksai-max'].model);
    assert.equal(cmp.model, 'arksai-max');
    assert.equal(cmp.text, 'Happy to help with that refund.');
  });
});
