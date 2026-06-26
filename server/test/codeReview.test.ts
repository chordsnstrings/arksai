import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReviewPrompt, parseReviewVerdict } from '../src/agent/codeReview';

test('buildReviewPrompt embeds the diff and scopes the review to it', () => {
  const { system, user } = buildReviewPrompt('--- a/x.ts\n+++ b/x.ts\n+const y = 1;', { repoName: 'me/app' });
  assert.match(user, /const y = 1/);
  assert.match(system, /unified git diff|this diff changes/i);
  assert.match(system, /me\/app/);
  assert.match(system, /STRICT JSON/);
});

test('parseReviewVerdict: clean approve', () => {
  const v = parseReviewVerdict('{"verdict":"approve","findings":[]}');
  assert.equal(v.verdict, 'approve');
  assert.deepEqual(v.findings, []);
});

test('parseReviewVerdict: revise with object findings → formatted strings', () => {
  const v = parseReviewVerdict(
    '{"verdict":"revise","findings":[{"file":"src/a.ts","issue":"missing await on save()"}]}',
  );
  assert.equal(v.verdict, 'revise');
  assert.equal(v.findings.length, 1);
  assert.match(v.findings[0], /src\/a\.ts: missing await/);
});

test('parseReviewVerdict: handles ```json fences and trailing prose', () => {
  const v = parseReviewVerdict('Here is my review:\n```json\n{"verdict":"revise","findings":["off-by-one in loop"]}\n```\nThanks!');
  assert.equal(v.verdict, 'revise');
  assert.deepEqual(v.findings, ['off-by-one in loop']);
});

test('parseReviewVerdict: fail-open on unparseable text', () => {
  assert.equal(parseReviewVerdict('the code looks fine to me').verdict, 'approve');
  assert.equal(parseReviewVerdict('').verdict, 'approve');
});

test('parseReviewVerdict: revise verdict but NO concrete findings → approve (nothing actionable)', () => {
  const v = parseReviewVerdict('{"verdict":"revise","findings":[]}');
  assert.equal(v.verdict, 'approve');
});

test('parseReviewVerdict: caps the number of findings pushed back', () => {
  const many = Array.from({ length: 30 }, (_, i) => `issue ${i}`);
  const v = parseReviewVerdict(JSON.stringify({ verdict: 'revise', findings: many }));
  assert.equal(v.verdict, 'revise');
  assert.ok(v.findings.length <= 12);
});
