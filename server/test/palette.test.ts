import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickPalette } from '../src/agent/tools/palette';

test('pickPalette: picks the brand colour as accent, skipping white/black background', () => {
  // a logo on white, with black text and a strong red mark
  const { accent, palette } = pickPalette([
    { r: 255, g: 255, b: 255, count: 5000 }, // white background — must NOT be the accent
    { r: 20, g: 20, b: 20, count: 1200 }, // black text — must NOT be the accent
    { r: 200, g: 30, b: 40, count: 800 }, // brand red — SHOULD be the accent
  ]);
  // accent is a reddish hue
  const r = parseInt(accent.slice(1, 3), 16),
    g = parseInt(accent.slice(3, 5), 16),
    b = parseInt(accent.slice(5, 7), 16);
  assert.ok(r > 150 && g < 90 && b < 90, `accent ${accent} should be red-dominant`);
  assert.ok(palette.includes('#ffffff')); // palette still lists the dominant colours
});

test('pickPalette: monochrome logo falls back to a tasteful accent', () => {
  const { accent } = pickPalette([
    { r: 255, g: 255, b: 255, count: 4000 },
    { r: 10, g: 10, b: 10, count: 1500 },
  ]);
  assert.match(accent, /^#[0-9a-f]{6}$/);
  // not white/near-white and not pure black
  assert.notEqual(accent.toLowerCase(), '#ffffff');
});

test('pickPalette: prefers a saturated colour with real presence', () => {
  const { accent } = pickPalette([
    { r: 245, g: 246, b: 248, count: 9000 }, // off-white
    { r: 33, g: 102, b: 222, count: 1400 }, // brand blue
    { r: 180, g: 180, b: 180, count: 600 }, // grey (low sat) — skipped
  ]);
  const r = parseInt(accent.slice(1, 3), 16),
    b = parseInt(accent.slice(5, 7), 16);
  assert.ok(b > r, `accent ${accent} should be blue-dominant`);
});
