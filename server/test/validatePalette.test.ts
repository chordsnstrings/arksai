import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseHex,
  relativeLuminance,
  contrastRatio,
  ensureContrast,
  validatePalette,
} from '../src/agent/tools/validatePalette';

test('parseHex: valid + invalid', () => {
  assert.deepEqual(parseHex('#FFFFFF'), { r: 255, g: 255, b: 255 });
  assert.deepEqual(parseHex('000000'), { r: 0, g: 0, b: 0 });
  assert.deepEqual(parseHex('#0A1628'), { r: 10, g: 22, b: 40 });
  assert.equal(parseHex('#fff'), null); // 3-digit not accepted
  assert.equal(parseHex('nope'), null);
});

test('contrast: black on white is 21:1 (WCAG known value)', () => {
  const black = { r: 0, g: 0, b: 0 };
  const white = { r: 255, g: 255, b: 255 };
  assert.equal(relativeLuminance(white), 1);
  assert.equal(Math.round(contrastRatio(black, white)), 21);
  // white-on-white fails utterly
  assert.equal(contrastRatio(white, white), 1);
});

test('validatePalette: light bg derived from a vibrant primary passes AA for body text', () => {
  const res: any = validatePalette({ primary: '#FF6B35' });
  assert.ok(!('error' in res));
  const bodyText = res.checks.find((c: any) => c.pair === 'body text on bg');
  assert.equal(bodyText.floor, 4.5);
  assert.equal(bodyText.pass, true, 'near-black text on a light bg must pass AA');
  // tokens present
  assert.match(res.tokens.bg, /^#[0-9A-F]{6}$/);
  assert.match(res.tokens.text, /^#[0-9A-F]{6}$/);
  assert.equal(res.tokens.primary, '#FF6B35');
});

test('validatePalette: a FAILING combo (light grey text on white) is flagged with a darker fix', () => {
  // light grey text on a white bg fails AA; the tool should flag it and return a fix
  const res: any = validatePalette({ primary: '#888888', bg: '#FFFFFF', text: '#AAAAAA' });
  assert.ok(!('error' in res));
  const bodyText = res.checks.find((c: any) => c.pair === 'body text on bg');
  assert.equal(bodyText.pass, false);
  assert.ok(bodyText.fix, 'a corrected colour must be supplied');
  // the fix must actually meet the 4.5:1 floor on white
  const fixRgb = parseHex(bodyText.fix)!;
  assert.ok(contrastRatio(fixRgb, { r: 255, g: 255, b: 255 }) >= 4.5);
  assert.equal(res.ok, false);
});

test('validatePalette: dark primary derives a dark theme bg and readable light text', () => {
  const res: any = validatePalette({ primary: '#0A1628', accent: '#00D4AA' });
  assert.ok(!('error' in res));
  // bg should be dark (the dark navy primary)
  assert.ok(relativeLuminance(parseHex(res.tokens.bg)!) < 0.18);
  const bodyText = res.checks.find((c: any) => c.pair === 'body text on bg');
  assert.equal(bodyText.pass, true);
});

test('validatePalette: invalid primary returns an error', () => {
  const res: any = validatePalette({ primary: 'banana' });
  assert.ok('error' in res);
});

test('ensureContrast: walks a colour to meet the target', () => {
  const white = { r: 255, g: 255, b: 255 };
  const start = { r: 200, g: 200, b: 200 }; // fails on white
  assert.ok(contrastRatio(start, white) < 4.5);
  const fixed = ensureContrast(start, white, 4.5);
  assert.ok(contrastRatio(fixed, white) >= 4.5);
});
