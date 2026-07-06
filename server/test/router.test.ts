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

test('selectModel: light → Flash, everything else → M3 (all MiniMax)', () => {
  const easy = selectModel('rename a file', 'chat', { minimaxAvailable: true });
  assert.equal(easy.model, FAST_MODEL);

  const heavy = selectModel('architect a full-stack microservice platform', 'code', { minimaxAvailable: true });
  assert.equal(heavy.model, MAX_MODEL);

  // code/report always go to M3 regardless of tier
  const report = selectModel('summarize this', 'report', { minimaxAvailable: true });
  assert.equal(report.model, MAX_MODEL);
});

test('escalateModel: Flash steps up to M3 and M3 is the cap', () => {
  assert.equal(escalateModel(FAST_MODEL, { minimaxAvailable: true }), MAX_MODEL);
  assert.equal(escalateModel(MAX_MODEL, { minimaxAvailable: true }), MAX_MODEL);
});

// Operator decision (2026-07-02): coding is ALL-BytePlus — M3 removed from code routing entirely.
test('coding removes M3 completely: standard + heavy code → GLM-5.1; Swift escalates to GLM-5.1', () => {
  try {
    __setByteplusKeyForTest('ark-test');
    // standard-tier code (no heavy keywords, no easy keywords) → GLM-5.1, not M3
    const std = selectModel('build a booking website for a dental clinic with an availability calendar', 'code', { minimaxAvailable: true });
    assert.equal(std.model, HEAVY_GLM51_MODEL, `standard code routed to ${std.model}`);
    // escalation from the fast lane stays inside BytePlus
    assert.equal(escalateModel(SWIFT_MODEL, { minimaxAvailable: true }), HEAVY_GLM51_MODEL);
    // GLM-5.1 is the coding cap (no escalation to M3)
    assert.equal(escalateModel(HEAVY_GLM51_MODEL, { minimaxAvailable: true }), HEAVY_GLM51_MODEL);
    // report mode still uses M3
    assert.equal(selectModel('summarize this', 'report', { minimaxAvailable: true }).model, MAX_MODEL);
  } finally {
    __setByteplusKeyForTest('');
  }
  // without a BytePlus key, coding falls back to M3 (the product still works)
  assert.equal(selectModel('build a booking website for a dental clinic with an availability calendar', 'code', { minimaxAvailable: true }).model, MAX_MODEL);
  assert.equal(escalateModel(SWIFT_MODEL, { minimaxAvailable: true }), MAX_MODEL);
});

// --- BytePlus / Dola "Swift" fast lane (config-gated) ---
import { resolveProvider, byteplusReady } from '../src/agent/router';
import { SWIFT_MODEL, HEAVY_GLM51_MODEL } from '../../shared/types';
import { config } from '../src/config';
import { __setByteplusKeyForTest } from '../src/agent/byteplusRuntime';

test('Swift fast lane: light CODE build routes to Dola ONLY when BytePlus is configured', () => {
  
  try {
    __setByteplusKeyForTest(''); // no key → unchanged behaviour (stays M3)
    assert.equal(byteplusReady(), false);
    assert.equal(selectModel('a simple counter app', 'code', { minimaxAvailable: true }).model, MAX_MODEL);

    __setByteplusKeyForTest('ark-test'); // key present → light code goes to Swift
    assert.equal(byteplusReady(), true);
    assert.equal(selectModel('a simple counter app', 'code', { minimaxAvailable: true }).model, SWIFT_MODEL);
    // heavy code → GLM-5.1 with the key (bake-off-validated); report stays on M3
    assert.equal(selectModel('architect a distributed microservice platform with a database schema', 'code', { minimaxAvailable: true }).model, HEAVY_GLM51_MODEL);
    assert.equal(selectModel('summarize this', 'report', { minimaxAvailable: true }).model, MAX_MODEL);
    // CHAT light/standard → Swift (seed-2-0-pro): the 2026-07-02 judgment bake-off winner
    // (the only model that didn't hallucinate "I can't create images"; best repeat-error
    // diagnosis; fastest). Without the key it stays Flash.
    assert.equal(selectModel('rename a file', 'chat', { minimaxAvailable: true }).model, SWIFT_MODEL);
    __setByteplusKeyForTest('');
    assert.equal(selectModel('rename a file', 'chat', { minimaxAvailable: true }).model, FAST_MODEL);
    __setByteplusKeyForTest('ark-test');
  } finally {
    __setByteplusKeyForTest('');
  }
});

test('resolveProvider maps Swift to the byteplus provider + coding model; escalates to M3', () => {
  const r = resolveProvider(SWIFT_MODEL);
  assert.equal(r.provider, 'byteplus');
  assert.equal(r.apiModel, config.byteplusModel);
  assert.equal(r.pricingId, SWIFT_MODEL);
  assert.equal(escalateModel(SWIFT_MODEL, { minimaxAvailable: true }), MAX_MODEL);
  // MiniMax ids stay on minimax
  assert.equal(resolveProvider(MAX_MODEL).provider, 'minimax');
  assert.equal(resolveProvider(FAST_MODEL).provider, 'minimax');
});

test('resolveProvider maps heavy-tier BytePlus coders to the concrete coding-plan model', () => {
  for (const [branded, spec] of Object.entries(config.byteplusHeavyModels)) {
    const r = resolveProvider(branded);
    assert.equal(r.provider, 'byteplus', `${branded} → byteplus`);
    assert.equal(r.apiModel, spec.model, `${branded} → ${spec.model}`);
    assert.equal(r.pricingId, branded); // priced/labelled under the branded id
    assert.equal(r.baseUrl, spec.base); // per-model endpoint override (undefined = provider default)
  }
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

test('spreadsheet-deliverable briefs route to Swift (bake-off round 2); app briefs do not', async () => {
  const { selectModel, isSpreadsheetBrief } = await import('../src/agent/router');
  const { SWIFT_MODEL } = await import('../../shared/types');
  const { __setByteplusKeyForTest } = await import('../src/agent/byteplusRuntime');
  __setByteplusKeyForTest('test-key');
  const o = { minimaxAvailable: true };
  // A pure model brief — even a long, heavy-scoring one — goes to the Swift lane.
  const brief =
    'Build a 24-month financial model spreadsheet for a Dubai coffee roastery: Assumptions, Revenue, Opex, PnL sheets, ' +
    'compounding growth, cross-sheet formulas, IF-gated tax, cumulative cash. All derived cells live formulas.';
  assert.ok(isSpreadsheetBrief(brief));
  assert.equal(selectModel(brief, 'code', o).model, SWIFT_MODEL);
  // Deliverable guards: an app that mentions excel, or subsystem-scale briefs, stay on normal routing.
  assert.ok(!isSpreadsheetBrief('build a SaaS dashboard app with excel export and JWT auth'));
  assert.ok(!isSpreadsheetBrief('a landing page for my excel consultancy'));
  assert.ok(!isSpreadsheetBrief('multi-tenant billing workbook system with oauth'), 'oauth still blocks');
  // Live bug: "36 monthly payments" tripped the payments SUBSYSTEM guard → Heavy lane.
  assert.ok(isSpreadsheetBrief('Build a loan amortization spreadsheet: AED 500,000 loan, 8% annual interest, 36 monthly payments. Fully formula-driven workbook with a payment schedule and totals.'));
  assert.ok(!isSpreadsheetBrief('write me a poem'));
});
