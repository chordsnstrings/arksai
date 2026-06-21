import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fingerprint } from '../src/incidents/store';
import { buildIssueBody } from '../src/incidents/report';

test('fingerprint: same error class collapses despite volatile ids/numbers', () => {
  const a = fingerprint('run_error', 'MiniMax (M3) stalled after 150s on session 9f3a2b1c-1111-2222-3333-444455556666');
  const b = fingerprint('run_error', 'MiniMax (M3) stalled after 240s on session 0a0b0c0d-9999-8888-7777-666655554444');
  assert.equal(a, b); // numbers + uuids normalized away → one incident
});

test('fingerprint: different error classes / kinds stay distinct', () => {
  const stall = fingerprint('stall', 'repeated step');
  const err = fingerprint('run_error', 'repeated step');
  assert.notEqual(stall, err);
  const other = fingerprint('run_error', 'completely different failure');
  assert.notEqual(err, other);
});

test('buildIssueBody: includes the actionable fix instructions + guardrails', () => {
  const body = buildIssueBody({
    id: 'i1', fingerprint: 'abc123', kind: 'timeout', severity: 'high', title: 'Agent error: terminated',
    detail: 'MiniMax stalled', context: { mode: 'report', model: 'arksai-max' }, orgId: 'o1', sessionId: 's1',
    count: 3, status: 'open', issueUrl: null, firstSeen: 1, lastSeen: 2,
  });
  assert.match(body, /npm run typecheck && npm test && npm run build/);
  assert.match(body, /never touch auth\/billing\/data/i);
  assert.match(body, /abc123/);
  assert.match(body, /"mode": "report"/);
});
