import { test } from 'node:test';
import assert from 'node:assert/strict';
import { intakeContext } from '../src/agent/prompts';
import { classifyTask } from '../src/agent/taskProfile';

test('intake: one-round protocol header is always present', () => {
  const s = intakeContext(classifyTask('build a todo web app', 'code'));
  assert.match(s, /Intake \(do this FIRST, once\)/);
  assert.match(s, /ONE message/);
});

test('intake: web-app asks about purpose, features, vibe', () => {
  const s = intakeContext(classifyTask('build a web app for tracking habits', 'code'));
  assert.match(s, /must-have features/);
  assert.match(s, /curated style/);
});

test('intake: api (non-visual) asks about endpoints, not visual style', () => {
  const s = intakeContext(classifyTask('build a REST api for orders', 'code'));
  assert.match(s, /endpoints/);
  assert.doesNotMatch(s, /curated style/);
});

test('intake: generic falls back to a minimal confirm-only protocol', () => {
  const s = intakeContext(classifyTask('do the thing', 'code'));
  assert.match(s, /core goal/);
  assert.match(s, /don't ask/);
});
