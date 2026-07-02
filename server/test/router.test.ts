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

// --- BytePlus / Dola "Swift" fast lane (config-gated) ---
import { resolveProvider, byteplusReady } from '../src/agent/router';
import { SWIFT_MODEL } from '../../shared/types';
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
    // heavy code + report still go to M3 even with the key
    assert.equal(selectModel('architect a distributed microservice platform with a database schema', 'code', { minimaxAvailable: true }).model, MAX_MODEL);
    assert.equal(selectModel('summarize this', 'report', { minimaxAvailable: true }).model, MAX_MODEL);
    // a light CHAT turn is not a build → still Flash, never Swift
    assert.equal(selectModel('rename a file', 'chat', { minimaxAvailable: true }).model, FAST_MODEL);
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
  for (const [branded, apiModel] of Object.entries(config.byteplusHeavyModels)) {
    const r = resolveProvider(branded);
    assert.equal(r.provider, 'byteplus', `${branded} → byteplus`);
    assert.equal(r.apiModel, apiModel, `${branded} → ${apiModel}`);
    assert.equal(r.pricingId, branded); // priced/labelled under the branded id
  }
});
