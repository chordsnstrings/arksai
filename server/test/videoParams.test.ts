import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeVideoParams } from '../src/engines/minimax';

test('video params: defaults to 6s / 1080P', () => {
  assert.deepEqual(normalizeVideoParams({}), { duration: 6, resolution: '1080P', aspect_ratio: undefined });
});

test('video params: 10s forces 768P (1080P is 6s-only — validated live)', () => {
  assert.equal(normalizeVideoParams({ duration: 10, resolution: '1080P' }).resolution, '768P');
  assert.equal(normalizeVideoParams({ duration: 10 }).resolution, '768P');
});

test('video params: 6s + 1080P is kept', () => {
  const p = normalizeVideoParams({ duration: 6, resolution: '1080P' });
  assert.equal(p.duration, 6);
  assert.equal(p.resolution, '1080P');
});

test('video params: an odd duration clamps to 6', () => {
  assert.equal(normalizeVideoParams({ duration: 7 as any }).duration, 6);
});

test('video params: a valid aspect ratio passes, a junk one is dropped', () => {
  assert.equal(normalizeVideoParams({ aspectRatio: '9:16' }).aspect_ratio, '9:16');
  assert.equal(normalizeVideoParams({ aspectRatio: 'portrait' }).aspect_ratio, undefined);
});
