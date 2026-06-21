import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSystemPrompt } from '../src/agent/prompts';

const reportSession = { id: 's', mode: 'report', task: null, model: 'arksai-auto', orgId: null, projectId: null } as any;
const codeSession = { id: 's', mode: 'code', task: null, model: 'arksai-auto', orgId: null, projectId: null } as any;

test('report prompt enforces an explicit English / single-output-language rule', () => {
  const p = buildSystemPrompt(reportSession, '/tmp', '');
  assert.match(p, /OUTPUT LANGUAGE/);
  assert.match(p, /English/);
  // steers away from stray Chinese / other-script leakage
  assert.match(p, /Chinese|foreign-script/i);
});

test('report prompt: natural flow, ≥60% page fill, no stranded headings or orphan lines', () => {
  const p = buildSystemPrompt(reportSession, '/tmp', '');
  // natural flow (NOT forced section breaks) + the ≥60% page-fill floor
  assert.match(p, /NATURAL FLOW/);
  assert.match(p, /60%/);
  // anti-orphan heading mechanic + orphan/widow line control
  assert.match(p, /\.lede/);
  assert.match(p, /orphans|widows/i);
  // no stranded heading / no orphan line guidance present
  assert.match(p, /STRANDED HEADING/i);
});

test('report prompt still carries the hard-won page-mechanics rules (none dropped in the trim)', () => {
  const p = buildSystemPrompt(reportSession, '/tmp', '');
  assert.match(p, /\.lede/); // anti-orphan heading mechanic
  assert.match(p, /\.bleed/); // full-bleed page mechanic
  assert.match(p, /break-inside:\s*avoid/i); // atomic visuals
  assert.match(p, /WHITE FRAME/); // the bleed defect rule
  assert.match(p, /render_chart/); // charts go through the tool
  assert.match(p, /@page/); // margins on @page
});

test('code prompt also carries a single-output-language steer', () => {
  const p = buildSystemPrompt(codeSession, '/tmp', '');
  assert.match(p, /Write all output text in English/);
});
