import { test } from 'node:test';
import assert from 'node:assert/strict';
import { complexityTier, selectModel, escalateModel } from '../src/agent/router';
import { MAX_MODEL } from '../../shared/types';

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

test('selectModel: tiers map to models, MiniMax used for heavy when available', () => {
  const easy = selectModel('rename a file', 'chat', { minimaxAvailable: true });
  assert.equal(easy.model, 'deepseek-v4-flash');

  const heavyWithMax = selectModel('architect a full-stack microservice platform', 'code', { minimaxAvailable: true });
  assert.equal(heavyWithMax.model, MAX_MODEL);

  const heavyNoMax = selectModel('architect a full-stack microservice platform', 'code', { minimaxAvailable: false });
  assert.equal(heavyNoMax.model, 'deepseek-v4-pro');
});

test('escalateModel: steps up one tier and caps at the top', () => {
  assert.equal(escalateModel('deepseek-v4-flash', { minimaxAvailable: true }), 'deepseek-v4-pro');
  assert.equal(escalateModel('deepseek-v4-pro', { minimaxAvailable: true }), MAX_MODEL);
  assert.equal(escalateModel('deepseek-v4-pro', { minimaxAvailable: false }), 'deepseek-v4-pro');
  assert.equal(escalateModel(MAX_MODEL, { minimaxAvailable: true }), MAX_MODEL);
});
