import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  redactSnippet,
  looksLikeComplaint,
  classifyError,
  remediationFor,
  signatureOf,
  severityOf,
  clusterSignals,
  type IssueSignal,
} from '../src/selfheal/issues';

/**
 * Self-healing Phase 1 — issue detection/clustering (pure). Locks: redaction never leaks PII/secrets,
 * complaint detection is conservative, error classification + remediation are stable, and clustering
 * collapses like symptoms and ranks by severity (frequency × kind × cross-tenant spread).
 */

test('redactSnippet strips emails, urls, ids, keys, phones and truncates', () => {
  assert.doesNotMatch(redactSnippet('reach me at bob@acme.com now'), /bob@acme\.com/);
  assert.doesNotMatch(redactSnippet('see https://arksai.studio/apps/x'), /https?:\/\//);
  assert.doesNotMatch(redactSnippet('key sk-cp-abcdef123456 leaked'), /sk-cp-abcdef123456/);
  assert.doesNotMatch(redactSnippet('id 781f2335-89c5-4296-94e0-3869e022f92b'), /781f2335/);
  assert.doesNotMatch(redactSnippet('call +971 50 123 4567'), /\d{6}/);
  assert.ok(redactSnippet('x'.repeat(400)).length <= 181);
});

test('looksLikeComplaint: catches real bad-reactions, ignores normal iteration/opening asks', () => {
  for (const good of ["it doesn't work", 'still broken', 'this is wrong', 'the page is blank', 'I got an error', 'it crashed', 'nothing happened']) {
    assert.ok(looksLikeComplaint(good), `complaint: ${good}`);
  }
  for (const neutral of ['make the header blue', 'create an image of a cat', 'can you add a pricing section', 'thanks!', 'looks great']) {
    assert.ok(!looksLikeComplaint(neutral), `not a complaint: ${neutral}`);
  }
});

test('classifyError maps terminal text to a coarse failure class', () => {
  assert.equal(classifyError('verify gate failed: typecheck error'), 'verification');
  assert.equal(classifyError('run hit the output budget cutoff'), 'budget');
  assert.equal(classifyError('the model stalled and timed out'), 'stall');
  assert.equal(classifyError('post-publish smoke test failed on /apps/x'), 'publish');
  assert.equal(classifyError('fetch failed: egress blocked by proxy 403'), 'network');
  assert.equal(classifyError('build finished but produced no deliverable'), 'no-deliverable');
  assert.equal(classifyError('insufficient_balance 1008'), 'provider-limit');
  assert.equal(classifyError('something odd happened'), 'other');
});

test('remediationFor: deterministic first-guess routing', () => {
  assert.equal(remediationFor('complaint'), 'prompt');
  assert.equal(remediationFor('run_error', 'verification'), 'code');
  assert.equal(remediationFor('run_error', 'publish'), 'code');
  assert.equal(remediationFor('run_error', 'budget'), 'model');
  assert.equal(remediationFor('run_error', 'network'), 'environment');
  assert.equal(remediationFor('run_error', 'other'), 'unknown');
});

test('signatureOf groups by kind/mode/deliverable/errorClass', () => {
  const a: IssueSignal = { kind: 'run_error', orgId: 'o1', sessionId: 's1', ts: 1, mode: 'code', deliverable: 'app', errorClass: 'verification' };
  const b: IssueSignal = { kind: 'run_error', orgId: 'o2', sessionId: 's2', ts: 2, mode: 'code', deliverable: 'app', errorClass: 'verification' };
  const c: IssueSignal = { kind: 'run_error', orgId: 'o2', sessionId: 's3', ts: 3, mode: 'report', deliverable: 'pdf', errorClass: 'budget' };
  assert.equal(signatureOf(a), signatureOf(b));
  assert.notEqual(signatureOf(a), signatureOf(c));
});

test('severityOf: run errors outweigh complaints; cross-tenant raises it', () => {
  assert.ok(severityOf(5, 1, 'run_error') > severityOf(5, 1, 'complaint'));
  assert.ok(severityOf(3, 5, 'run_error') > severityOf(3, 1, 'run_error'));
});

test('clusterSignals collapses like symptoms, counts tenants, dedupes examples, ranks by severity', () => {
  const signals: IssueSignal[] = [
    { kind: 'run_error', orgId: 'o1', sessionId: 's1', ts: 10, mode: 'code', deliverable: 'app', errorClass: 'verification', snippet: 'typecheck failed' },
    { kind: 'run_error', orgId: 'o2', sessionId: 's2', ts: 20, mode: 'code', deliverable: 'app', errorClass: 'verification', snippet: 'typecheck failed' },
    { kind: 'run_error', orgId: 'o3', sessionId: 's3', ts: 30, mode: 'code', deliverable: 'app', errorClass: 'verification', snippet: 'test suite red' },
    { kind: 'complaint', orgId: 'o1', sessionId: 's4', ts: 40, mode: 'chat', snippet: 'it doesn’t work' },
  ];
  const clusters = clusterSignals(signals);
  assert.equal(clusters.length, 2);
  const top = clusters[0];
  assert.equal(top.kind, 'run_error'); // 3× across 3 tenants → most severe, ranked first
  assert.equal(top.count, 3);
  assert.equal(top.orgs, 3);
  assert.equal(top.remediation, 'code');
  assert.equal(top.examples.length, 2); // deduped ("typecheck failed" once)
  assert.match(top.title, /quality gate/i);
  assert.equal(clusters[1].kind, 'complaint');
});
