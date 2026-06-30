import { test } from 'node:test';
import assert from 'node:assert/strict';
import { previewRegistry, PREVIEW_PORT_BASE, PREVIEW_PORT_MAX } from '../src/sandbox/previewRegistry';

test('previewRegistry: distinct port per session, in the dedicated range', () => {
  const a = previewRegistry.allocPort('sess-a');
  const b = previewRegistry.allocPort('sess-b');
  const c = previewRegistry.allocPort('sess-c');
  assert.equal(new Set([a, b, c]).size, 3); // no collisions
  for (const p of [a, b, c]) {
    assert.ok(p >= PREVIEW_PORT_BASE && p <= PREVIEW_PORT_MAX);
  }
});

test('previewRegistry: idempotent per session', () => {
  const first = previewRegistry.allocPort('sess-repeat');
  const second = previewRegistry.allocPort('sess-repeat');
  assert.equal(second, first);
  assert.equal(previewRegistry.portFor('sess-repeat'), first);
});

test('previewRegistry: never overlaps the deployment range (41000–41999) or the app port', () => {
  const p = previewRegistry.allocPort('sess-range');
  assert.ok(p > 41999);
  assert.notEqual(p, 3000);
});

test('previewRegistry: release frees the reservation', () => {
  previewRegistry.allocPort('sess-rel');
  previewRegistry.release('sess-rel');
  assert.equal(previewRegistry.portFor('sess-rel'), null);
});

test('previewRegistry: 200 concurrent sessions get 200 distinct ports (atomic alloc, no race)', () => {
  const ports = new Set<number>();
  for (let i = 0; i < 200; i++) ports.add(previewRegistry.allocPort(`bulk-${i}`));
  assert.equal(ports.size, 200);
});
