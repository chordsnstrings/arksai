import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const craft = fs.readFileSync(path.join(__dirname, '..', 'assets', 'ui-kit', 'craft.css'), 'utf8');

test('craft.css ships a .gauge progress ring drawn by stroke-dasharray, NOT rotation (no breath-ring loop)', () => {
  for (const sel of ['.gauge', '.gauge-track', '.gauge-fill', '.gauge-num']) {
    assert.ok(craft.includes(sel), `craft.css missing ${sel}`);
  }
  // the fill is a dasharray/dashoffset arc, not a rotated/animated ring
  assert.match(craft, /\.gauge-fill\s*\{[^}]*stroke-dasharray/);
  assert.match(craft, /\.gauge-fill\s*\{[^}]*stroke-dashoffset/);
  // the ONLY rotate in the gauge is the static -90deg start (no animated rotation)
  const fillBlock = (craft.match(/\.gauge-fill\s*\{[^}]*stroke-dashoffset[^}]*\}/) ?? [''])[0];
  const rotates = fillBlock.match(/rotate\(([^)]*)\)/g) ?? [];
  assert.equal(rotates.length, 1, 'gauge-fill should have exactly one (static) rotate');
  assert.match(rotates[0], /-90deg/, 'the only rotate is the static -90deg start');
  // --circ matches 2π·52 (the documented r)
  const circ = /--circ:\s*([\d.]+)/.exec(craft)?.[1];
  assert.ok(circ, 'gauge defines --circ');
  assert.ok(Math.abs(Number(circ) - 2 * Math.PI * 52) < 0.1, `--circ ${circ} ≈ 2π·52`);
  // reduced-motion disables the gauge fill transition
  assert.match(craft, /prefers-reduced-motion[^}]*\.gauge-fill[^}]*transition:\s*none/s);
});

test('craft.css ships .stat (tabular KPI) and .table-wrap (responsive table) primitives', () => {
  for (const sel of ['.stat', '.stat-num', '.stat-trend', '.stat-trend.is-up', '.stat-trend.is-down']) {
    assert.ok(craft.includes(sel), `craft.css missing ${sel}`);
  }
  assert.match(craft, /\.stat-num\s*\{[^}]*tabular-nums/);
  // table scrolls instead of overflowing the page
  assert.match(craft, /\.table-wrap\s*\{[^}]*overflow-x:\s*auto/);
  assert.ok(craft.includes('.table--sticky'), 'optional sticky label column');
});
