import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-social-'));
delete process.env.DATABASE_URL;

import {
  fbPostRequest, igContainerRequest, igPublishRequest, igPublishAllowed, IG_DAILY_PUBLISH_LIMIT,
} from '../src/connectors/metaPublish';
import {
  createCampaignRequest, buildTargeting, createAdSetRequest, createCreativeRequest,
  createAdRequest, boostCreativeRequest, updateStatusRequest, updateBudgetRequest, usdToMinor,
} from '../src/connectors/metaCampaigns';
import { guardCampaignAction, capsFromConfig } from '../src/robots/campaigns';

// ---- Track A: organic publish builders ----
test('fb post request: text/link vs photo vs scheduled', () => {
  assert.deepEqual(fbPostRequest('PG', { message: 'hello' }), { url: 'PG/feed', body: { message: 'hello' } });
  const link = fbPostRequest('PG', { message: 'see', link: 'https://x.com' });
  assert.equal(link.url, 'PG/feed');
  assert.equal(link.body.link, 'https://x.com');
  const photo = fbPostRequest('PG', { message: 'cap', imageUrl: 'https://img/x.jpg' });
  assert.equal(photo.url, 'PG/photos');
  assert.equal(photo.body.url, 'https://img/x.jpg');
  const sched = fbPostRequest('PG', { message: 'later', scheduledAtSec: 1_800_000_000 });
  assert.equal(sched.body.published, false);
  assert.equal(sched.body.scheduled_publish_time, 1_800_000_000);
});

test('ig container: image vs reels vs stories + publish', () => {
  const img = igContainerRequest('IG', { mediaUrl: 'https://img/x.jpg', caption: 'hi', kind: 'image' });
  assert.equal(img.url, 'IG/media');
  assert.equal(img.body.image_url, 'https://img/x.jpg');
  assert.equal(img.body.caption, 'hi');
  const reel = igContainerRequest('IG', { mediaUrl: 'https://v/x.mp4', kind: 'reels' });
  assert.equal(reel.body.video_url, 'https://v/x.mp4');
  assert.equal(reel.body.media_type, 'REELS');
  const story = igContainerRequest('IG', { mediaUrl: 'https://img/x.jpg', caption: 'ignored', kind: 'stories' });
  assert.equal(story.body.media_type, 'STORIES');
  assert.equal(story.body.caption, undefined); // stories carry no caption
  assert.deepEqual(igPublishRequest('IG', 'CREATION1'), { url: 'IG/media_publish', body: { creation_id: 'CREATION1' } });
});

test('ig 25/day rolling cap', () => {
  const now = Date.now();
  assert.equal(igPublishAllowed([], now), true);
  const under = Array.from({ length: IG_DAILY_PUBLISH_LIMIT - 1 }, () => now - 1000);
  assert.equal(igPublishAllowed(under, now), true);
  const at = Array.from({ length: IG_DAILY_PUBLISH_LIMIT }, () => now - 1000);
  assert.equal(igPublishAllowed(at, now), false);
  // Old publishes (> 24 h) don't count.
  const old = Array.from({ length: IG_DAILY_PUBLISH_LIMIT }, () => now - 25 * 60 * 60 * 1000);
  assert.equal(igPublishAllowed(old, now), true);
});

// ---- Track C: paid campaign builders ----
test('campaign request: PAUSED + objective mapping', () => {
  const r = createCampaignRequest('123', { name: 'Launch', objective: 'sales' });
  assert.equal(r.url, 'act_123/campaigns');
  assert.equal(r.body.status, 'PAUSED');
  assert.equal(r.body.objective, 'OUTCOME_SALES');
  assert.equal(createCampaignRequest('act_9', { name: 'x', objective: 'traffic' }).url, 'act_9/campaigns'); // no double act_
});

test('targeting spec: IG placements, genders, interests', () => {
  const t = buildTargeting({ countries: ['AE'], ageMin: 25, ageMax: 40, genders: ['female'], interests: ['6003', '6004'], instagram: true });
  assert.deepEqual(t.geo_locations, { countries: ['AE'] });
  assert.equal(t.age_min, 25);
  assert.deepEqual(t.genders, [2]); // female → 2
  assert.deepEqual(t.flexible_spec, [{ interests: [{ id: '6003' }, { id: '6004' }] }]);
  assert.deepEqual(t.publisher_platforms, ['facebook', 'instagram']);
  assert.ok(t.instagram_positions.includes('reels'));
  const fbOnly = buildTargeting({ countries: ['AE'] });
  assert.deepEqual(fbOnly.publisher_platforms, ['facebook']);
  assert.equal(fbOnly.instagram_positions, undefined);
});

