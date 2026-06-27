import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PALETTES, paletteMenu } from '../src/agent/palettes';

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

test('every palette accent meets WCAG AA against its --accent-ink (button text is always legible)', () => {
  for (const p of PALETTES) {
    const cr = ratio(p.accent, p.accentInk);
    assert.ok(cr >= 4.5, `${p.name}: accent ${p.accent} vs ink ${p.accentInk} is ${cr.toFixed(2)}:1 (<4.5)`);
    assert.match(p.accent, /^#[0-9a-f]{6}$/);
    assert.ok(['vivid', 'muted'].includes(p.tier));
  }
});

test('the catalog is rich and varied (a real swatch book), with a confident default tier', () => {
  assert.ok(PALETTES.length >= 24, 'at least two dozen palettes');
  assert.ok(PALETTES.filter((p) => p.tier === 'vivid').length >= 15, 'a deep confident tier');
  // names are unique
  assert.equal(new Set(PALETTES.map((p) => p.name)).size, PALETTES.length);
});

test('paletteMenu renders both tiers for the design prompt', () => {
  const m = paletteMenu();
  assert.match(m, /CONFIDENT/);
  assert.match(m, /MUTED/);
  assert.match(m, /emerald/);
});
