import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const UIKIT = path.join(__dirname, '..', 'assets', 'ui-kit');
const FONTS = path.join(__dirname, '..', 'assets', 'report-fonts');
const themes = fs.readFileSync(path.join(UIKIT, 'themes.css'), 'utf8');
const fontsCss = fs.readFileSync(path.join(FONTS, 'fonts.css'), 'utf8');

// House style: minimal · modern · MUTED. Only restrained options exist.
const COLOR_THEMES = ['slate', 'ink', 'indigo', 'ocean', 'sage', 'teal', 'clay', 'stone', 'plum', 'olive'];
const TYPE_PAIRINGS = ['geometric', 'editorial', 'clean', 'startup', 'tech', 'journal', 'warm', 'humanist'];
const DESIGN_KITS = ['minimal', 'paper', 'linen', 'calm', 'harbor'];
const NEW_FONT_FILES = [
  'fraunces-600.woff2', 'outfit-600.woff2', 'sora-600.woff2', 'dmsans-400.woff2', 'dmsans-600.woff2',
  'manrope-600.woff2', 'jakarta-400.woff2', 'jakarta-600.woff2', 'lora-400.woff2', 'newsreader-400.woff2',
];
// High-contrast / loud faces that were intentionally REMOVED (must not return).
const REMOVED_FONTS = ['playfair-600.woff2', 'instrumentserif-400.woff2', 'bricolage-600.woff2', 'worksans-400.woff2', 'spectral-400.woff2'];

test('themes.css defines a curated set of muted colour personalities (10)', () => {
  for (const t of COLOR_THEMES) {
    assert.ok(themes.includes(`[data-theme~='${t}']`), `missing colour theme: ${t}`);
  }
  assert.ok(COLOR_THEMES.length >= 10);
});

test('themes.css defines the typography pairings via data-type (8, clean only)', () => {
  for (const p of TYPE_PAIRINGS) {
    assert.ok(themes.includes(`[data-type='${p}']`), `missing type pairing: ${p}`);
  }
  // each pairing must set a display family
  assert.match(themes, /\[data-type='editorial'\][^}]*--font-display:\s*'Source Serif 4'/);
  assert.match(themes, /\[data-type='warm'\][^}]*--font-display:\s*'Fraunces'/);
});

test('themes.css defines complete design kits via data-kit (5, muted)', () => {
  for (const k of DESIGN_KITS) {
    assert.ok(themes.includes(`[data-kit='${k}']`), `missing design kit: ${k}`);
    const m = themes.match(new RegExp(`\\[data-kit='${k}'\\]\\s*\\{([^}]*)\\}`));
    assert.ok(m, `no block for kit ${k}`);
    assert.match(m[1], /--accent:\s*#[0-9a-fA-F]{6}/, `kit ${k} missing accent`);
    assert.match(m[1], /--font-display:/, `kit ${k} missing font-display`);
  }
});

test('the MENU stays restrained (no neon themes / no high-contrast pairings)', () => {
  // The data-theme/data-kit MENU is the muted FALLBACK; bespoke vibrant palettes come from
  // design_direction, not the menu. So loud/neon menu themes + flashy pairings must NOT exist.
  for (const gone of ['crimson', 'sky', 'amber', 'rose', 'coral', 'lime', 'sunset', 'gold']) {
    assert.ok(!themes.includes(`[data-theme~='${gone}']`), `loud theme should be removed: ${gone}`);
  }
  for (const gone of ['fashion', 'chic', 'contemporary', 'grand', 'press']) {
    assert.ok(!themes.includes(`[data-type='${gone}']`), `high-contrast pairing should be removed: ${gone}`);
  }
});

test('art-direction layer: deliberate display faces + a MONO/DATA role are available', () => {
  // The new philosophy: deliberate non-default faces ARE allowed (Spectral, Bricolage), and a
  // mono DATA face is the cheapest tell of editorial design. These are now first-class.
  for (const fam of ['Spectral', 'Bricolage Grotesque', 'IBM Plex Mono', 'Space Mono', 'Hanken Grotesk']) {
    assert.ok(fontsCss.includes(`font-family:'${fam}'`), `art-direction font missing: ${fam}`);
  }
  for (const f of ['spectral-600.woff2', 'bricolage-700.woff2', 'ibmplexmono-500.woff2', 'spacemono-400.woff2', 'hanken-400.woff2', 'hanken-600.woff2']) {
    const p = path.join(FONTS, f);
    assert.ok(fs.existsSync(p), `missing art-direction font file ${f}`);
    assert.ok(fs.statSync(p).size > 3000, `font ${f} looks empty/truncated`);
  }
  // The two deliberate pairings (incl. a mono role) exist in the menu.
  assert.ok(themes.includes(`[data-type='grotesk']`), 'missing grotesk pairing');
  assert.ok(themes.includes(`[data-type='institutional']`), 'missing institutional pairing');
  assert.match(themes, /\[data-type='institutional'\][^}]*--font-mono:\s*'IBM Plex Mono'/);
  // Truly low-quality/ubiquitous defaults are still NOT reflexively declared.
  for (const fam of ['Playfair Display', 'Instrument Serif', 'Work Sans']) {
    assert.ok(!fontsCss.includes(`font-family:'${fam}'`), `unwanted default still declared: ${fam}`);
  }
  // The specific old weight files that were removed stay gone.
  for (const f of REMOVED_FONTS) {
    assert.ok(!fs.existsSync(path.join(FONTS, f)), `removed font file still present: ${f}`);
  }
});

test('every muted accent is genuinely low-chroma (max−min channel ≤ ~120)', () => {
  // A loud/neon accent has a huge spread between its RGB channels; muted tones are tight.
  const blocks = [...themes.matchAll(/--accent:\s*#([0-9a-fA-F]{6})/g)].map((m) => m[1]);
  assert.ok(blocks.length >= 10);
  for (const hex of blocks) {
    const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    assert.ok(spread <= 130, `accent #${hex} is too saturated for the muted house style (spread ${spread})`);
  }
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

test('fonts.css declares the curated families and the woff2 files exist', () => {
  for (const fam of ['Fraunces', 'Outfit', 'Sora', 'DM Sans', 'Manrope', 'Plus Jakarta Sans', 'Lora', 'Newsreader']) {
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
  assert.ok(refs.length >= 14);
  for (const r of refs) {
    assert.ok(fs.existsSync(path.join(FONTS, r)), `fonts.css references a missing file: ${r}`);
  }
});
