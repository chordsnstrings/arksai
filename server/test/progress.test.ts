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
