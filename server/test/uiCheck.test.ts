import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDesignVerdict, detectLeakedValues, judgeMobileNav } from '../src/agent/uiCheck';

// A value leaking into the UI (e.g. an unlabelled chart series → "undefined" legend,
// an object rendered as "[object Object]", a bad calc as "NaN") must be caught so the
// verify gate surfaces it for self-correction.
test('detectLeakedValues: flags [object Object] / undefined / NaN, clean text passes', () => {
  assert.deepEqual(detectLeakedValues('Revenue AED 1.25M  Orders 3,842  Conversion 3.2%'), []);
  assert.equal(detectLeakedValues('Category: [object Object]').length, 1);
  assert.equal(detectLeakedValues('Revenue\nundefined\nFashion').length, 1); // the dashboard legend bug
  assert.equal(detectLeakedValues('Total: NaN').length, 1);
  assert.equal(detectLeakedValues('[object Object] undefined NaN').length, 3);
  // doesn't false-positive on words that merely contain the substrings
  assert.deepEqual(detectLeakedValues('This behaviour is well-defined and ordinary.'), []);
});

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

// A hamburger that doesn't open the menu on a phone is the #1 "the menu doesn't work" defect —
// and it sails through the desktop-width interaction pass. judgeMobileNav is the deterministic
// gate; it must flag a dead toggle and NEVER false-positive on the legitimate patterns.
test('judgeMobileNav: dead hamburger (nav stays hidden after tap) → flagged', () => {
  const msg = judgeMobileNav({ hasToggle: true, before: 0, after: 0 });
  assert.match(msg, /Broken mobile menu/);
  // a toggle present but only a logo link visible, and tapping reveals nothing
  assert.notEqual(judgeMobileNav({ hasToggle: true, before: 1, after: 1 }), '');
});

test('judgeMobileNav: working hamburger (tap reveals nav links) → clean', () => {
  assert.equal(judgeMobileNav({ hasToggle: true, before: 0, after: 6 }), '');
  assert.equal(judgeMobileNav({ hasToggle: true, before: 1, after: 5 }), '');
});

test('judgeMobileNav: no toggle, or nav already shown inline at mobile → nothing to verify', () => {
  assert.equal(judgeMobileNav({ hasToggle: false, before: 0, after: 0 }), ''); // no hamburger pattern
  assert.equal(judgeMobileNav({ hasToggle: true, before: 5, after: 5 }), ''); // full nav visible, no toggle needed
});
