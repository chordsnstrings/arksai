import { test } from 'node:test';
import assert from 'node:assert/strict';
import { definitionOfDone } from '../src/agent/definitionOfDone';
import { classifyTask } from '../src/agent/taskProfile';

test('definitionOfDone: a visual code build gets the WEB checklist mirroring the gate', () => {
  const profile = classifyTask('build me a landing page for a bakery', 'code');
  const dod = definitionOfDone('build me a landing page for a bakery', profile, 'code');
  assert.ok(dod, 'should return a web DoD');
  assert.match(dod!, /Definition of Done/);
  assert.match(dod!, /viewport/);
  assert.match(dod!, /actually EXISTS|never link a landing\.css/); // the missing-asset check
  assert.match(dod!, /390px/); // overflow
  assert.match(dod!, /\.gauge|\.stat|\.table-wrap/); // compose, don't hand-build
});

test('definitionOfDone: report mode gets the REPORT checklist (page fill, charts, stranded heading)', () => {
  const dod = definitionOfDone('a report on coffee trends', undefined, 'report');
  assert.ok(dod);
  assert.match(dod!, /60% full/);
  assert.match(dod!, /stranded/);
  assert.match(dod!, /empty axes|render_chart/);
});

test('definitionOfDone: a spreadsheet/model request gets the XLSX checklist (formulas, populated statements)', () => {
  const dod = definitionOfDone('make me a 3-statement financial model spreadsheet', undefined, 'code');
  assert.ok(dod);
  assert.match(dod!, /LIVE formula/);
  assert.match(dod!, /Cash Flow|statement sheet/);
  assert.match(dod!, /banner|divider/);
  assert.match(dod!, /financial-model template/);
});

test('definitionOfDone: non-applicable requests return null (no change to today’s behaviour)', () => {
  // plain chat, no visual profile, not a spreadsheet
  const profile = classifyTask('what is the capital of France', 'chat');
  assert.equal(definitionOfDone('what is the capital of France', profile, 'chat'), null);
});
