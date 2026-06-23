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
