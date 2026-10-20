import { test } from 'node:test';
import assert from 'node:assert/strict';
import { complexityTier, selectModel, escalateModel } from '../src/agent/router';
import { MAX_MODEL, FAST_MODEL } from '../../shared/types';

test('complexityTier: trivial edits are light', () => {
  assert.equal(complexityTier('fix a typo in the readme', 'code'), 'light'); // easy beats the code +1
  assert.equal(complexityTier('rename this variable', 'chat'), 'light');
  assert.equal(complexityTier('what is a closure?', 'chat'), 'light');
});

test('complexityTier: hard tasks are heavy', () => {
  assert.equal(
    complexityTier('Design and implement a distributed rate-limiting service with a database schema', 'code'),
    'heavy',
  );
  assert.equal(complexityTier('debug this race condition and optimize the algorithm', 'code'), 'heavy');
});

// --- ModelArk lanes (the single provider) ---
import { resolveProvider, stallLadder } from '../src/agent/router';
import { SWIFT_MODEL, HEAVY_GLM51_MODEL, HEAVY_DS4_MODEL, HEAVY_KIMI_MODEL } from '../../shared/types';
import { config } from '../src/config';

test('selectModel: every build → heavy coder; spreadsheets → bounded lane; chat light+standard → Swift; report → Max', () => {
  assert.equal(selectModel('a simple counter app', 'code').model, HEAVY_GLM51_MODEL, 'even simple builds keep full reasoning');
  assert.equal(selectModel('build a booking website for a dental clinic with an availability calendar', 'code').model, HEAVY_GLM51_MODEL);
  assert.equal(selectModel('architect a distributed microservice platform with a database schema', 'code').model, HEAVY_GLM51_MODEL);
  assert.equal(selectModel('summarize this', 'report').model, MAX_MODEL);
  assert.equal(selectModel('rename a file', 'chat').model, SWIFT_MODEL);
  const heavyChat = 'Architect a multi-tenant SaaS: JWT auth, per-org isolation, realtime websocket sync, Stripe billing and an admin dashboard — design the database schema and the security model end to end.';
  assert.equal(complexityTier(heavyChat, 'chat'), 'heavy');
  assert.equal(selectModel(heavyChat, 'chat').model, MAX_MODEL);
  assert.equal(selectModel('rename a file', 'plan').model, FAST_MODEL);
});

test('escalateModel: Swift → heavy coder, Flash → Max; heavy coder and Max are the caps', () => {
  assert.equal(escalateModel(SWIFT_MODEL), HEAVY_GLM51_MODEL);
  assert.equal(escalateModel(FAST_MODEL), MAX_MODEL);
  assert.equal(escalateModel(HEAVY_GLM51_MODEL), HEAVY_GLM51_MODEL);
  assert.equal(escalateModel(MAX_MODEL), MAX_MODEL);
});

test('resolveProvider: every branded lane resolves to its configured ModelArk model + lane settings', () => {
  for (const [branded, spec] of Object.entries(config.modelarkModels)) {
    const r = resolveProvider(branded);
    assert.equal(r.provider, 'modelark');
    assert.equal(r.apiModel, spec.model, `${branded} → ${spec.model}`);
    assert.equal(r.pricingId, branded);
    assert.equal(r.baseUrl, spec.base);
    assert.equal(r.thinking, spec.thinking);
  }
  // Unknown ids fall back to Max rather than throwing.
  const unknown = resolveProvider('arksai-retired-model');
  assert.equal(unknown.pricingId, MAX_MODEL);
  assert.equal(unknown.apiModel, config.modelarkModels[MAX_MODEL].model);
});

test('legacy Kimi lane id stays valid (old DB rows) but runs a model this key can call', () => {
  assert.ok(!/kimi/i.test(resolveProvider(HEAVY_KIMI_MODEL).apiModel), 'Kimi is not on the ModelArk key');
});

test('stallLadder: alternates are other lanes with DIFFERENT concrete models, never the current one', () => {
  for (const current of [MAX_MODEL, FAST_MODEL, SWIFT_MODEL, HEAVY_GLM51_MODEL, HEAVY_DS4_MODEL]) {
    const ladder = stallLadder(current);
    const cur = resolveProvider(current).apiModel;
    const apis = ladder.map((id) => resolveProvider(id).apiModel);
    assert.ok(ladder.length >= 1, `${current} has somewhere to go`);
    assert.ok(!apis.includes(cur), `${current} ladder must not include its own model`);
    assert.equal(new Set(apis).size, apis.length, `${current} ladder has no duplicate models`);
  }
  // The heavy coder hands over to a different coder first.
  assert.equal(resolveProvider(stallLadder(HEAVY_GLM51_MODEL)[0]).apiModel !== resolveProvider(HEAVY_GLM51_MODEL).apiModel, true);
});

