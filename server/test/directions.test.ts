import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DIRECTIONS, directionsMenu, directionFontsLink, directionById } from '../src/agent/directions';
import { designContext } from '../src/agent/designSystem';

test('the library has 40 directions with unique ids', () => {
  assert.equal(DIRECTIONS.length, 40);
  const ids = new Set(DIRECTIONS.map((d) => d.id));
  assert.equal(ids.size, 40, 'all direction ids are unique');
});

test('every direction is well-formed (fonts, accent, signature)', () => {
  for (const d of DIRECTIONS) {
    assert.ok(d.name && d.mood && d.signature, `${d.id} has name/mood/signature`);
    assert.match(d.accent, /^#[0-9a-f]{3,8}$/i, `${d.id} accent is a hex`);
    for (const f of [d.display, d.body, d.data]) assert.ok(f && f.length > 1, `${d.id} has a font`);
    assert.ok(['modern', 'glass', 'structural', 'aesthetic'].includes(d.group), `${d.id} has a valid group`);
  }
});

test('every direction builds a valid Google Fonts link from known families', () => {
  for (const d of DIRECTIONS) {
    const url = directionFontsLink(d);
    assert.ok(url.startsWith('https://fonts.googleapis.com/css2?family='), `${d.id} fonts link`);
    // a font with no registered fragment would yield an empty family= segment
    assert.doesNotMatch(url, /family=&|family=$/, `${d.id} has no unresolved font fragment`);
  }
});

test('all four groups are represented and counts add up', () => {
  const by = (g: string) => DIRECTIONS.filter((d) => d.group === g).length;
  assert.equal(by('modern'), 18);
  assert.equal(by('glass'), 8);
  assert.equal(by('structural'), 8);
  assert.equal(by('aesthetic'), 6);
});

test('directionsMenu lists every direction grouped', () => {
  const menu = directionsMenu();
  for (const d of DIRECTIONS) assert.ok(menu.includes(d.name), `menu mentions ${d.name}`);
  assert.match(menu, /Modern product archetypes/);
  assert.match(menu, /Glassmorphism levels/);
});

test('directionById resolves and rejects', () => {
  assert.equal(directionById('linear')?.name, 'Linear Dark');
  assert.equal(directionById('nope'), undefined);
});

test('designContext injects the direction library for a visual task, not for generic/backend', () => {
  const visual = designContext({ type: 'web-app', isVisual: true, tier: 'standard' });
  assert.match(visual, /Direction library — 40 tested modern recipes/);
  assert.match(visual, /Cyberpunk HUD/);
  assert.match(visual, /invent your OWN brand name/i);
  // a non-visual backend task gets only the DX delta, never the design core/library
  const api = designContext({ type: 'api', isVisual: false, tier: 'standard' });
  assert.doesNotMatch(api, /Direction library/);
});
