import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDesignVerdict } from '../src/agent/uiCheck';

test('parseDesignVerdict: PASS with no defects', () => {
  const r = parseDesignVerdict('VERDICT: PASS');
  assert.equal(r.verdict, 'pass');
  assert.deepEqual(r.defects, []);
});

test('parseDesignVerdict: REVISE with concrete defects', () => {
  const r = parseDesignVerdict(
    'VERDICT: REVISE\n- headings and body are the same size — add hierarchy\n- the accent is used on every element\n* spacing is cramped at the top',
  );
  assert.equal(r.verdict, 'revise');
  assert.equal(r.defects.length, 3);
  assert.match(r.defects[0], /hierarchy/);
});

test('parseDesignVerdict: caps defects at 5', () => {
  const many = 'VERDICT: REVISE\n' + Array.from({ length: 9 }, (_, i) => `- issue ${i}`).join('\n');
  assert.equal(parseDesignVerdict(many).defects.length, 5);
});

test('parseDesignVerdict: garbage / missing verdict → unknown', () => {
  assert.equal(parseDesignVerdict('looks good to me').verdict, 'unknown');
  assert.equal(parseDesignVerdict('').verdict, 'unknown');
});
