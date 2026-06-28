import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOOKS, looksMenu } from '../src/agent/looks';

function ratio(a: string, b: string): number {
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const lum = (c: number[]) => {
    const f = c.map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
  };
  const l1 = lum(rgb(a)), l2 = lum(rgb(b));
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

test('every complete look pairs a WCAG-AA accent with a display + body font', () => {
  assert.ok(LOOKS.length >= 8, 'a real set of complete looks');
  for (const l of LOOKS) {
    assert.ok(ratio(l.accent, l.accentInk) >= 4.5, `${l.name}: accent vs ink under AA`);
    assert.ok(l.display && l.body, `${l.name} missing a font pairing`);
  }
  assert.equal(new Set(LOOKS.map((l) => l.name)).size, LOOKS.length, 'unique names');
});

test('looksMenu renders the named looks for the design prompt', () => {
  const m = looksMenu();
  assert.match(m, /fresh/);
  assert.match(m, /tech/);
});
