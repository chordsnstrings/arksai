import { test } from 'node:test';
import assert from 'node:assert/strict';
import { phaseFloor, phaseCeiling, type ProgressPhase } from '../../shared/types';

const ORDER: ProgressPhase[] = [
  'understanding',
  'building',
  'verifying',
  'testing',
  'polishing',
  'publishing',
  'done',
];

test('phaseFloor is monotonic non-decreasing across the phase order', () => {
  let prev = -1;
  for (const p of ORDER) {
    const f = phaseFloor(p);
    assert.ok(f >= prev, `${p} floor ${f} should be >= previous ${prev}`);
    prev = f;
  }
});

test('each phase band has floor <= ceil, within 0..100', () => {
  for (const p of ORDER) {
    const f = phaseFloor(p);
    const c = phaseCeiling(p);
    assert.ok(f >= 0 && c <= 100, `${p} band out of range`);
    assert.ok(f <= c, `${p} floor ${f} should be <= ceil ${c}`);
  }
});

test('understanding starts at 0 and done reaches 100', () => {
  assert.equal(phaseFloor('understanding'), 0);
  assert.equal(phaseFloor('done'), 100);
  assert.equal(phaseCeiling('done'), 100);
});

test("a later phase's floor is >= an earlier phase's ceil (bands do not overlap backward)", () => {
  for (let i = 1; i < ORDER.length; i++) {
    assert.ok(
      phaseFloor(ORDER[i]) >= phaseCeiling(ORDER[i - 1]) - 0.001,
      `${ORDER[i]} floor should be >= ${ORDER[i - 1]} ceil`,
    );
  }
});

test('estimateRemainingSeconds: decreases through phases, counts down within a phase, never negative', async () => {
  const { estimateRemainingSeconds } = await import('../../shared/types');
  // At the start of building (0s elapsed) there's more left than at the start of testing.
  const atBuildStart = estimateRemainingSeconds('building', 0, 'code');
  const atTestStart = estimateRemainingSeconds('testing', 0, 'code');
  assert.ok(atBuildStart > atTestStart, `building ${atBuildStart} should exceed testing ${atTestStart}`);
  // Within a phase, more elapsed → less remaining.
  assert.ok(estimateRemainingSeconds('building', 60, 'code') < atBuildStart);
  // Running long past the phase typical clamps the current-phase part to 0 (never negative).
  assert.ok(estimateRemainingSeconds('building', 9999, 'code') >= 0);
  // 'done' is always 0; report mode (bigger single output) estimates more building time than code.
  assert.equal(estimateRemainingSeconds('done', 0, 'code'), 0);
  assert.ok(estimateRemainingSeconds('building', 0, 'report') > estimateRemainingSeconds('building', 0, 'code'));
});
