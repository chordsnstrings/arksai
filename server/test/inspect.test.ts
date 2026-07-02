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

// Doctrine fix (2026-07-02): state flips with NO structural delta must count as "changed" —
// a theme toggle swapping data-theme on <html> was reported dead, sending the builder on a
// many-turn false-positive chase in a real $6 run.
test('judgeInteraction: a theme flip (data-theme/class swap, zero structural delta) → changed', () => {
  const before = { ...fp(), theme: 'light|x|', bg: 'rgb(255,255,255)|rgb(0,0,0)', pressed: 0 };
  const after = { ...fp(), theme: 'dark|x|', bg: 'rgb(255,255,255)|rgb(0,0,0)', pressed: 0 };
  const v = judgeInteraction(before, after, false);
  assert.equal(v.effect, 'changed');
  assert.match(v.detail, /theme|appearance/i);
});

test('judgeInteraction: a computed background/color flip alone → changed', () => {
  const before = { ...fp(), theme: 'x|x|', bg: 'rgb(255,255,255)|rgb(0,0,0)', pressed: 0 };
  const after = { ...fp(), theme: 'x|x|', bg: 'rgb(20,20,20)|rgb(240,240,240)', pressed: 0 };
  assert.equal(judgeInteraction(before, after, false).effect, 'changed');
});

test('judgeInteraction: an aria-pressed toggle flip alone → changed', () => {
  const before = { ...fp(), theme: 'x|x|', bg: 'b|c', pressed: 0 };
  const after = { ...fp(), theme: 'x|x|', bg: 'b|c', pressed: 1 };
  const v = judgeInteraction(before, after, false);
  assert.equal(v.effect, 'changed');
  assert.match(v.detail, /toggle|aria-pressed/i);
});

test('judgeInteraction: the no-effect message now flags the probe-blind-spot escape hatch', () => {
  const v = judgeInteraction(fp(), fp(), false);
  assert.equal(v.effect, 'no-effect');
  assert.match(v.detail, /blind spot|move on/i);
});
