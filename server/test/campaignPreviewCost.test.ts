import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * The campaign brief's creative-generation estimate is SERVER-sourced: classify-preview returns
 * the $/background derived from the configured ModelArk prices (EST_COST_PER_BACKGROUND_USD), so
 * the client never drifts from the real per-call costs. Hermetic: temp SQLite, no network.
 */
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-campcost-'));
process.env.APP_PASSWORD = 'test-operator';
process.env.ENCRYPTION_KEY = 'test-key-campcost';
delete process.env.DATABASE_URL;
delete process.env.ARK_IMAGE_COST;
delete process.env.ARK_VISION_COST;

let app: any;
let opCookie = '';

before(async () => {
  const db = await import('../src/db');
  const orgs = await import('../src/orgs/store');
  await db.initDb();
  await orgs.bootstrapOrgs();
  app = await (await import('../src/app')).buildApp();
  await app.ready();
  const op = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'test-operator' } });
  const raw = op.headers['set-cookie'];
  const arr: string[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
  opCookie = (arr.find((c) => c.startsWith('arksai_auth=')) || '').split(';')[0];
  assert.ok(opCookie, 'operator login set a cookie');
});

test('EST_COST_PER_BACKGROUND_USD = 2 Seedream gens + 4 vision checks at the configured prices', async () => {
  const { EST_COST_PER_BACKGROUND_USD } = await import('../src/agent/social/creativeBatch');
  const { config } = await import('../src/config');
  assert.equal(EST_COST_PER_BACKGROUND_USD, Math.round((2 * config.arkImageCost + 4 * config.arkVisionCost) * 1000) / 1000);
  assert.equal(EST_COST_PER_BACKGROUND_USD, 0.102, 'default ModelArk prices: 2×0.045 + 4×0.003');
});

test('classify-preview returns costPerBackgroundUsd (the server estimate the brief displays)', async () => {
  const { EST_COST_PER_BACKGROUND_USD } = await import('../src/agent/social/creativeBatch');
  const r = await app.inject({
    method: 'POST',
    url: '/api/orgs/default/robots/any/campaigns/classify-preview',
    payload: { product: 'Family dental clinic teeth whitening', topics: [], countries: ['AE'] },
    headers: { cookie: opCookie },
  });
  assert.equal(r.statusCode, 200, r.body);
  const body = r.json();
  assert.equal(body.costPerBackgroundUsd, EST_COST_PER_BACKGROUND_USD);
  assert.equal(typeof body.verticalId, 'string');
});

test('the brief uses the server estimate — no hard-coded $/background left in the client', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../client/src/components/CampaignBrief.tsx'), 'utf8');
  assert.match(src, /costPerBackgroundUsd/);
  assert.doesNotMatch(src, /\* 0\.09 \*/);
});
