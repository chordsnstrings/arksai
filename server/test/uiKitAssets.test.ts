import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const UIKIT = path.join(__dirname, '..', 'assets', 'ui-kit');
const FONTS = path.join(__dirname, '..', 'assets', 'report-fonts');
const themes = fs.readFileSync(path.join(UIKIT, 'themes.css'), 'utf8');
const fontsCss = fs.readFileSync(path.join(FONTS, 'fonts.css'), 'utf8');

const COLOR_THEMES = [
  'aurora', 'emerald', 'sunset', 'mono', 'editorial', 'noir', 'ocean',
  'plum', 'coral', 'teal', 'gold', 'forest', 'slatepro',
  'crimson', 'sky', 'amber', 'rose', 'sand', 'midnight', 'cocoa', 'mint', 'steel', 'lime',
];
const TYPE_PAIRINGS = [
  'geometric', 'editorial', 'grand', 'fashion', 'startup', 'press', 'humanist',
  'chic', 'contemporary', 'tech', 'journal', 'warm', 'clean',
];
const DESIGN_KITS = ['linear', 'boutique', 'studio', 'ledger', 'bloom', 'gazette', 'pulse', 'terra'];
const NEW_FONT_FILES = [
  'fraunces-600.woff2', 'playfair-600.woff2', 'outfit-600.woff2',
  'worksans-400.woff2', 'worksans-600.woff2', 'dmsans-400.woff2', 'dmsans-600.woff2', 'spectral-400.woff2',
  'instrumentserif-400.woff2', 'bricolage-600.woff2', 'sora-600.woff2', 'jakarta-400.woff2',
  'jakarta-600.woff2', 'lora-400.woff2', 'manrope-600.woff2', 'newsreader-400.woff2',
];

test('themes.css defines an ample set of colour personalities (23)', () => {
  for (const t of COLOR_THEMES) {
    assert.ok(themes.includes(`[data-theme~='${t}']`), `missing colour theme: ${t}`);
  }
  assert.ok(COLOR_THEMES.length >= 23);
});

test('themes.css defines the typography pairings via data-type (13)', () => {
  for (const p of TYPE_PAIRINGS) {
    assert.ok(themes.includes(`[data-type='${p}']`), `missing type pairing: ${p}`);
  }
  assert.ok(TYPE_PAIRINGS.length >= 13);
  // each pairing must set a display family
  assert.match(themes, /\[data-type='grand'\][^}]*--font-display:\s*'Fraunces'/);
  assert.match(themes, /\[data-type='chic'\][^}]*--font-display:\s*'Instrument Serif'/);
});

test('themes.css defines complete design kits via data-kit (8)', () => {
  for (const k of DESIGN_KITS) {
    assert.ok(themes.includes(`[data-kit='${k}']`), `missing design kit: ${k}`);
    // each kit must set accent + a display font (a complete look)
    const m = themes.match(new RegExp(`\\[data-kit='${k}'\\]\\s*\\{([^}]*)\\}`));
    assert.ok(m, `no block for kit ${k}`);
    assert.match(m[1], /--accent:\s*#[0-9a-fA-F]{6}/, `kit ${k} missing accent`);
    assert.match(m[1], /--font-display:/, `kit ${k} missing font-display`);
  }
  assert.ok(DESIGN_KITS.length >= 8);
});

test('every new theme has valid hex accents (no stray characters)', () => {
  // Pull each data-theme block and assert its --accent / --accent-2 are clean 6-digit hex.
  for (const t of COLOR_THEMES) {
    const m = themes.match(new RegExp(`\\[data-theme~='${t}'\\]\\s*\\{([^}]*)\\}`));
    assert.ok(m, `no block for ${t}`);
    const hexes = m[1].match(/--accent(?:-2)?:\s*([^;]+);/g) || [];
    for (const h of hexes) {
      assert.match(h, /#[0-9a-fA-F]{6}\s*;/, `theme ${t} has a malformed accent: ${h}`);
    }
  }
});

test('fonts.css declares the new families and the woff2 files exist', () => {
  for (const fam of ['Fraunces', 'Playfair Display', 'Outfit', 'Work Sans', 'DM Sans', 'Spectral']) {
    assert.ok(fontsCss.includes(`font-family:'${fam}'`), `fonts.css missing @font-face for ${fam}`);
  }
  for (const f of NEW_FONT_FILES) {
    const p = path.join(FONTS, f);
    assert.ok(fs.existsSync(p), `missing font file ${f}`);
    assert.ok(fs.statSync(p).size > 3000, `font ${f} looks empty/truncated`);
  }
});

test('every @font-face src in fonts.css points at a file that exists', () => {
  const refs = [...fontsCss.matchAll(/url\('([^']+\.woff2)'\)/g)].map((m) => m[1]);
  assert.ok(refs.length >= 16);
  for (const r of refs) {
    assert.ok(fs.existsSync(path.join(FONTS, r)), `fonts.css references a missing file: ${r}`);
  }
});
