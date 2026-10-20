import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildCreativeHtml, composeCreative, CREATIVE_SIZES, scrubImageryPrompt } from '../src/agent/creative';
import { resolveCreativePrompt } from '../src/agent/tools/creative';
import { costFromUsage, endpointFor, imageErrorMessage, isValidImageBytes, MODELARK_MISSING, seedreamSize } from '../src/engines/modelark';
import { __setByteplusKeyForTest } from '../src/agent/byteplusRuntime';
import { config } from '../src/config';

const base = {
  bgDataUrl: 'data:image/png;base64,AAAA',
  copy: { accent: '#c0502f', kicker: 'New · Launch', headline: 'Line one\nline two', sub: 'A supporting line.', cta: 'Shop now →' },
  w: 1080,
  h: 1080,
  fontsCss: '/* no fonts in test */',
};

test('buildCreativeHtml: a LITERAL backslash-n in the headline also becomes <br> (no stray \\n)', () => {
  const html = buildCreativeHtml({ ...base, copy: { ...base.copy, headline: 'Resolve conflicts\\nin minutes' }, zone: 'bottom', textColor: 'light' });
  assert.match(html, /Resolve conflicts<br>in minutes/);
  assert.ok(!/conflicts\\nin/.test(html), 'literal \\n must not survive into the rendered headline');
});

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

test('CREATIVE_SIZES: every channel ratio maps to a canvas + a native Seedream size of the SAME aspect', () => {
  for (const k of ['1:1', '4:5', '9:16', '16:9', '1.91:1']) {
    const s = CREATIVE_SIZES[k];
    assert.ok(s && s.w > 0 && s.h > 0, `bad canvas for ${k}`);
    assert.equal(s.gen, k, `${k}: the background is generated at the exact channel ratio`);
    assert.equal(s.size, seedreamSize(s.gen), `${k}: size comes from seedreamSize`);
    const [gw, gh] = s.size.split('x').map(Number);
    assert.ok(gw * gh >= 921_600, `${k}: ${s.size} is under Seedream's pixel floor`);
    // object-fit:cover must only SCALE (never crop) so the vision-chosen text zone stays put
    assert.ok(Math.abs(gw / gh - s.w / s.h) / (s.w / s.h) < 0.01, `${k}: background ${s.size} vs canvas ${s.w}×${s.h} aspect drift`);
  }
});

test('hook variants (the Higgsfield Hermes borrow): schema + pipeline + steering all wired', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  // tool exposes headline_variants and teaches the hook archetypes
  const toolSrc = fs.readFileSync(path.join(__dirname, '../src/agent/tools/creative.ts'), 'utf8');
  assert.match(toolSrc, /headline_variants/);
  assert.match(toolSrc, /headlineVariants:/);
  assert.match(toolSrc, /HOOK VARIANTS/);
  // pipeline composites variants on the SAME settled background, capped at 3
  const coreSrc = fs.readFileSync(path.join(__dirname, '../src/agent/creative.ts'), 'utf8');
  assert.match(coreSrc, /headlineVariants\?\:/);
  assert.match(coreSrc, /slice\(0, 3\)/);
  assert.match(coreSrc, /headline: variants\[i\]/);
});

// ---------------------------------------------------------------------------
// composeCreative pipeline on ModelArk (hermetic: stubbed fetch, never reaches Chromium).
// Seedream makes the TEXT-FREE background; Seed vision plans the zone + flags baked text.
// ---------------------------------------------------------------------------

const BG_PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(700, 7)]);
const COPY = { accent: '#c0502f', headline: 'UK Tourist Visa', sub: 'Fast & accurate processing', cta: 'Apply now' };
type Call = { url: string; body: any };

async function withArk<T>(handler: (url: string, body: any, n: number) => Response, fn: (calls: Call[]) => Promise<T>): Promise<T> {
  const realFetch = globalThis.fetch;
  const calls: Call[] = [];
  globalThis.fetch = (async (url: any, init: any) => {
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ url: String(url), body });
    return handler(String(url), body, calls.length);
  }) as any;
  __setByteplusKeyForTest('ark-test');
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = realFetch;
    __setByteplusKeyForTest('');
  }
}
const jsonRes = (obj: unknown, status = 200) => new Response(JSON.stringify(obj), { status });
const visionRes = (plan: object, usage = { prompt_tokens: 1200, completion_tokens: 40 }) =>
  jsonRes({ choices: [{ message: { content: JSON.stringify(plan) }, finish_reason: 'stop' }], usage });
const compose = (dir: string, over: Partial<Parameters<typeof composeCreative>[0]> = {}) =>
  composeCreative(
    { prompt: 'London street scene with the text "UK Tourist Visa", Big Ben, a red bus', aspect: '9:16', copy: COPY, format: 'png', textColor: 'auto', zone: 'auto', ...over },
    dir,
    new AbortController().signal,
  );
