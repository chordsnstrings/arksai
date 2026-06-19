import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSystemPrompt } from '../src/agent/prompts';
import { config } from '../src/config';

// PHASE 5 — progressive disclosure. The system prompt is assembled from a slim
// always-on CORE + on-demand SLICES (Suno / MiniMax / doc-tools / report / design);
// a slice loads ONLY when the current mode needs it, decided once at build time.
//
// HARD GUARANTEE: a REPORT-mode build receives EVERY rule it gets today — the report
// prompt is byte-for-byte equivalent with the flag ON vs OFF. The saving comes from
// NOT loading the capability/tool slices on turns that can't use them (a read-only
// PLAN turn, etc.). These tests PROVE both halves: equivalence where it matters, and
// a real, measured reduction where it's safe.

const reportSession = { id: 's', mode: 'report', task: null, model: 'arksai-auto', orgId: null, projectId: null } as any;
const planSession = { id: 's', mode: 'plan', task: null, model: 'arksai-auto', orgId: null, projectId: null } as any;
const chatSession = { id: 's', mode: 'chat', task: null, model: 'arksai-auto', orgId: null, projectId: null } as any;
const codeSession = { id: 's', mode: 'code', task: null, model: 'arksai-auto', orgId: null, projectId: null } as any;

/** Build a prompt with the progressive flag forced to a value, then restore it. */
function withFlag(on: boolean, fn: () => void) {
  const prev = config.progressiveExpertise;
  config.progressiveExpertise = on;
  try {
    fn();
  } finally {
    config.progressiveExpertise = prev;
  }
}

test('REPORT prompt is BYTE-FOR-BYTE equivalent with the flag ON vs OFF (zero regression)', () => {
  let on = '';
  let off = '';
  withFlag(true, () => {
    on = buildSystemPrompt(reportSession, '/tmp', '');
  });
  withFlag(false, () => {
    off = buildSystemPrompt(reportSession, '/tmp', '');
  });
  assert.equal(on, off, 'report-mode prompt must be identical regardless of progressive disclosure');
});

test('CODE prompt is also byte-equivalent (it still loads every slice today)', () => {
  let on = '';
  let off = '';
  withFlag(true, () => {
    on = buildSystemPrompt(codeSession, '/tmp', '');
  });
  withFlag(false, () => {
    off = buildSystemPrompt(codeSession, '/tmp', '');
  });
  assert.equal(on, off, 'code-mode prompt must be identical (code can use every capability)');
});

test('REPORT prompt with the flag ON still carries EVERY hard-won report rule', () => {
  let p = '';
  withFlag(true, () => {
    p = buildSystemPrompt(reportSession, '/tmp', '');
  });
  // Lock ALL the load-bearing phrases from the report protocol — none may drop.
  const required = [
    '.bleed',
    '.section',
    'break-before',
    'break-inside',
    'WHITE FRAME',
    '.lede',
    'render_chart',
    '@page',
    'OUTPUT LANGUAGE',
    '70%',
    'ONLY THE COVER HAS A BACKGROUND',
    'full-bleed',
    'VISUAL QC IS MANDATORY',
    'PAGE MECHANICS',
    'add_fonts',
    'table-header-group',
    'orphans',
    'CONTRAST',
    'KPI BAND',
    'METADATA FOOTER',
  ];
  for (const phrase of required) {
    assert.ok(p.includes(phrase), `report prompt must still contain "${phrase}"`);
  }
});

test('PLAN turn with the flag ON is meaningfully SHORTER than with it OFF (real saving, no quality loss)', () => {
  let on = 0;
  let off = 0;
  withFlag(true, () => {
    on = buildSystemPrompt(planSession, '/tmp', '').length;
  });
  withFlag(false, () => {
    off = buildSystemPrompt(planSession, '/tmp', '').length;
  });
  // Print the measured reduction so the efficiency claim is visible, not assumed.
  const saved = off - on;
  const pct = ((saved / off) * 100).toFixed(1);
  // eslint-disable-next-line no-console
  console.log(`[phase5] PLAN prompt chars — flag OFF: ${off}, flag ON: ${on}, saved: ${saved} (${pct}%)`);
  assert.ok(on < off, 'a read-only PLAN turn must be shorter with progressive disclosure on');
  // A non-trivial saving (the Suno/MiniMax/doc-tools slices the plan turn can't use).
  assert.ok(saved > 500, `expected a meaningful reduction, got only ${saved} chars`);
});

test('PLAN turn keeps its read-only plan-gate + approval rules (nothing essential dropped)', () => {
  let p = '';
  withFlag(true, () => {
    p = buildSystemPrompt(planSession, '/tmp', '');
  });
  assert.match(p, /Mode: PLAN/);
  assert.match(p, /submit_plan/);
  assert.match(p, /Approve & build/);
  // core environment + the single-language style rule survive
  assert.match(p, /web_search/);
  assert.match(p, /Write all output text in English/);
  // the build/generation slices a read-only plan can't use are gone
  assert.doesNotMatch(p, /generate_spreadsheet/);
  assert.doesNotMatch(p, /AUTO-EXPORT & CANVAS/);
});

test('CHAT turn is unchanged by the flag (it already returns its own slim block)', () => {
  let on = '';
  let off = '';
  withFlag(true, () => {
    on = buildSystemPrompt(chatSession, '/tmp', '');
  });
  withFlag(false, () => {
    off = buildSystemPrompt(chatSession, '/tmp', '');
  });
  assert.equal(on, off, 'chat already early-returns a slim prompt — the flag must not change it');
});