test('complexityTier: a subsystem-stacked SaaS brief is HEAVY (the TaskForge mislabel)', () => {
  // The real brief that scored 'standard' ("a moderate task") before subsystem detection.
  const brief =
    'Build a multi-tenant SaaS team task manager, end to end. Requirements: (1) BACKEND: user signup/login with JWT auth; ' +
    'organizations (workspaces) — invite members by generating an invite code; STRICT per-org data isolation. ' +
    '(2) DATA: SQLite; users, orgs, memberships, projects, tasks. (3) FRONTEND: React — auth screens, an org switcher, a task board. (4) Seed a demo org.';
  assert.equal(complexityTier(brief, 'code'), 'heavy');
  // A single subsystem mention in a short ask does not blow up the tier.
  assert.equal(complexityTier('add a login page to my site', 'code'), 'standard');
});

test('spreadsheet-deliverable briefs route to the bounded-reasoning lane (bake-off round 2); app briefs do not', async () => {
  const { selectModel, isSpreadsheetBrief } = await import('../src/agent/router');
  const { HEAVY_DS4_MODEL, HEAVY_GLM51_MODEL } = await import('../../shared/types');
  const o = {};
  // A pure model brief — even a long, heavy-scoring one — goes to the bounded-reasoning sheets lane.
  const brief =
    'Build a 24-month financial model spreadsheet for a Dubai coffee roastery: Assumptions, Revenue, Opex, PnL sheets, ' +
    'compounding growth, cross-sheet formulas, IF-gated tax, cumulative cash. All derived cells live formulas.';
  assert.ok(isSpreadsheetBrief(brief));
  assert.equal(selectModel(brief, 'code', o).model, HEAVY_DS4_MODEL);
  assert.equal(selectModel('build a SaaS dashboard app with excel export and JWT auth', 'code', o).model, HEAVY_GLM51_MODEL);
  // Deliverable guards: an app that mentions excel, or subsystem-scale briefs, stay on normal routing.
  assert.ok(!isSpreadsheetBrief('build a SaaS dashboard app with excel export and JWT auth'));
  assert.ok(!isSpreadsheetBrief('a landing page for my excel consultancy'));
  assert.ok(!isSpreadsheetBrief('multi-tenant billing workbook system with oauth'), 'oauth still blocks');
  // Live bug: "36 monthly payments" tripped the payments SUBSYSTEM guard → Heavy lane.
  assert.ok(isSpreadsheetBrief('Build a loan amortization spreadsheet: AED 500,000 loan, 8% annual interest, 36 monthly payments. Fully formula-driven workbook with a payment schedule and totals.'));
  // "dashboard" no longer excludes when the brief names a spreadsheet deliverable —
  // "an Excel KPI dashboard" is the kpi-dashboard scaffold, not a web app.
  assert.ok(isSpreadsheetBrief('Build me an Excel KPI dashboard tracking revenue vs target and orders month over month'));
  assert.ok(!isSpreadsheetBrief('build a KPI dashboard web app'), 'a web dashboard still routes normally');
  assert.ok(!isSpreadsheetBrief('write me a poem'));
});

test('spreadsheet briefs in CHAT route to the bounded-reasoning lane too — never thinking-off Swift (bake-off 1.25/10)', async () => {
  const { selectModel } = await import('../src/agent/router');
  const { HEAVY_DS4_MODEL, SWIFT_MODEL } = await import('../../shared/types');
  // The chat prompt has the agent call generate_spreadsheet right there in chat.
  const pick = selectModel('Make me an Excel cash flow forecast for my cafe for the next 12 months', 'chat');
  assert.equal(pick.model, HEAVY_DS4_MODEL);
  assert.match(pick.reason, /spreadsheet model/, 'the auto-route line names the reason');
  assert.equal(selectModel('Make me an Excel cash flow forecast for my cafe for the next 12 months', 'code').model, HEAVY_DS4_MODEL);
  // Ordinary chat stays on the quick lane.
  assert.equal(selectModel('what should I name my cafe?', 'chat').model, SWIFT_MODEL);
});