const withTmp = async (fn: (dir: string) => Promise<void>) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arks-creative-test-'));
  try {
    await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

test('composeCreative: no ModelArk key → honest failure, zero spend, workspace untouched', async () => {
  await withTmp(async (dir) => {
    const realFetch = globalThis.fetch;
    let called = 0;
    globalThis.fetch = (async () => {
      called++;
      return jsonRes({});
    }) as any;
    __setByteplusKeyForTest('');
    try {
      const r = await compose(dir);
      assert.equal(r.ok, false);
      assert.match(r.error ?? '', /background image generation failed/);
      assert.ok((r.error ?? '').includes(MODELARK_MISSING));
      assert.equal(r.costUsd, 0);
      assert.equal(called, 0);
      assert.equal(fs.existsSync(path.join(dir, 'images')), false, 'nothing lands in the workspace on failure');
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

test('composeCreative: the background is a scrubbed, text-free Seedream request at the channel size', async () => {
  await withTmp(async (dir) => {
    const r = await withArk(
      () => jsonRes({ error: { code: 'InputTextSensitiveContentDetected', message: 'InputTextSensitiveContentDetected: sensitive content' } }, 400),
      async (calls) => {
        const res = await compose(dir);
        assert.equal(calls.length, 1, 'a refused background stops the pipeline (no vision / render spend)');
        const c = calls[0];
        assert.equal(c.url, `${config.byteplusVideoBaseUrl.replace(/\/$/, '')}/images/generations`);
        assert.equal(c.body.model, config.arkImageModel);
        assert.equal(c.body.size, CREATIVE_SIZES['9:16'].size);
        assert.equal(c.body.response_format, 'b64_json');
        assert.equal(c.body.watermark, false);
        assert.ok(!('image' in c.body), 'a creative background takes no reference image');
        assert.doesNotMatch(c.body.prompt, /UK Tourist Visa/, 'copy never reaches the image model');
        assert.match(c.body.prompt, /Big Ben/);
        assert.match(c.body.prompt, /negative space for a text overlay/);
        assert.doesNotMatch(c.body.prompt, /^CRITICAL/, 'first attempt uses the normal (soft) lead');
        return res;
      },
    );
    assert.equal(r.ok, false);
    assert.ok((r.error ?? '').includes(imageErrorMessage('policy')), 'the provider refusal reads as plain-language guidance');
    assert.match(r.notes, /scrubbed copy out of the imagery prompt/);
    assert.equal(r.costUsd, 0);
    assert.equal(fs.existsSync(path.join(dir, 'images')), false);
  });
});

test('composeCreative: vision flags baked-in text → ONE regeneration with the hard no-text lead', async () => {
  await withTmp(async (dir) => {
    const usage = { prompt_tokens: 1200, completion_tokens: 40 };
    const r = await withArk(
      (url, _body, n) => {
        if (url.endsWith('/chat/completions')) return visionRes({ zone: 'left', textColor: 'dark', hasText: true, clutter: 2 }, usage);
        return n === 1 ? jsonRes({ data: [{ b64_json: BG_PNG.toString('base64') }] }) : jsonRes({ error: { message: 'upstream busy' } }, 503);
      },
      async (calls) => {
        const res = await compose(dir);
        assert.deepEqual(calls.map((c) => c.url.split('/').pop()), ['generations', 'completions', 'generations']);
        // the vision call: Seed vision model, thinking off, the background as a data-URL image part
        const v = calls[1];
        const visionBase = endpointFor(config.arkVisionModel) === 'general' ? config.byteplusVideoBaseUrl : config.byteplusBaseUrl;
        assert.equal(v.url, `${visionBase.replace(/\/$/, '')}/chat/completions`);
        assert.equal(v.body.model, config.arkVisionModel);
        assert.deepEqual(v.body.thinking, { type: 'disabled' });
        const parts = v.body.messages.at(-1).content;
        assert.equal(parts[0].type, 'image_url');
        assert.equal(parts[0].image_url.url, `data:image/png;base64,${BG_PNG.toString('base64')}`);
        assert.match(parts.at(-1).text, /"zone":"top\|bottom\|left\|right"/);
        // the regeneration leads with the emphatic no-text directive
        assert.doesNotMatch(calls[0].body.prompt, /^CRITICAL/);
        assert.match(calls[2].body.prompt, /^CRITICAL: a purely VISUAL image with ABSOLUTELY ZERO text/);
        return res;
      },
    );
    assert.equal(r.ok, false, 'the failed regeneration is surfaced, not shipped');
    assert.match(r.error ?? '', /background image generation failed: HTTP 503/);
    assert.match(r.notes, /regenerated background \(text in image\)/);
    const expected = config.arkImageCost + costFromUsage(config.arkVisionModel, usage, config.arkVisionCost);
    assert.ok(Math.abs(r.costUsd - expected) < 1e-9, `spend so far is reported (${r.costUsd} vs ${expected})`);
  });
});

test('composeCreative: a cluttered zone (≥7/10) regenerates with the SOFT lead (no text leak)', async () => {
  await withTmp(async (dir) => {
    const r = await withArk(
      (url, _body, n) => {
        if (url.endsWith('/chat/completions')) return visionRes({ zone: 'bottom', textColor: 'light', hasText: false, clutter: 8 });
        return n === 1 ? jsonRes({ data: [{ b64_json: BG_PNG.toString('base64') }] }) : jsonRes({ error: { message: 'stop here' } }, 500);
      },
      async (calls) => {
        const res = await compose(dir, { aspect: '1:1' });
        assert.equal(calls.length, 3);
        assert.equal(calls[2].body.size, CREATIVE_SIZES['1:1'].size);
        assert.doesNotMatch(calls[2].body.prompt, /^CRITICAL/, 'clutter alone does not trigger the hard no-text lead');
        return res;
      },
    );
    assert.equal(r.ok, false);
    assert.match(r.notes, /regenerated background \(cluttered 8\/10\)/);
  });
});
