import { test } from 'node:test';
import assert from 'node:assert/strict';
import { briefFamily, briefScaffold } from '../src/agent/brief';
import { classifyTask } from '../src/agent/taskProfile';

const prof = (text: string, mode: 'chat' | 'plan' | 'code' | 'report' = 'chat') => classifyTask(text, mode);

test('research family: free-form "which VCs invest in pre-seed" (task null)', () => {
  const text = 'research which VC or funds are investing in pre-seed round for AI startups in the UAE';
  assert.equal(briefFamily(text, prof(text), null), 'research');
});

test('research family: "find me a list of suppliers" / "competitor analysis"', () => {
  assert.equal(briefFamily('find me a list of suppliers for packaging', prof('find me a list of suppliers'), null), 'research');
  assert.equal(briefFamily('do a competitor analysis of the top CRMs', prof('competitor analysis'), null), 'research');
});

test('financial-model family: by finance task key OR explicit model words', () => {
  assert.equal(briefFamily('build it', prof('build it'), 'finance.cashflow'), 'financial-model');
  assert.equal(briefFamily('build a 3-statement financial model for a cafe', prof('build a financial model'), null), 'financial-model');
});

test('report family: report mode', () => {
  const text = 'a briefing on the UAE logistics market';
  assert.equal(briefFamily(text, prof(text, 'report'), null), 'report');
});

test('analysis family: non-visual interpretation, but NOT a visual dashboard build', () => {
  assert.equal(briefFamily('analyze this sales data and tell me the trends', prof('analyze this sales data'), null), 'analysis');
  // a dashboard is visual → stays on the design/QC path, no analysis scaffold
  assert.equal(briefFamily('build a sales dashboard', prof('build a sales dashboard'), null), null);
});

test('no family: a plain visual build gets no scaffold (unchanged behaviour)', () => {
  assert.equal(briefFamily('build a landing page for my cafe', prof('build a landing page'), null), null);
  assert.equal(briefScaffold('build a landing page for my cafe', prof('build a landing page'), null), null);
});

test('scaffold contains the six sections + the no-fabrication rule', () => {
  const text = 'research the top AI investors in the UAE';
  const s = briefScaffold(text, prof(text), null)!;
  assert.ok(s);
  for (const marker of ['ROLE:', 'SUCCESS CRITERIA', 'METHOD:', 'VERIFICATION RULES:', 'OUTPUT CONTRACT:', 'SELF-AUDIT']) {
    assert.match(s, new RegExp(marker.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')), `missing ${marker}`);
  }
  assert.match(s, /Never invent specifics/);
});

test('financial-model scaffold forbids hard-coded derived numbers', () => {
  const s = briefScaffold('build a cashflow model', prof('build a cashflow model'), 'finance.cashflow')!;
  assert.match(s, /LIVE formula/);
  assert.match(s, /NEVER a hard-coded literal/);
});
