import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMetaAuthUrl, normalizeMeta } from '../src/connectors/meta';
import { buildGoogleAuthUrl, buildGaql, normalizeGoogle } from '../src/connectors/google';
import { buildTiktokAuthUrl, normalizeTiktok } from '../src/connectors/tiktok';

test('meta: auth URL carries client_id, redirect, state, ads_read scope', () => {
  const u = buildMetaAuthUrl('APPID', 'STATE123', 'https://arksai.studio/api/connectors/meta/callback');
  assert.match(u, /facebook\.com/);
  assert.match(u, /client_id=APPID/);
  assert.match(u, /state=STATE123/);
  assert.match(u, /ads_read/);
  assert.match(u, /redirect_uri=https%3A%2F%2Farksai\.studio/);
});

test('meta: normalize flattens insights + expands actions', () => {
  const rows = normalizeMeta([
    { campaign_name: 'Summer', impressions: '1000', clicks: '50', spend: '12.50', actions: [{ action_type: 'purchase', value: '4' }] },
  ]);
  assert.equal(rows[0].campaign_name, 'Summer');
  assert.equal(rows[0].impressions, 1000); // coerced to number
  assert.equal(rows[0].spend, 12.5);
  assert.equal(rows[0].action_purchase, 4);
});

test('google: auth URL requests offline access + adwords scope', () => {
  const u = buildGoogleAuthUrl('CID', 'ST', 'https://arksai.studio/api/connectors/google/callback');
  assert.match(u, /accounts\.google\.com/);
  assert.match(u, /access_type=offline/);
  assert.match(u, /scope=https%3A%2F%2Fwww\.googleapis\.com%2Fauth%2Fadwords/);
  assert.match(u, /state=ST/);
});

test('google: GAQL has the date range and the right level', () => {
  const q = buildGaql({ since: '2026-06-01', until: '2026-06-18', level: 'campaign' });
  assert.match(q, /FROM campaign/);
  assert.match(q, /segments\.date BETWEEN '2026-06-01' AND '2026-06-18'/);
  assert.match(q, /metrics\.cost_micros/);
  const qDay = buildGaql({ since: '2026-06-01', until: '2026-06-18', level: 'day' });
  assert.match(qDay, /segments\.date/);
});

test('google: normalize converts cost_micros → cost and flattens nesting', () => {
  const rows = normalizeGoogle([
    { results: [{ campaign: { name: 'Brand' }, metrics: { impressions: '900', clicks: '30', costMicros: '5000000', ctr: '0.033' } }] },
  ]);
  assert.equal(rows[0].campaign, 'Brand');
  assert.equal(rows[0].impressions, 900);
  assert.equal(rows[0].cost, 5); // 5,000,000 micros = 5.0
});

test('tiktok: auth URL is the business-api portal with app_id + redirect', () => {
  const u = buildTiktokAuthUrl('APPKEY', 'ST', 'https://arksai.studio/api/connectors/tiktok/callback');
  assert.match(u, /business-api\.tiktok\.com\/portal\/auth/);
  assert.match(u, /app_id=APPKEY/);
  assert.match(u, /state=ST/);
});

test('tiktok: normalize merges dimensions + metrics into flat rows', () => {
  const rows = normalizeTiktok([
    { dimensions: { campaign_id: '123' }, metrics: { spend: '20.5', impressions: '2000', clicks: '80' } },
  ]);
  assert.equal(rows[0].campaign_id, 123);
  assert.equal(rows[0].spend, 20.5);
  assert.equal(rows[0].impressions, 2000);
});
