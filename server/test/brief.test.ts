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

test('document family: formal writing (non-visual)', () => {
  assert.equal(briefFamily('write a complaint letter to the airline that lost my bag', prof('write a complaint letter'), null), 'document');
  assert.equal(briefFamily('draft a job description for a senior accountant', prof('draft a job description'), null), 'document');
});

test('generic fallback: a non-visual "produce a deliverable" ask not otherwise classified', () => {
  assert.equal(briefFamily('give me a 30-day plan to launch my bakery', prof('give me a 30-day plan'), null), 'generic');
  assert.equal(briefFamily('come up with five names for a coffee subscription box', prof('come up with five names'), null), 'generic');
});

test('no family: a plain visual build gets no scaffold (unchanged behaviour)', () => {
  assert.equal(briefFamily('build a landing page for my cafe', prof('build a landing page'), null), null);
  assert.equal(briefScaffold('build a landing page for my cafe', prof('build a landing page'), null), null);
});

test('no family: casual chat / thin non-deliverable messages are untouched', () => {
  for (const msg of ['hi', 'thanks!', 'what can you do?', 'who are you']) {
    assert.equal(briefFamily(msg, prof(msg), null), null, `should be null: "${msg}"`);
  }
});

test('every scaffold carries brief-first compilation + the self-audit gate', () => {
  for (const text of [
    'research the top AI investors in the UAE',
    'write a complaint letter',
    'give me a 30-day launch plan for my bakery',
  ]) {
    const s = briefScaffold(text, prof(text), null)!;
    assert.ok(s, `scaffold for "${text}"`);
    assert.match(s, /BEFORE YOU ACT/);
    assert.match(s, /restate the goal/);
    assert.match(s, /ASSUMPTIONS/);
    assert.match(s, /ask that ONE question/);
    assert.match(s, /BEFORE YOU DELIVER/);
  }
});

test('research scaffold uses literal High/Medium/Low confidence (not stars) + initial-cheque rule', () => {
  const s = briefScaffold('research UAE pre-seed AI investors', prof('research UAE investors'), null)!;
  assert.match(s, /High, Medium or Low \(not a star or emoji rating\)/);
  assert.match(s, /typical INITIAL cheque a fund writes, NEVER the largest round/);
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
