import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDirectivePrompt,
  buildGenPrompt,
  buildPolishPrompt,
  buildRecolorPrompt,
  directiveMarkdown,
  extractSvg,
  logoSpec,
  looksLikeSvg,
  parseDirective,
  type Directive,
  type LogoInput,
} from '../src/agent/logo';
import { embedFontsInSvg, fontCatalogText, fontFaceCss, usedFamilies } from '../src/agent/fontkit';

const input: LogoInput = {
  brandName: 'ARKS',
  brandDescription: 'a navigation and investment group',
  directions: ['a sailboat', 'a compass'],
  paletteHint: 'navy and gold',
  vibe: 'premium, trustworthy',
  route: 'auto',
};

const directive: Directive = {
  brandName: 'ARKS',
  tagline: 'Safe harbour',
  concept: 'A sailboat built from primitive shapes',
  rationale: 'The ark is a vessel.',
  route: 'concept',
  palette: [
    { name: 'Navy', hex: '#0A2540', role: 'primary' },
    { name: 'Gold', hex: '#C9A24B', role: 'accent' },
    { name: 'Ivory', hex: '#F5F1E8', role: 'background' },
  ],
  typography: { display: 'Fraunces', body: 'Inter' },
  background: 'light',
};

test('logoSpec encodes the one law (no morphing) and the primitive vocabulary', () => {
  const s = logoSpec();
  assert.match(s, /NO MORPHING/i);
  assert.match(s, /real type|REAL TYPE/);
  assert.match(s, /<polygon>/);
  assert.match(s, /viewBox "0 0 100 100"/);
});

test('extractSvg pulls the last svg block; looksLikeSvg gates junk', () => {
  const txt = 'blah <svg><rect/></svg> mid <svg viewBox="0 0 100 100"><circle/></svg> end';
  const svg = extractSvg(txt);
  assert.ok(svg && /circle/.test(svg));
  assert.ok(looksLikeSvg('<svg viewBox="0 0 100 100"><rect width="100" height="100"/></svg>'));
  assert.ok(!looksLikeSvg('sorry I cannot'));
  assert.ok(!looksLikeSvg(null));
});

test('buildDirectivePrompt carries brand, directions, palette hint and the font catalogue', () => {
  const p = buildDirectivePrompt(input);
  assert.match(p, /ARKS/);
  assert.match(p, /sailboat/);
  assert.match(p, /navy and gold/);
  assert.match(p, /Fraunces|Space Grotesk|Playfair Display/); // catalogue is present
  assert.match(p, /role.*background|"background"/);
});

test('buildGenPrompt locks the directive: palette hexes, route, display font', () => {
  const p = buildGenPrompt(input, directive);
  assert.match(p, /#0A2540/);
  assert.match(p, /#C9A24B/);
  assert.match(p, /concept/);
  assert.match(p, /Fraunces/);
  assert.match(p, /NO MORPHING/i); // spec embedded
});

test('buildPolishPrompt keeps font + palette and injects the named defects', () => {
  const p = buildPolishPrompt('<svg><rect/></svg>', directive, 'the keel is asymmetric');
  assert.match(p, /Fraunces/);
  assert.match(p, /#0A2540/);
  assert.match(p, /keel is asymmetric/);
  assert.match(p, /do NOT change the idea/i);
});

test('buildRecolorPrompt targets the opposite background', () => {
  const dark = buildRecolorPrompt('<svg/>', directive, 'dark');
  assert.match(dark, /DARK background/);
  const light = buildRecolorPrompt('<svg/>', directive, 'light');
  assert.match(light, /LIGHT background/);
});

test('parseDirective: valid JSON round-trips; junk falls back to inputs', () => {
  const good = JSON.stringify({
    brandName: 'Nimbus',
    concept: 'a cloud',
    rationale: 'soft',
    route: 'concept',
    palette: [
      { name: 'Sky', hex: '#3A7BD5', role: 'primary' },
      { name: 'White', hex: '#FFFFFF', role: 'background' },
    ],
    typography: { display: 'Poppins', body: 'Inter' },
    background: 'light',
  });
  const d = parseDirective('noise ' + good + ' tail', input);
  assert.equal(d.brandName, 'Nimbus');
  assert.equal(d.route, 'concept');
  assert.equal(d.typography.display, 'Poppins');
  assert.ok(d.palette.some((p) => p.role === 'background'));

  const fb = parseDirective('the model rambled with no json', input);
  assert.equal(fb.brandName, 'ARKS');
  assert.ok(fb.palette.length >= 2);
  assert.ok(fb.palette.some((p) => p.role === 'background'));
});

test('parseDirective injects a background colour when the model forgot one', () => {
  const noBg = JSON.stringify({
    concept: 'x',
    palette: [
      { name: 'A', hex: '#111111', role: 'primary' },
      { name: 'B', hex: '#222222', role: 'accent' },
    ],
    typography: { display: 'Sora', body: 'Inter' },
  });
  const d = parseDirective(noBg, input);
  assert.ok(d.palette.some((p) => p.role === 'background'));
});

test('directiveMarkdown renders a palette table with hexes', () => {
  const md = directiveMarkdown(directive);
  assert.match(md, /# ARKS — Brand Directive/);
  assert.match(md, /#0A2540/i);
  assert.match(md, /Fraunces/);
  assert.match(md, /\| Colour \| Hex \| Role \|/);
});

test('fontkit: catalogue lists sans + serif + display families', () => {
  const c = fontCatalogText();
  assert.match(c, /Space Grotesk/);
  assert.match(c, /Playfair Display/);
  assert.match(c, /Sans \/ geometric/);
  assert.match(c, /Display/);
});

test('fontkit: usedFamilies detects referenced families; embedFontsInSvg injects @font-face', () => {
  const svg = '<svg viewBox="0 0 100 100"><text font-family="Fraunces, serif">A</text></svg>';
  assert.deepEqual(usedFamilies(svg), ['Fraunces']);
  const embedded = embedFontsInSvg(svg);
  assert.match(embedded, /<style>/);
  assert.match(embedded, /@font-face/);
  assert.match(embedded, /Fraunces/);
  // a pure-shape mark gets no style block
  const shape = '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40"/></svg>';
  assert.equal(embedFontsInSvg(shape), shape);
});

test('fontkit: fontFaceCss embeds base64 woff2 for a requested family', () => {
  const css = fontFaceCss(['Space Grotesk']);
  assert.match(css, /@font-face/);
  assert.match(css, /Space Grotesk/);
  assert.match(css, /base64,/);
});
