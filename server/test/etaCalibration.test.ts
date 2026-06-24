import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { estimateRemainingSeconds } from '../../shared/types';

// Throwaway data dir set BEFORE config is read (etaCalibration imports config at load).
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-eta-'));
let E: typeof import('../src/agent/etaCalibration');
before(async () => {
  E = await import('../src/agent/etaCalibration');
});

test('a calibrated `typical` overrides the static heuristic (and the mode scale)', () => {
  const base = estimateRemainingSeconds('building', 0, 'code');
  const cal = estimateRemainingSeconds('building', 0, 'code', { building: 999 });
  assert.ok(cal > base); // a learned 999s building dominates the ~140s prior
  // calibrated value is used as-is, not multiplied by the report scale
  assert.ok(estimateRemainingSeconds('building', 0, 'report', { building: 200 }) >= 200);
});

test('untrained mode → undefined, so the caller keeps the static prior', () => {
  assert.equal(E.calibratedTypical('code'), undefined);
});

test('a phase is only trusted after MIN_SAMPLES runs', () => {
  E.recordRunDurations('code', { building: 100, verifying: 30 });
  E.recordRunDurations('code', { building: 120, verifying: 30 });
  assert.equal(E.calibratedTypical('code'), undefined); // 2 < 3 samples
  E.recordRunDurations('code', { building: 110, verifying: 30 });
  const t = E.calibratedTypical('code')!;
  assert.ok(t && t.building! > 90 && t.building! < 130);
  assert.ok(t.verifying! > 20 && t.verifying! < 40);
});

test('EWMA tracks a real shift and survives a cache reset (persisted)', () => {
  for (let i = 0; i < 6; i++) E.recordRunDurations('report', { building: 300 });
  const before = E.calibratedTypical('report')!.building!;
  for (let i = 0; i < 6; i++) E.recordRunDurations('report', { building: 600 });
  const after = E.calibratedTypical('report')!.building!;
  assert.ok(after > before); // moved toward the new, slower reality
  E._resetEtaCalibrationCache();
  assert.ok(E.calibratedTypical('report')!.building); // reloaded from disk, not memory
});

test('outliers and sub-second blips are ignored', () => {
  E.recordRunDurations('chat', { building: 0.1 }); // < MIN_SEC
  E.recordRunDurations('chat', { building: 99999 }); // > MAX_SEC
  assert.equal(E.calibratedTypical('chat'), undefined); // nothing recorded
});

test('a (mode, task) bucket gives a more specific estimate than the mode aggregate', () => {
  // A slow task in `code`: a multi-sheet financial model.
  for (let i = 0; i < 3; i++) E.recordRunDurations('code', { building: 300 }, 'finance.cashflow');
  // A fast task in the same mode: a quick tweak.
  for (let i = 0; i < 3; i++) E.recordRunDurations('code', { building: 20 }, 'misc.tweak');
  const slow = E.calibratedTypical('code', 'finance.cashflow')!;
  const fast = E.calibratedTypical('code', 'misc.tweak')!;
  assert.ok(slow.building! > 250, `slow task ~300s, got ${slow.building}`);
  assert.ok(fast.building! < 60, `fast task ~20s, got ${fast.building}`);
  assert.ok(slow.building! > fast.building! * 3); // genuinely distinguished
});

test('a task with too few samples falls back to the mode aggregate, per phase', () => {
  // Isolated mode so no other test has seeded its aggregate.
  // Build a trusted mode aggregate for `verifying` only (the bare-mode bucket).
  for (let i = 0; i < 4; i++) E.recordRunDurations('isolmode', { verifying: 40 });
  // A brand-new task with only ONE building sample (< MIN_SAMPLES): its building isn't
  // trusted yet AND the mode aggregate has no building, so building is omitted entirely;
  // verifying is filled from the mode aggregate.
  E.recordRunDurations('isolmode', { building: 500 }, 'rare.deck');
  const t = E.calibratedTypical('isolmode', 'rare.deck')!;
  assert.equal(t.building, undefined); // neither the task (1 sample) nor the mode has trusted building
  assert.ok(t.verifying! > 30 && t.verifying! < 50); // inherited from the mode aggregate
});

test('recording a task also improves the mode aggregate (broad prior keeps learning)', () => {
  for (let i = 0; i < 3; i++) E.recordRunDurations('plan', { understanding: 15 }, 'sales.battlecard');
  // The bare-mode lookup sees the aggregate built up purely from task-tagged runs.
  const agg = E.calibratedTypical('plan');
  assert.ok(agg && agg.understanding! > 5);
});

test('an old file keyed by bare mode still reads as the mode aggregate', () => {
  for (let i = 0; i < 3; i++) E.recordRunDurations('code', { polishing: 18 }); // no task
  assert.ok(E.calibratedTypical('code')!.polishing! > 10);
  // and a task lookup in that mode inherits it
  assert.ok(E.calibratedTypical('code', 'never.seen')!.polishing! > 10);
});
