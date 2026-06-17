import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCreativeHtml, CREATIVE_SIZES, scrubImageryPrompt } from '../src/agent/creative';
import { resolveCreativePrompt } from '../src/agent/tools/creative';
import { isValidImageBytes } from '../src/engines/minimax';

const base = {
  bgDataUrl: 'data:image/png;base64,AAAA',
  copy: { accent: '#c0502f', kicker: 'New · Launch', headline: 'Line one\nline two', sub: 'A supporting line.', cta: 'Shop now →' },
  w: 1080,
  h: 1080,
  fontsCss: '/* no fonts in test */',
};

test('buildCreativeHtml: headline newline → <br>, copy escaped, accent on the CTA', () => {
  const html = buildCreativeHtml({ ...base, zone: 'bottom', textColor: 'light' });
  assert.match(html, /Line one<br>line two/); // newline became a break
  assert.match(html, /background:#c0502f/); // CTA uses the brand accent
  assert.match(html, /Shop now/);
  assert.ok(html.includes(base.bgDataUrl));
});

test('buildCreativeHtml: a missing headline is omitted (never blocks output)', () => {
  const html = buildCreativeHtml({ ...base, zone: 'bottom', textColor: 'dark', copy: { ...base.copy, headline: '' } });
  assert.doesNotMatch(html, /class="h"/); // no empty headline element
  assert.match(html, /class="bg"/); // the image + composite still render
});

test('buildCreativeHtml: light vs dark text colour drives ink + scrim', () => {
  const light = buildCreativeHtml({ ...base, zone: 'bottom', textColor: 'light' });
  const dark = buildCreativeHtml({ ...base, zone: 'bottom', textColor: 'dark' });
  assert.match(light, /color:#ffffff/);
  assert.match(dark, /color:#1b1813/);
});

test('buildCreativeHtml: a right-zone anchors the content to the right', () => {
  const html = buildCreativeHtml({ ...base, zone: 'right', textColor: 'light' });
  assert.match(html, /align-items:flex-end/);
});

test('buildCreativeHtml: a logo / placeholder renders in the brand corner, omitted otherwise', () => {
  const withLogo = buildCreativeHtml({ ...base, zone: 'bottom', textColor: 'light', logoDataUrl: 'data:image/png;base64,LOGO' });
  assert.match(withLogo, /class="brand"><img src="data:image\/png;base64,LOGO"/);
  const placeholder = buildCreativeHtml({ ...base, zone: 'bottom', textColor: 'light', logoPlaceholder: true });
  assert.match(placeholder, /class="ph">LOGO</);
  const without = buildCreativeHtml({ ...base, zone: 'bottom', textColor: 'light' });
  assert.doesNotMatch(without, /class="brand"/);
});

test('buildCreativeHtml: an SVG logo gets an explicit width box (so it never renders blank)', () => {
  const svg = buildCreativeHtml({ ...base, zone: 'bottom', textColor: 'light', logoDataUrl: 'data:image/svg+xml;base64,LOGO', logoIsSvg: true });
  assert.match(svg, /\.brand img\{width:\d+px;height:/); // explicit width for SVG
  const png = buildCreativeHtml({ ...base, zone: 'bottom', textColor: 'light', logoDataUrl: 'data:image/png;base64,LOGO' });
  assert.match(png, /\.brand img\{height:/); // raster keeps natural width (no forced width)
  assert.doesNotMatch(png, /\.brand img\{width:/);
});

test('buildCreativeHtml: a feature list renders check-marked bullets, escaped', () => {
  const html = buildCreativeHtml({ ...base, zone: 'bottom', textColor: 'dark', copy: { ...base.copy, bullets: ['Quick turnaround', 'Embassy-ready files'] } });
  assert.match(html, /class="bl"/);
  assert.match(html, /Quick turnaround/);
  assert.match(html, /Embassy-ready files/);
  assert.equal((html.match(/class="ck"/g) || []).length, 2);
  const none = buildCreativeHtml({ ...base, zone: 'bottom', textColor: 'dark' });
  assert.doesNotMatch(none, /class="bl"/);
});

test('buildCreativeHtml: escapes HTML in copy (no injection)', () => {
  const html = buildCreativeHtml({ ...base, zone: 'bottom', textColor: 'dark', copy: { ...base.copy, headline: '<script>x</script>' } });
  assert.doesNotMatch(html, /<script>x<\/script>/);
  assert.match(html, /&lt;script&gt;/);
});

test('scrubImageryPrompt: strips the copy fields out of the imagery prompt', () => {
  const copy = { accent: '#000', headline: 'UK Tourist Visa', sub: 'Fast & accurate processing', cta: 'Apply now', bullets: ['Quick turnaround'] };
  const out = scrubImageryPrompt(
    'London travel scene with the text "UK Tourist Visa" and Fast & accurate processing, Big Ben, a red bus',
    copy,
  );
  assert.doesNotMatch(out, /UK Tourist Visa/i);
  assert.doesNotMatch(out, /Fast & accurate processing/i);
  assert.match(out, /Big Ben/); // the actual scene survives
  assert.match(out, /red bus/);
});

test('scrubImageryPrompt: removes quoted strings and "that says" lead-ins', () => {
  const out = scrubImageryPrompt('a calm beach at sunset that says “Summer Sale”, minimal', { accent: '#000', headline: 'Summer Sale' });
  assert.doesNotMatch(out, /Summer Sale/);
  assert.doesNotMatch(out, /that says/i);
  assert.match(out, /calm beach at sunset/);
});

test('scrubImageryPrompt: never returns empty (falls back to the original)', () => {
  // a prompt that is ENTIRELY the headline → scrub would empty it; must fall back
  const out = scrubImageryPrompt('Summer Sale', { accent: '#000', headline: 'Summer Sale' });
  assert.ok(out.length > 0);
});

test('resolveCreativePrompt: recognizes style_prompt (the operator-reported 0.0s failure)', () => {
  // exactly what the model sent in the failing call
  const args = { creative_name: 'uk-tourist-visa-social-post', aspect_ratio: '1:1', style_prompt: 'A happy South Asian couple exploring London' };
  assert.equal(resolveCreativePrompt(args), 'A happy South Asian couple exploring London');
});

test('resolveCreativePrompt: prefers known aliases over the fallback', () => {
  assert.equal(resolveCreativePrompt({ imagery_prompt: 'a beach', headline: 'this is a much longer headline string' }), 'a beach');
});

test('resolveCreativePrompt: falls back to the longest non-prompt string when no alias matches', () => {
  // a totally unknown field name → use it rather than hard-failing
  assert.equal(resolveCreativePrompt({ the_picture: 'a serene mountain lake at dawn', aspect_ratio: '16:9' }), 'a serene mountain lake at dawn');
});

test('resolveCreativePrompt: never grabs known non-prompt fields, returns "" only when truly empty', () => {
  assert.equal(resolveCreativePrompt({ aspect_ratio: '1:1', accent: '#fff', headline: 'Hi', cta: 'Go' }), '');
});

test('isValidImageBytes: accepts real PNG/JPEG, rejects empty / error-page / too-tiny', () => {
  assert.equal(isValidImageBytes(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(600)])), true); // PNG
  assert.equal(isValidImageBytes(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(600)])), true); // JPEG
  assert.equal(isValidImageBytes(Buffer.alloc(0)), false); // empty download
  assert.equal(isValidImageBytes(Buffer.concat([Buffer.from('<!DOCTYPE html><html>error'), Buffer.alloc(600)])), false); // error page (no magic)
  assert.equal(isValidImageBytes(Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])), false); // valid magic but truncated/tiny
});

test('CREATIVE_SIZES: every channel ratio maps to a canvas + a MiniMax gen ratio', () => {
  for (const k of ['1:1', '4:5', '9:16', '16:9', '1.91:1']) {
    const s = CREATIVE_SIZES[k];
    assert.ok(s && s.w > 0 && s.h > 0 && /^[0-9]+:[0-9]+$/.test(s.gen), `bad size for ${k}`);
  }
});
