import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ToolCtx } from '../src/agent/tools/common';
import { switchModeTool } from '../src/agent/tools/mode';

function ctx(mode: any, onSwitch?: (m: any) => void): ToolCtx {
  return {
    session: { id: 's1', mode } as any,
    repoDir: '/tmp',
    mode,
    signal: new AbortController().signal,
    addCost: () => {},
    requestModeSwitch: onSwitch,
  };
}

test('switch_mode is available in all four modes', () => {
  assert.deepEqual([...switchModeTool.modes].sort(), ['chat', 'code', 'plan', 'report']);
});

test('switch_mode triggers the runner callback and reports the new mode', async () => {
  let asked: string | null = null;
  const res = await switchModeTool.run({ mode: 'code' }, ctx('chat', (m) => (asked = m)));
  assert.equal(asked, 'code');
  assert.match(res, /Build \(Code\)/);
  assert.doesNotMatch(res, /^Error/);
});

test('switch_mode no-ops when already in the target mode', async () => {
  let asked = false;
  const res = await switchModeTool.run({ mode: 'chat' }, ctx('chat', () => (asked = true)));
  assert.equal(asked, false);
  assert.match(res, /Already in/);
});

test('switch_mode rejects an unknown mode', async () => {
  const res = await switchModeTool.run({ mode: 'turbo' }, ctx('chat', () => {}));
  assert.match(res, /^Error/);
});

test('switch_mode errors when the run cannot switch (no callback)', async () => {
  const res = await switchModeTool.run({ mode: 'report' }, ctx('chat'));
  assert.match(res, /^Error/);
});
