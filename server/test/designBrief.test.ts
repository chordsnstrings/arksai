import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileDesignBrief, designBriefBlock } from '../src/agent/designBrief';
import { classifyTask } from '../src/agent/taskProfile';

test('designBriefBlock wraps a compiled brief as a FOLLOW-IT system block', () => {
  const block = designBriefBlock('CONCEPT: a calm weather card\nPALETTE: marine');
  assert.match(block, /Build brief/i);
  assert.match(block, /FOLLOW IT/);
  assert.match(block, /CONCEPT: a calm weather card/);
});

test('compileDesignBrief fails OPEN (returns null) when no MiniMax key is configured', async () => {
  // No MINIMAX_API_KEY in the test env → the compiler must never throw or block a build.
  const profile = classifyTask('make me a weather widget', 'code');
  const ac = new AbortController();
  const r = await compileDesignBrief('make me a weather widget', profile, ac.signal);
  assert.equal(r, null);
});
