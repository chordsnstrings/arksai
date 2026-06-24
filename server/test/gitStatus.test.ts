import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeGitState, type GitStatus } from '../../shared/types';

const base: GitStatus = { hasRepo: true, branch: 'main', head: null, dirty: 0, lastPush: null, pushed: false };

// The repo bar must tell the user, at a glance, whether their code is committed AND pushed —
// the whole point of the fix ("no way to know if it was committed").
test('describeGitState: pushed HEAD, clean tree → ok "Pushed"', () => {
  const d = describeGitState({ ...base, head: { sha: 'a1b2c3d', subject: 'Build the site' }, pushed: true });
  assert.equal(d.tone, 'ok');
  assert.match(d.text, /Pushed · a1b2c3d/);
});

test('describeGitState: committed but not pushed → pending', () => {
  const d = describeGitState({ ...base, head: { sha: 'deadbee', subject: 'wip' }, pushed: false });
  assert.equal(d.tone, 'pending');
  assert.match(d.text, /not pushed · deadbee/);
});

test('describeGitState: uncommitted changes take precedence (even with a prior pushed commit)', () => {
  const d = describeGitState({ ...base, head: { sha: 'a1b2c3d', subject: 'x' }, dirty: 3, pushed: false });
  assert.equal(d.tone, 'pending');
  assert.equal(d.text, '3 uncommitted changes');
  // singular grammar
  assert.equal(describeGitState({ ...base, dirty: 1 }).text, '1 uncommitted change');
});

test('describeGitState: nothing committed yet / no repo', () => {
  assert.equal(describeGitState(base).text, 'Nothing committed yet');
  assert.deepEqual(describeGitState({ ...base, hasRepo: false }), { tone: 'idle', text: 'No repo yet' });
});
