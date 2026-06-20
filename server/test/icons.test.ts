import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ICON_CATALOG, ICON_NAMES, iconSvg, hasIcon, buildIconSprite, ICON_LIST_TEXT } from '../src/agent/tools/icons';

const SPRITE_FILE = path.join(__dirname, '..', 'assets', 'report-fonts', 'icons.svg');

test('the catalog is broad — many beautiful, well-loved icons across categories', () => {
  assert.ok(ICON_NAMES.length >= 100, `expected a rich set, got ${ICON_NAMES.length}`);
  assert.ok(Object.keys(ICON_CATALOG).length >= 8, 'expected several themed categories');
  // the brand/lifestyle icons a real website kept lacking
  for (const n of ['coffee', 'leaf', 'sun', 'mail', 'heart', 'sparkles', 'star', 'shopping-cart', 'wifi', 'home']) {
    assert.ok(hasIcon(n), `missing well-loved icon: ${n}`);
  }
});

test('every icon name is unique across categories (no shadowing)', () => {
  const seen = new Set<string>();
  for (const group of Object.values(ICON_CATALOG)) {
    for (const name of Object.keys(group)) {
      assert.ok(!seen.has(name), `duplicate icon name across categories: ${name}`);
      seen.add(name);
    }
  }
  assert.equal(seen.size, ICON_NAMES.length);
});

test('every icon has real inner markup (path/circle/rect/line/polygon/polyline)', () => {
  for (const group of Object.values(ICON_CATALOG)) {
    for (const [name, inner] of Object.entries(group)) {
      assert.ok(inner.length > 5, `${name} has empty markup`);
      assert.match(inner, /<(path|circle|rect|line|polygon|polyline|ellipse)\b/, `${name} has no drawable shape`);
    }
  }
});

test('iconSvg returns a standalone recolourable svg; unknown name falls back to circle', () => {
  const svg = iconSvg('coffee', '#B8511A', 32, 2);
  assert.match(svg, /^<svg/);
  assert.match(svg, /viewBox="0 0 24 24"/);
  assert.match(svg, /stroke="#B8511A"/);
  assert.match(svg, /width="32"/);
  // bare hex (no #) is normalised
  assert.match(iconSvg('leaf', 'ff0000'), /stroke="#ff0000"/);
  // unknown → circle fallback (never throws / never blank)
  assert.equal(iconSvg('totally-not-an-icon').includes('<circle'), true);
});

test('buildIconSprite emits one <symbol> per icon, currentColor stroke', () => {
  const sprite = buildIconSprite();
  assert.match(sprite, /^<svg[^>]*style="display:none"/);
  for (const name of ICON_NAMES) {
    assert.ok(sprite.includes(`id="${name}"`), `sprite missing symbol id="${name}"`);
  }
  // currentColor → CSS `color` recolours it on a website
  assert.match(sprite, /stroke="currentColor"/);
  // symbol count matches icon count
  assert.equal((sprite.match(/<symbol /g) || []).length, ICON_NAMES.length);
});

test('the committed icons.svg matches buildIconSprite() — no drift', () => {
  const onDisk = fs.readFileSync(SPRITE_FILE, 'utf8');
  assert.equal(
    onDisk,
    buildIconSprite(),
    'icons.svg is stale — regenerate it from buildIconSprite() (single source of truth)',
  );
});

test('ICON_LIST_TEXT advertises the categories + names for the agent', () => {
  assert.ok(ICON_LIST_TEXT.includes('coffee'));
  assert.ok(ICON_LIST_TEXT.includes('Food & lifestyle'));
  assert.ok(ICON_LIST_TEXT.split('\n').length >= 8);
});
