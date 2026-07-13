import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pagesRequest, normalizePages, pageInsightsRequest, normalizePageInsights, PAGE_METRICS,
} from '../src/connectors/metaPages';

/** Facebook Pages foundation — enumeration + organic Page insights (pure layer). */

test('pagesRequest asks for the per-page token + linked Instagram', () => {
  const { url } = pagesRequest('USER_TOKEN');
  assert.match(url, /\/me\/accounts\?/);
  assert.match(url, /access_token/);
  assert.match(url, /fields=id%2Cname%2Ccategory%2Caccess_token%2Cinstagram_business_account/);
});

test('normalizePages maps id/name/category/token + IG, drops rows without an id', () => {
  const pages = normalizePages({
    data: [
      { id: '111', name: 'Acme UAE', category: 'Retail', access_token: 'PT1', instagram_business_account: { id: '999', username: 'acme' } },
      { id: '222', name: 'Acme KSA', access_token: 'PT2' }, // no category / IG
      { name: 'broken (no id)' },
    ],
  });
  assert.equal(pages.length, 2);
  assert.deepEqual(pages[0], { id: '111', name: 'Acme UAE', category: 'Retail', accessToken: 'PT1', igUserId: '999', igUsername: 'acme' });
  assert.equal(pages[1].category, null);
  assert.equal(pages[1].igUserId, null);
  assert.deepEqual(normalizePages(null), []); // fail-soft
});

test('pageInsightsRequest builds a day-period window over the default metric set', () => {
  const { url } = pageInsightsRequest('111', 'PT1', '2026-06-01', '2026-06-30');
  assert.match(url, /\/111\/insights\?/);
  assert.match(url, /period=day/);
  assert.match(url, /since=2026-06-01&until=2026-06-30/);
  for (const m of PAGE_METRICS) assert.ok(url.includes(m), `metric ${m} requested`);
});

test('normalizePageInsights sums daily values per metric; follows falls back to fan_adds', () => {
  const withFollows = normalizePageInsights({
    data: [
      { name: 'page_impressions', period: 'day', values: [{ value: 100 }, { value: 150 }] },
      { name: 'page_impressions_unique', period: 'day', values: [{ value: 40 }, { value: 55 }] },
      { name: 'page_post_engagements', period: 'day', values: [{ value: 12 }, { value: 8 }] },
      { name: 'page_follows', period: 'day', values: [{ value: 3 }, { value: 2 }] },
      { name: 'page_fan_adds', period: 'day', values: [{ value: 99 }] }, // ignored when follows present
    ],
  });
  assert.deepEqual(withFollows, { impressions: 250, reach: 95, engagements: 20, followerChange: 5 });
  // No follows metric → use fan_adds.
  const fanOnly = normalizePageInsights({ data: [{ name: 'page_fan_adds', values: [{ value: 7 }, { value: 4 }] }] });
  assert.equal(fanOnly.followerChange, 11);
  // Non-numeric / broken-down values are skipped, never NaN.
  const messy = normalizePageInsights({ data: [{ name: 'page_impressions', values: [{ value: '20' }, { value: { '25-34': 5 } }, {}] }] });
  assert.equal(messy.impressions, 20);
  assert.deepEqual(normalizePageInsights(null), { impressions: 0, reach: 0, engagements: 0, followerChange: 0 });
});
