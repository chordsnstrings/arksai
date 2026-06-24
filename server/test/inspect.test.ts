import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgeInteraction } from '../src/agent/inspect';

const fp = (o: Partial<{ url: string; nodes: number; visible: number; text: number; expanded: number; dialogs: number }> = {}) => ({
  url: 'http://x/', nodes: 100, visible: 40, text: 500, expanded: 0, dialogs: 0, ...o,
});

// The whole point: tell a dead control apart from a working one, deterministically.
test('judgeInteraction: a control that changes nothing → no-effect (the dead-control bug)', () => {
  const v = judgeInteraction(fp(), fp(), false);
  assert.equal(v.effect, 'no-effect');
  assert.match(v.detail, /dead|NOTHING/i);
});

test('judgeInteraction: a control that opens a menu/panel → changed', () => {
  assert.equal(judgeInteraction(fp({ visible: 40, dialogs: 0 }), fp({ visible: 47, dialogs: 1 }), false).effect, 'changed');
  assert.equal(judgeInteraction(fp({ expanded: 0 }), fp({ expanded: 1 }), false).effect, 'changed'); // aria-expanded flipped
  assert.equal(judgeInteraction(fp({ text: 500 }), fp({ text: 540 }), false).effect, 'changed'); // content appeared
});

test('judgeInteraction: navigation is detected (not a dead button)', () => {
  const v = judgeInteraction(fp({ url: 'http://x/' }), fp({ url: 'http://x/about.html' }), false);
  assert.equal(v.effect, 'navigated');
  assert.match(v.detail, /about\.html/);
});

test('judgeInteraction: a click that throws → error', () => {
  assert.equal(judgeInteraction(fp(), fp(), true).effect, 'error');
});

test('judgeInteraction: tiny noise (±1 node) is NOT counted as a real change', () => {
  assert.equal(judgeInteraction(fp({ nodes: 100, visible: 40 }), fp({ nodes: 101, visible: 41 }), false).effect, 'no-effect');
});
