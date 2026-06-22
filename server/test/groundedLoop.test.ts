import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyFactSensitive,
  parseClaimsJson,
  parseVerdictJson,
  reduceVerdict,
  covers,
  hasUnverifiedLabel,
  clusterClaims,
  groundedResearch,
  type Claim,
  type LoopDeps,
  type AdjudicationResult,
} from '../src/agent/research/groundedLoop';

test('G0 classify: fact-sensitive vs not', () => {
  assert.equal(classifyFactSensitive('research which VCs invest pre-seed in the UAE in 2026'), true);
  assert.equal(classifyFactSensitive('how many people live in Dubai'), true);
  assert.equal(classifyFactSensitive('write me a poem about the sea'), false);
  assert.equal(classifyFactSensitive('refactor this function to be cleaner'), false);
  assert.equal(classifyFactSensitive(''), false);
});

test('parseClaimsJson: lenient, preserves the specific value, defaults type', () => {
  const out = parseClaimsJson('```json\n[{"draftText":"$136M","type":"figure","subject":"Oraseya Capital","assertion":"fund size is $136M","checkWorthy":true}]\n```');
  assert.equal(out.length, 1);
  assert.equal(out[0].assertion, 'fund size is $136M');
  assert.equal(out[0].type, 'figure');
  assert.equal(out[0].checkWorthy, true);
  assert.deepEqual(parseClaimsJson('not json'), []);
});

test('parseVerdictJson: parses + clamps unknown verdict to unverified', () => {
  assert.equal(parseVerdictJson('{"verdict":"confirmed","sourceIndex":0,"confidence":0.9}')!.verdict, 'confirmed');
  assert.equal(parseVerdictJson('{"verdict":"banana","confidence":0.5}')!.verdict, 'unverified');
  assert.equal(parseVerdictJson('garbage'), null);
});

test('reduceVerdict: conservative skepticism tie-break (never a false confirmed)', () => {
  const mk = (verdict: AdjudicationResult['verdict']): AdjudicationResult => ({ verdict, confidence: 1, correctedValue: null, sourceIndex: null, note: null });
  // tie between confirmed and unverified → choose the MORE skeptical (unverified)
  assert.equal(reduceVerdict([mk('confirmed'), mk('unverified')]).verdict, 'unverified');
  // clear majority confirmed
  assert.equal(reduceVerdict([mk('confirmed'), mk('confirmed'), mk('unverified')]).verdict, 'confirmed');
  // confidence is the agreement ratio
  assert.equal(reduceVerdict([mk('confirmed'), mk('confirmed'), mk('unverified')]).confidence, 2 / 3);
});

test('FINAL_GATE covers(): backed only when subject + token overlap match', () => {
  const ledger = { subject: 'Oraseya Capital', assertion: 'fund size is $136M' } as Claim;
  assert.equal(covers(ledger, 'Oraseya Capital manages a $136M fund'), true);
  assert.equal(covers(ledger, 'some unrelated sentence about coffee'), false);
});

test('hasUnverifiedLabel: detects an explicit could-not-verify near the claim', () => {
  const ans = 'Hub71 invests at pre-seed. We could not verify the $2.17B cumulative figure.';
  assert.equal(hasUnverifiedLabel(ans, 'the $2.17B cumulative figure'), true);
  assert.equal(hasUnverifiedLabel('Hub71 invests at pre-seed.', 'Hub71 invests at pre-seed'), false);
});

test('clusterClaims: groups by subject+type so one query serves a group', () => {
  const c = (subject: string, type: any): Claim => ({ id: subject, draftText: '', type, subject, assertion: '', checkWorthy: true, queries: [], sources: [], attempts: 0 });
  const groups = clusterClaims([c('A', 'figure'), c('A', 'figure'), c('B', 'date')]);
  assert.equal(groups.length, 2);
});

test('orchestrator: non-fact task → single plain pass, no claims', async () => {
  const deps: LoopDeps = {
    llm: async (_role, _sys, _user) => 'A poem about the sea.',
    search: async () => [],
  };
  const r = await groundedResearch('write me a poem about the sea', deps);
  assert.equal(r.factSensitive, false);
  assert.equal(r.claims.length, 0);
  assert.match(r.answer, /poem/i);
});

test('orchestrator: fact task → draft, extract, adjudicate (corrected), revise from ledger', async () => {
  const calls: string[] = [];
  const deps: LoopDeps = {
    llm: async (role, _sys, _user) => {
      calls.push(role);
      if (role === 'draft') return 'Oraseya Capital is a $999M fund founded in 2023.';
      if (role === 'extract') return JSON.stringify([{ draftText: '$999M', type: 'figure', subject: 'Oraseya Capital', assertion: 'fund size is $999M', checkWorthy: true }]);
      if (role === 'adjudicate') return '{"verdict":"corrected","correctedValue":"$136M","sourceIndex":0,"confidence":1}';
      if (role === 'revise') return 'Oraseya Capital manages a $136M fund [source].';
      if (role === 'finalGate') return JSON.stringify([{ draftText: '$136M', type: 'figure', subject: 'Oraseya Capital', assertion: 'fund size is $136M', checkWorthy: true }]);
      return '';
    },
    search: async () => [{ url: 'https://x.com', snippet: 'Oraseya Capital is a $136M fund.' }],
  };
  const r = await groundedResearch('research Oraseya Capital fund size', deps);
  assert.equal(r.factSensitive, true);
  assert.ok(calls.includes('draft') && calls.includes('extract') && calls.includes('adjudicate') && calls.includes('revise'));
  assert.equal(r.claims[0].verdict, 'corrected');
  assert.equal(r.claims[0].correctedValue, '$136M');
  // the answer uses the corrected value, not the drafted $999M
  assert.match(r.answer, /\$136M/);
  assert.doesNotMatch(r.answer, /\$999M/);
});
