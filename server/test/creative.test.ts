import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCreativeHtml, CREATIVE_SIZES } from '../src/agent/creative';

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

test('CREATIVE_SIZES: every channel ratio maps to a canvas + a MiniMax gen ratio', () => {
  for (const k of ['1:1', '4:5', '9:16', '16:9', '1.91:1']) {
    const s = CREATIVE_SIZES[k];
    assert.ok(s && s.w > 0 && s.h > 0 && /^[0-9]+:[0-9]+$/.test(s.gen), `bad size for ${k}`);
  }
});
