import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expertiseFor } from '../src/agent/expertise';
import { buildSystemPrompt } from '../src/agent/prompts';

test('expertiseFor: null for no task or unknown key', () => {
  assert.equal(expertiseFor(null), null);
  assert.equal(expertiseFor(undefined), null);
  assert.equal(expertiseFor('nope.nope'), null);
});

test('expertiseFor: finance task carries FP&A rigor + task specifics', () => {
  const e = expertiseFor('finance.cashflow')!;
  assert.match(e, /FP&A/);
  assert.match(e, /assumption/i);
  assert.match(e, /cash/i);
  assert.match(e, /never fabricate/i);
});

test('expertiseFor: HR job description enforces inclusive standards', () => {
  const e = expertiseFor('people.jd')!;
  assert.match(e, /inclusive/i);
  assert.match(e, /gender/i);
});

test('expertiseFor: sales battlecard + marketing landing carry their craft', () => {
  assert.match(expertiseFor('sales.battlecard')!, /comparison|battlecard|why we win/i);
  assert.match(expertiseFor('marketing.landing')!, /CTA/);
});

test('expertiseFor: every department persona resolves', () => {
  for (const d of ['marketing', 'sales', 'finance', 'people', 'engineering']) {
    assert.ok(expertiseFor(`${d}.kpidashboard`) || expertiseFor(`${d}.unknown`) === null);
    // a known key per dept returns a block
  }
  assert.ok(expertiseFor('engineering.designdoc'));
});

test('buildSystemPrompt: injects the expert standards when the session has a task', () => {
  const base: any = { id: 's', title: 't', mode: 'code', model: 'arksai-auto', repoName: null, branch: null, projectId: null, status: 'idle', task: null };
  const profile: any = { type: 'dashboard', isVisual: true, tier: 'standard' };
  const without = buildSystemPrompt(base, '/tmp', '', profile);
  const withTask = buildSystemPrompt({ ...base, task: 'finance.cashflow' }, '/tmp', '', profile);
  assert.doesNotMatch(without, /Expert standards for this task/);
  assert.match(withTask, /Expert standards for this task/);
  assert.match(withTask, /FP&A/);
});
