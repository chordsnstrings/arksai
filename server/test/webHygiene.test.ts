import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  hasViewportMeta,
  findFixedMinWidths,
  hasMenuToggle,
  hasToggleWiring,
  auditWebHygiene,
} from '../src/agent/webHygiene';

// A missing <meta viewport> is the headline blind spot of the browser smoke test (Playwright sets
// the viewport itself), so the deterministic check must catch it.
test('hasViewportMeta: present vs absent', () => {
  assert.equal(hasViewportMeta('<head><meta name="viewport" content="width=device-width, initial-scale=1"></head>'), true);
  assert.equal(hasViewportMeta("<head><meta name='viewport' content='width=device-width'></head>"), true);
  assert.equal(hasViewportMeta('<head><title>x</title></head>'), false);
});

test('findFixedMinWidths: flags a hard min-width wider than a phone, ignores safe values', () => {
  assert.deepEqual(findFixedMinWidths('.wrap{min-width:980px}'), [980]);
  assert.deepEqual(findFixedMinWidths('.col{min-width: 420px} .x{min-width:1200px}'), [1200]); // 420 is the boundary, not flagged
  assert.deepEqual(findFixedMinWidths('.c{max-width:1200px;width:100%}'), []); // max-width is fine
  assert.deepEqual(findFixedMinWidths('.btn{min-width:120px}'), []); // small min-width is fine
  assert.deepEqual(findFixedMinWidths('@media (min-width: 721px){.nav{display:flex}}'), []); // a breakpoint is NOT a fixed width
  assert.deepEqual(findFixedMinWidths('@media (min-width:768px){.x{min-width:980px}}'), [980]); // a real one inside still caught
});

test('hasMenuToggle + hasToggleWiring: a dead hamburger is detectable', () => {
  const ham = '<button class="hamburger" aria-label="Menu">☰</button>';
  assert.equal(hasMenuToggle(ham), true);
  assert.equal(hasMenuToggle('<nav><a href="/a">A</a></nav>'), false);
  // wired: any script / details / inline handler / checkbox-hack counts
  assert.equal(hasToggleWiring(ham + '<script>document.querySelector(".hamburger").onclick=()=>{}</script>', ''), true);
  assert.equal(hasToggleWiring('<details><summary>Menu</summary></details>', ''), true);
  assert.equal(hasToggleWiring('<input type="checkbox" id="nav">', '#nav:checked ~ .menu{display:block}'), true);
  // dead: a hamburger with no wiring at all
  assert.equal(hasToggleWiring(ham, '.hamburger{display:block}'), false);
});

test('auditWebHygiene: a broken page is flagged on all three; a good page is clean', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webhyg-'));
  try {
    // Broken: no viewport meta, a fixed 980px min-width, and a hamburger with zero wiring.
    fs.writeFileSync(
      path.join(dir, 'index.html'),
      `<!doctype html><html><head><title>Bad</title>
       <style>.wrap{min-width:980px} .hamburger{display:block}</style></head>
       <body><header><button class="hamburger" aria-label="Menu">☰</button>
       <nav class="links"><a href="/a">A</a></nav></header></body></html>`,
    );
    const bad = auditWebHygiene(dir);
    assert.equal(bad.ran, true);
    assert.equal(bad.defects.length, 3, bad.defects.join(' | '));
    assert.ok(bad.defects.some((d) => /viewport/i.test(d)));
    assert.ok(bad.defects.some((d) => /min-width/i.test(d)));
    assert.ok(bad.defects.some((d) => /menu won't open|hamburger/i.test(d)));

    // Good: viewport present, fluid widths, a wired toggle.
    fs.writeFileSync(
      path.join(dir, 'index.html'),
      `<!doctype html><html><head><title>Good</title>
       <meta name="viewport" content="width=device-width, initial-scale=1">
       <style>.wrap{max-width:1100px;width:100%}</style></head>
       <body><header><button class="hamburger" aria-label="Menu">☰</button>
       <nav class="links"><a href="/a">A</a></nav></header>
       <script>document.querySelector('.hamburger').addEventListener('click',()=>document.querySelector('.links').classList.toggle('open'))</script>
       </body></html>`,
    );
    const good = auditWebHygiene(dir);
    assert.deepEqual(good.defects, [], good.defects.join(' | '));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('auditWebHygiene: no HTML in the dir → did not run, no defects', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webhyg-'));
  try {
    fs.writeFileSync(path.join(dir, 'app.js'), 'console.log(1)');
    assert.deepEqual(auditWebHygiene(dir), { ran: false, defects: [] });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