test('ad set / creative / ad / status / budget builders', () => {
  const s = createAdSetRequest('1', { campaignId: 'C', name: 'set', dailyBudgetUsd: 12.5, targeting: { countries: ['AE'] } });
  assert.equal(s.body.daily_budget, 1250); // minor units
  assert.equal(s.body.status, 'PAUSED');
  assert.equal(s.body.campaign_id, 'C');
  const cr = createCreativeRequest('1', { name: 'cre', pageId: 'PG', instagramActorId: 'IG', message: 'buy', link: 'https://x', cta: 'SHOP_NOW' });
  assert.equal(cr.body.object_story_spec.page_id, 'PG');
  assert.equal(cr.body.object_story_spec.instagram_actor_id, 'IG');
  assert.deepEqual(cr.body.object_story_spec.link_data.call_to_action, { type: 'SHOP_NOW' });
  const ad = createAdRequest('1', { name: 'ad', adSetId: 'AS', creativeId: 'CRE' });
  assert.equal(ad.body.status, 'PAUSED');
  assert.match(String(ad.body.creative), /CRE/);
  assert.deepEqual(updateStatusRequest('OBJ', 'ACTIVE'), { url: 'OBJ', body: { status: 'ACTIVE' } });
  assert.equal(updateBudgetRequest('AS', 30).body.daily_budget, 3000);
  assert.equal(usdToMinor(9.99), 999);
});

test('boost creative promotes an existing post via object_story_id', () => {
  const b = boostCreativeRequest('1', { name: 'boost', objectStoryId: 'PG_123', instagramActorId: 'IG' });
  assert.equal(b.url, 'act_1/adcreatives');
  assert.equal(b.body.object_story_id, 'PG_123');
  assert.equal(b.body.instagram_actor_id, 'IG');
  assert.equal(b.body.link_data, undefined); // a boost references the post, not new link_data
});

// ---- Track C: money guardrails ----
test('guard: launch needs approval + cap; pause always ok; IG needs page', () => {
  const caps = { dailyCapUsd: 50, requireApproval: true };
  assert.equal(guardCampaignAction({ action: 'launch', approved: false, requestedDailyUsd: 20 }, caps).ok, false); // unapproved
  assert.equal(guardCampaignAction({ action: 'launch', approved: true, requestedDailyUsd: 80 }, caps).ok, false); // over cap
  assert.equal(guardCampaignAction({ action: 'launch', approved: true, requestedDailyUsd: 20 }, caps).ok, true);
  assert.equal(guardCampaignAction({ action: 'pause', approved: false }, caps).ok, true); // pausing is always safe
  assert.equal(guardCampaignAction({ action: 'create_campaign', approved: true, wantsInstagram: true, hasPageAndIg: false }, caps).ok, false);
  assert.equal(guardCampaignAction({ action: 'create_campaign', approved: true, wantsInstagram: true, hasPageAndIg: true }, caps).ok, true);
});

test('caps: only Autopilot (>=80) skips approval', () => {
  assert.equal(capsFromConfig({ autonomyLevel: 30 }).requireApproval, true);
  assert.equal(capsFromConfig({ autonomyLevel: 60 }).requireApproval, true);
  assert.equal(capsFromConfig({ autonomyLevel: 80 }).requireApproval, false);
  assert.equal(capsFromConfig({ adDailyCapUsd: 250 }).dailyCapUsd, 250);
  assert.equal(capsFromConfig({}).dailyCapUsd, 20); // safe default
});

// ---- DB-backed: stores round-trip ----
let social: typeof import('../src/robots/social');
let campaigns: typeof import('../src/robots/campaigns');

before(async () => {
  const db = await import('../src/db');
  await db.initDb();
  social = await import('../src/robots/social');
  campaigns = await import('../src/robots/campaigns');
});

test('social_posts store: create, list, IG publish times', async () => {
  const { randomUUID } = await import('node:crypto');
  const org = `org-${randomUUID()}`; // unique org → isolation-proof in the shared in-process DB
  const p1 = await social.createSocialPost({ orgId: org, platform: 'instagram', kind: 'image', caption: 'a', mediaPath: '/data/x.jpg', status: 'scheduled', scheduledAt: Date.now() + 3600_000 });
  assert.equal(p1.status, 'scheduled');
  const list = await social.listSocialPosts(org);
  assert.equal(list.length, 1);
  // No published_at yet → cap sees zero recent.
  assert.equal((await social.recentIgPublishTimes(org)).length, 0);
});

test('campaign_actions audit round-trips', async () => {
  const { randomUUID } = await import('node:crypto');
  const org = `org-${randomUUID()}`;
  const a = await campaigns.recordCampaignAction({ orgId: org, action: 'create_campaign', status: 'executed', requestedBudgetUsd: 25, detail: 'Launch' });
  assert.equal(a.action, 'create_campaign');
  await campaigns.setCampaignActionStatus(a.id, 'approved', 'owner@x.com');
  const log = await campaigns.listCampaignActions(org);
  assert.equal(log.length, 1);
  assert.equal(log[0].status, 'approved');
  assert.equal(log[0].approvedBy, 'owner@x.com');
});
