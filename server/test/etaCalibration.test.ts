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
