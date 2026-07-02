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
  auditCssCascade,
  findMissingLocalAssets,
} from '../src/agent/webHygiene';
import { isBlockingDefect } from '../src/agent/uiCheck';

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

test('findMissingLocalAssets / auditWebHygiene: flag a referenced local asset that does not exist', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webhyg-'));
  try {
    // The real bug: index links site.css/site.js (exist) + landing.css/landing.js (missing).
    fs.writeFileSync(path.join(dir, 'site.css'), '.x{color:#000}');
    fs.writeFileSync(path.join(dir, 'site.js'), 'void 0');
    const idx = path.join(dir, 'index.html');
    const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
       <link rel="stylesheet" href="site.css">
       <link rel="stylesheet" href="landing.css">
       <link rel="stylesheet" href="https://fonts.example/x.css"></head>
       <body><div class="wrap"></div><script src="site.js"></script><script src="landing.js"></script></body></html>`;
    fs.writeFileSync(idx, html);

    // The pure detector returns EXACTLY the missing local files (no existing, no external).
    const miss = findMissingLocalAssets(html, idx, dir);
    assert.deepEqual(miss.sort(), ['landing.css', 'landing.js']);

    const r = auditWebHygiene(dir);
    assert.ok(r.defects.some((d) => /don't exist/i.test(d) && /landing\.css/.test(d) && /landing\.js/.test(d)),
      'should flag the missing assets: ' + r.defects.join(' | '));

    // Create the missing files → the detector + audit clear.
    fs.writeFileSync(path.join(dir, 'landing.css'), '.ring{border-radius:50%}');
    fs.writeFileSync(path.join(dir, 'landing.js'), 'void 0');
    assert.deepEqual(findMissingLocalAssets(html, idx, dir), []);
    assert.ok(!auditWebHygiene(dir).defects.some((d) => /don't exist/i.test(d)));
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

test('auditCssCascade: a media rule declared above its base rule is flagged (the TaskForge disease)', () => {
  // The exact shipped pattern: @media above the base rule → base display:flex overrides
  // the mobile display:none at every width (the art panel showed on phones).
  const broken = `
@media (max-width: 900px) { .auth-art { display: none; } .org-pill { padding: 8px; } }
.auth-art { display: flex; align-items: flex-end; padding: 56px; }
.org-pill { display: flex; padding: 10px 12px; }
`;
  const d = auditCssCascade(broken);
  assert.ok(d.length >= 1, 'expected cascade defects');
  assert.match(d.join('\n'), /\.auth-art/);
  assert.match(d.join('\n'), /source order/);

  // The fixed layout — media blocks at the END — is clean.
  const fixed = `
.auth-art { display: flex; align-items: flex-end; padding: 56px; }
.org-pill { display: flex; padding: 10px 12px; }
@media (max-width: 900px) { .auth-art { display: none; } .org-pill { padding: 8px; } }
`;
  assert.equal(auditCssCascade(fixed).length, 0);

  // Media-vs-media (two breakpoints touching the same selector) is NOT a defect.
  const twoMedias = `
.card { padding: 20px; }
@media (max-width: 900px) { .card { padding: 12px; } }
@media (max-width: 480px) { .card { padding: 8px; } }
`;
  assert.equal(auditCssCascade(twoMedias).length, 0);

  // A media rule whose base rule sets DIFFERENT properties is fine (no property clash).
  const noClash = `
@media (max-width: 720px) { .nav { gap: 4px; } }
.nav { color: red; }
`;
  assert.equal(auditCssCascade(noClash).length, 0);
});

test('isBlockingDefect: truncation and signed-in page-audit lines block', () => {
  assert.equal(isBlockingDefect('Signed-in page "Members" at 390px: 6 text fields are truncated to a fraction of their content'), true);
  assert.equal(isBlockingDefect('the heading "Members" is overlapped/covered by another element'), true);
});
