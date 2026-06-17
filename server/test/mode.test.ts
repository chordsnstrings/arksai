import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ToolCtx } from '../src/agent/tools/common';
import { switchModeTool, submitPlanTool } from '../src/agent/tools/mode';

function ctx(
  mode: any,
  onSwitch?: (m: any) => void,
  extra?: Partial<ToolCtx>,
): ToolCtx {
  return {
    session: { id: 's1', mode } as any,
    repoDir: '/tmp',
    mode,
    signal: new AbortController().signal,
    addCost: () => {},
    requestModeSwitch: onSwitch,
    ...extra,
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

// ---- Plan approval gate ----

test('plan→code is BLOCKED until the user has responded to a plan', async () => {
  let asked: string | null = null;
  const res = await switchModeTool.run({ mode: 'code' }, ctx('plan', (m) => (asked = m), { planResolved: false }));
  assert.equal(asked, null); // the switch never fired
  assert.match(res, /^Error/);
  assert.match(res, /submit_plan/);
});

test('plan→code is ALLOWED once the run is the user response to a plan', async () => {
  let asked: string | null = null;
  const res = await switchModeTool.run({ mode: 'code' }, ctx('plan', (m) => (asked = m), { planResolved: true }));
  assert.equal(asked, 'code');
  assert.doesNotMatch(res, /^Error/);
});

test('chat→code (one-off file, no plan) is never gated by the plan check', async () => {
  let asked: string | null = null;
  const res = await switchModeTool.run({ mode: 'code' }, ctx('chat', (m) => (asked = m), { planResolved: false }));
  assert.equal(asked, 'code');
  assert.doesNotMatch(res, /^Error/);
});

test('submit_plan signals the runner and ends the turn (plan mode only)', async () => {
  let submitted = false;
  const res = await submitPlanTool.run({}, ctx('plan', undefined, { submitPlan: () => (submitted = true) }));
  assert.equal(submitted, true);
  assert.doesNotMatch(res, /^Error/);

  // outside plan mode it's a no-op error
  let submitted2 = false;
  const res2 = await submitPlanTool.run({}, ctx('code', undefined, { submitPlan: () => (submitted2 = true) }));
  assert.equal(submitted2, false);
  assert.match(res2, /^Error/);
});
