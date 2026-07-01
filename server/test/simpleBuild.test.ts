import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSimpleBuild, simpleBuildGuidance, simpleBuildNudge, SIMPLE_BUILD_NUDGE_AT } from '../src/agent/simpleBuild';
import type { TaskProfile } from '../src/agent/taskProfile';

const prof = (tier: 'light' | 'standard' | 'heavy', isVisual = true): TaskProfile => ({ type: 'web-app', isVisual, tier });

test('isSimpleBuild: only light-tier CODE builds take the fast path', () => {
  assert.equal(isSimpleBuild(prof('light'), 'code'), true);
  assert.equal(isSimpleBuild(prof('standard'), 'code'), false);
  assert.equal(isSimpleBuild(prof('heavy'), 'code'), false);
  // not in chat/plan/report — only the build mode
  assert.equal(isSimpleBuild(prof('light'), 'chat'), false);
  assert.equal(isSimpleBuild(prof('light'), 'report'), false);
  assert.equal(isSimpleBuild(undefined, 'code'), false);
});

test('guidance tells the model to keep it simple and stop', () => {
  const g = simpleBuildGuidance();
  assert.match(g, /SIMPLEST/);
  assert.match(g, /ONE screen\/page/);
  assert.match(g, /over-built result for a simple ask is a FAILURE/i);
});

test('the ship nudge is short and directive', () => {
  assert.match(simpleBuildNudge(), /Ship the SIMPLEST working version NOW/);
  assert.ok(SIMPLE_BUILD_NUDGE_AT > 0 && SIMPLE_BUILD_NUDGE_AT < 60);
});
