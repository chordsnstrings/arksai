import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { designCore } from '../src/agent/designSystem';

const ASSETS = path.join(__dirname, '..', 'assets');
const craft = fs.readFileSync(path.join(ASSETS, 'ui-kit', 'craft.css'), 'utf8');
const siteJs = fs.readFileSync(path.join(ASSETS, 'web-app-template', 'site.js'), 'utf8');
const siteCss = fs.readFileSync(path.join(ASSETS, 'web-app-template', 'site.css'), 'utf8');
const indexHtml = fs.readFileSync(path.join(ASSETS, 'web-app-template', 'index.html'), 'utf8');

test('craft.css ships a robust, clip-safe .ticket boarding-pass component', () => {
  for (const sel of ['.ticket', '.ticket-stub', '.ticket-code', '.ticket-main']) {
    assert.ok(craft.includes(sel), `craft.css missing ${sel}`);
  }
  // clip-safe by construction: overflow hidden on the card, and the stub reflows on small phones
  assert.match(craft, /\.ticket\s*\{[^}]*overflow:\s*hidden/);
  assert.match(craft, /max-width:\s*520px[^@]*\.ticket\s*\{[^}]*grid-template-columns:\s*1fr/s);
  // no rotation on the ticket (rotation clips edge labels — the failure we fixed)
  const ticketBlock = craft.slice(craft.indexOf('.ticket {'), craft.indexOf('.ticket:hover'));
  assert.doesNotMatch(ticketBlock, /rotate\(/);
});

test('craft.css adds richer, reduced-motion-safe motion utilities', () => {
  for (const sel of ['.tilt', '.sheen', '.float', 'craft-float']) {
    assert.ok(craft.includes(sel), `craft.css missing ${sel}`);
  }
  // every new motion utility is disabled under reduced motion
  const rm = craft.slice(craft.indexOf('prefers-reduced-motion'));
  assert.match(rm, /\.float\s*\{\s*animation:\s*none/);
  assert.match(rm, /\.tilt/);
});

test('scaffold site.js wires scroll-reveal + count-up, guarded by reduced-motion', () => {
  assert.match(siteJs, /\[data-reveal\]/);
  assert.match(siteJs, /\[data-count\]/);
  assert.match(siteJs, /IntersectionObserver/);
  assert.match(siteJs, /prefers-reduced-motion/);
  // reduced-motion path still reveals content (never leaves it hidden)
  assert.match(siteJs, /classList\.add\('in'\)/);
});

test('the scaffold demonstrates motion out of the box', () => {
  assert.match(indexHtml, /data-reveal/);
  assert.match(indexHtml, /data-count/);
  assert.match(indexHtml, /class="card lift"/);
  assert.match(indexHtml, /sheen/);
  // mechanics (site.css) stays look-free
  assert.doesNotMatch(siteCss, /--accent: #3a5a78/);
});

test('Open Props subset is vendored, namespaced (no conflict), and reduced-motion-safe', () => {
  const op = fs.readFileSync(path.join(ASSETS, 'ui-kit', 'open-props.css'), 'utf8');
  assert.match(op, /MIT License/);
  assert.match(op, /--animation-fade-in/);
  assert.match(op, /--gradient-7|--gradient-1\b/);
  assert.match(op, /--ease-elastic-3/);
  assert.match(op, /@keyframes/);
  // namespaced under :where() (zero specificity) so it can't override our tokens
  assert.match(op, /:where\(html\)/);
  // animations disabled under reduced motion
  assert.match(op, /prefers-reduced-motion[\s\S]*--animation-fade-in:\s*none/);
  // the scaffold links it
  assert.match(indexHtml, /ui-kit\/open-props\.css/);
});

test('the minimal·polished·responsive bar is locked regardless of the toolkit', () => {
  assert.match(designCore, /THE BAR HOLDS NO MATTER THE TOOLKIT/);
  assert.match(designCore, /MINIMAL · MODERN ·\s+POLISHED/);
  assert.match(designCore, /FULLY RESPONSIVE/);
  assert.match(designCore, /themed to YOUR tokens and passes the responsive \+ contrast gate/);
});

test('craft.css ships a legible-by-default, fallback-safe glassmorphism utility', () => {
  assert.ok(craft.includes('.glass'));
  assert.match(craft, /@supports[^{]*backdrop-filter/);
  assert.match(craft, /backdrop-filter:/);
  assert.match(craft, /prefers-reduced-transparency/); // accessibility → solid fallback
  // the non-supports fallback is a near-solid surface (so text stays AA everywhere)
  assert.match(craft, /\.glass\s*\{[^}]*background:\s*color-mix\(in srgb, var\(--bg/);
});

test('craft.css ships GPU-cheap, reduced-motion-safe hero effects', () => {
  for (const sel of ['.ken-burns', '.gradient-drift', '[data-tilt]', '[data-parallax]', 'craft-kenburns']) {
    assert.ok(craft.includes(sel), `craft.css missing hero effect ${sel}`);
  }
  // all hero motion is disabled under reduced motion
  const rm = craft.slice(craft.lastIndexOf('prefers-reduced-motion'));
  assert.match(craft, /prefers-reduced-motion[\s\S]*\.ken-burns[\s\S]*animation:\s*none/);
  void rm;
});

test('site.js gates tilt/parallax to desktop pointer + motion, transform-only', () => {
  assert.match(siteJs, /\[data-tilt\]/);
  assert.match(siteJs, /\[data-parallax\]/);
  assert.match(siteJs, /hover: hover\) and \(pointer: fine/); // desktop pointer only
  assert.match(siteJs, /translate3d/); // transform-only parallax (no layout thrash)
  assert.match(siteJs, /requestAnimationFrame/); // throttled
  // bails on reduced-motion / touch / small
  assert.match(siteJs, /if \(reduce \|\| !finePointer \|\| !wide\) return/);
});

test('designCore steers ONE hero moment by fit, not forced parallax', () => {
  assert.match(designCore, /HERO ENGAGEMENT/);
  assert.match(designCore, /ONE tasteful moment/);
  assert.match(designCore, /heavy scroll-jacked parallax/);
  assert.match(designCore, /reduced-motion/);
});

test('designCore demands colour care + modern techniques under the minimal bar', () => {
  assert.match(designCore, /COLOUR — EXTREME CARE/);
  assert.match(designCore, /ramp|--accent-deep|--accent-tint/);
  assert.match(designCore, /MODERN TECHNIQUES/);
  assert.match(designCore, /GLASSMORPHISM/);
  // techniques are explicitly subordinate to minimal/legibility
  assert.match(designCore, /in service of MINIMAL, never instead of it/);
});

test('designCore steers robust components + a lively-but-bounded motion bar', () => {
  // use the robust component instead of a fragile hand-built one (anti-whack-a-mole)
  assert.match(designCore, /\.ticket/);
  assert.match(designCore, /20-round|fragile/i);
  // motion is part of the bar, drawn from the free kit utilities
  assert.match(designCore, /MOTION \(the page should feel ALIVE/);
  assert.match(designCore, /\[data-count\]/);
  assert.match(designCore, /prefers-reduced-motion/);
});
