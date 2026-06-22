import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMetaInto, normalizePath, isMarketingRoute, MARKETING_ROUTES, RESEARCH_SLUGS } from '../src/seo/marketingMeta';

const BASE_HTML = `<!doctype html><html><head>
<title>OLD TITLE</title>
<meta name="description" content="old desc" />
<link rel="canonical" href="https://arksai.studio/" />
<meta property="og:title" content="old og" />
<meta property="og:description" content="old ogd" />
<meta property="og:url" content="https://arksai.studio/" />
<meta property="og:image" content="https://arksai.studio/og-cover.png" />
<meta name="twitter:title" content="old tw" />
<meta name="twitter:description" content="old twd" />
</head><body></body></html>`;

test('normalizePath strips query/hash and trailing slash (keeps root)', () => {
  assert.equal(normalizePath('/for/finance?x=1'), '/for/finance');
  assert.equal(normalizePath('/for/finance/'), '/for/finance');
  assert.equal(normalizePath('/'), '/');
  assert.equal(normalizePath('/#a'), '/');
});

test('isMarketingRoute matches the known marketing routes only', () => {
  assert.equal(isMarketingRoute('/'), true);
  assert.equal(isMarketingRoute('/for/finance'), true);
  assert.equal(isMarketingRoute('/for/tax/'), true);
  assert.equal(isMarketingRoute('/features'), true);
  assert.equal(isMarketingRoute('/research'), true);
  assert.equal(isMarketingRoute('/research/energy-the-next-currency'), true);
  assert.equal(isMarketingRoute('/research/energy-the-next-currency/'), true);
  assert.equal(isMarketingRoute('/s/abc'), false);
  assert.equal(isMarketingRoute('/operator'), false);
  assert.equal(isMarketingRoute('/for/unknown'), false);
  assert.equal(isMarketingRoute('/research/not-a-real-article'), false);
});

test('Features and Research hub are first-class marketing routes', () => {
  for (const p of ['/features', '/research']) {
    assert.ok(MARKETING_ROUTES[p], `${p} missing from MARKETING_ROUTES`);
    const out = renderMetaInto(BASE_HTML, p, MARKETING_ROUTES[p]);
    assert.match(out, new RegExp(`rel="canonical" href="https://arksai\\.studio${p}"`));
    assert.doesNotMatch(out, /OLD TITLE/);
  }
});

test('research article meta injects JSON-LD Article structured data', () => {
  // renderMetaInto with a jsonLd payload inserts it before </head>.
  const ld = '<script type="application/ld+json">{"@type":"Article"}</script>';
  const out = renderMetaInto(BASE_HTML, '/research/x', { title: 'T', description: 'D' }, ld);
  assert.match(out, /<script type="application\/ld\+json">\{"@type":"Article"\}<\/script><\/head>/);
});

test('RESEARCH_SLUGS is non-empty and lowercase-hyphenated', () => {
  assert.ok(RESEARCH_SLUGS.length >= 1);
  for (const s of RESEARCH_SLUGS) assert.match(s, /^[a-z0-9-]+$/);
});

test('renderMetaInto swaps title/description/canonical/OG per route', () => {
  const out = renderMetaInto(BASE_HTML, '/for/finance', MARKETING_ROUTES['/for/finance']);
  assert.match(out, /<title>AI for Finance &amp; Strategy[^<]*<\/title>/);
  assert.match(out, /name="description" content="ArksAI gives UAE finance teams/);
  assert.match(out, /rel="canonical" href="https:\/\/arksai\.studio\/for\/finance"/);
  assert.match(out, /property="og:url" content="https:\/\/arksai\.studio\/for\/finance"/);
  assert.match(out, /property="og:title" content="AI for UAE finance teams/);
  assert.match(out, /name="twitter:title" content="AI for UAE finance teams/);
  // image is left untouched (one shared cover)
  assert.match(out, /property="og:image" content="https:\/\/arksai\.studio\/og-cover\.png"/);
  // old values gone
  assert.doesNotMatch(out, /OLD TITLE/);
  assert.doesNotMatch(out, /old desc/);
});

test('root route canonical stays the bare domain with a trailing slash', () => {
  const out = renderMetaInto(BASE_HTML, '/', MARKETING_ROUTES['/']);
  assert.match(out, /rel="canonical" href="https:\/\/arksai\.studio\/"/);
  assert.match(out, /property="og:url" content="https:\/\/arksai\.studio\/"/);
});

test('every marketing route has a non-empty title + description', () => {
  for (const [pathName, m] of Object.entries(MARKETING_ROUTES)) {
    assert.ok(m.title.length > 10, `${pathName} title too short`);
    assert.ok(m.description.length > 40, `${pathName} description too short`);
  }
});
