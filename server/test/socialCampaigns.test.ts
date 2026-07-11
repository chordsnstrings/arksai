import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'arksai-soc-camp-'));
delete process.env.DATABASE_URL;

import {
  uploadImageRequest, uploadVideoRequest, createLeadFormRequest, dynamicCreativeRequest,
  videoCreativeRequest, leadCreativeRequest, adStatusUrl, createAdSetRequest,
} from '../src/connectors/metaCampaigns';

// ---- pure builders ----
test('upload builders: image bytes + video by public url', () => {
  const img = uploadImageRequest('123', 'QkFTRTY0');
  assert.equal(img.url, 'act_123/adimages');
  assert.equal(img.body.bytes, 'QkFTRTY0');
  const vid = uploadVideoRequest('act_9', 'https://x/y.mp4', 'promo');
  assert.equal(vid.url, 'act_9/advideos');
  assert.equal(vid.body.file_url, 'https://x/y.mp4');
  assert.equal(vid.body.name, 'promo');
});

test('lead form builder: questions + privacy policy on the PAGE', () => {
  const r = createLeadFormRequest('PG1', { name: 'Quote form', fields: ['FULL_NAME', 'PHONE', 'EMAIL'], privacyPolicyUrl: 'https://acme.ae/privacy', thankYouMessage: 'We will call you.' });
  assert.equal(r.url, 'PG1/leadgen_forms');
  assert.deepEqual(JSON.parse(r.body.questions), [{ type: 'FULL_NAME' }, { type: 'PHONE' }, { type: 'EMAIL' }]);
  assert.equal(JSON.parse(r.body.privacy_policy).url, 'https://acme.ae/privacy');
  assert.match(r.body.thank_you_page, /We will call you/);
});

test('dynamic creative: asset_feed_spec caps + formats + IG actor', () => {
  const r = dynamicCreativeRequest('1', {
    name: 'DCO', pageId: 'PG', instagramActorId: 'IG',
    feed: {
      imageHashes: Array.from({ length: 12 }, (_, i) => `h${i}`),
      bodies: ['a', 'b', 'c', 'd', 'e', 'f'],
      titles: ['t1', 't2'],
      linkUrl: 'https://acme.ae',
      cta: 'SIGN_UP',
    },
  });
  const spec = JSON.parse(r.body.asset_feed_spec);
  assert.equal(spec.images.length, 10); // Meta cap
  assert.equal(spec.bodies.length, 5); // Meta cap
  assert.deepEqual(spec.ad_formats, ['SINGLE_IMAGE']);
  assert.deepEqual(spec.call_to_action_types, ['SIGN_UP']);
  assert.deepEqual(spec.link_urls, [{ website_url: 'https://acme.ae' }]);
  assert.equal(JSON.parse(r.body.object_story_spec).instagram_actor_id, 'IG');
  // Video pool flips the format.
  const v = dynamicCreativeRequest('1', { name: 'DCOv', pageId: 'PG', feed: { videoIds: ['v1'], bodies: ['a'], titles: ['t'] } });
  assert.deepEqual(JSON.parse(v.body.asset_feed_spec).ad_formats, ['SINGLE_VIDEO']);
});

test('video + lead creatives carry the right story specs', () => {
  const v = videoCreativeRequest('1', { name: 'vid', pageId: 'PG', videoId: 'V1', thumbnailUrl: 'https://t/x.jpg', message: 'watch', title: 'Promo', link: 'https://acme.ae', cta: 'LEARN_MORE' });
  const vd = v.body.object_story_spec.video_data;
  assert.equal(vd.video_id, 'V1');
  assert.equal(vd.image_url, 'https://t/x.jpg');
  assert.deepEqual(vd.call_to_action, { type: 'LEARN_MORE', value: { link: 'https://acme.ae' } });
  // Lead-form CTA variant on video.
  const vf = videoCreativeRequest('1', { name: 'vidf', pageId: 'PG', videoId: 'V1', thumbnailUrl: 'https://t/x.jpg', message: 'm', cta: 'SIGN_UP', leadFormId: 'F9' });
  assert.deepEqual(vf.body.object_story_spec.video_data.call_to_action.value, { lead_gen_form_id: 'F9' });
  // Lead-ads image creative.
  const l = leadCreativeRequest('1', { name: 'lead', pageId: 'PG', message: 'get a quote', imageHash: 'H1', leadFormId: 'F9', link: 'https://acme.ae' });
  const ld = l.body.object_story_spec.link_data;
  assert.equal(ld.image_hash, 'H1');
  assert.deepEqual(ld.call_to_action, { type: 'SIGN_UP', value: { lead_gen_form_id: 'F9' } });
});

test('ad set builder: dynamic creative + promoted_object + lifetime budget + destination', () => {
  const s = createAdSetRequest('1', {
    campaignId: 'C', name: 'leads set', lifetimeBudgetUsd: 210, targeting: { countries: ['AE'] },
    dynamicCreative: true, promotedPageId: 'PG', optimizationGoal: 'LEAD_GENERATION', endAtSec: 1_800_000_000,
  });
  assert.equal(s.body.lifetime_budget, 21000);
  assert.equal(s.body.daily_budget, undefined);
  assert.equal(s.body.is_dynamic_creative, true);
  assert.equal(JSON.parse(s.body.promoted_object).page_id, 'PG');
  assert.equal(s.body.optimization_goal, 'LEAD_GENERATION');
  const m = createAdSetRequest('1', { campaignId: 'C', name: 'msgs', dailyBudgetUsd: 10, targeting: { countries: ['AE'] }, destinationType: 'MESSENGER', promotedPageId: 'PG', optimizationGoal: 'CONVERSATIONS' });
  assert.equal(m.body.destination_type, 'MESSENGER');
});

test('ad status url batches ids + asks for review feedback', () => {
  const u = adStatusUrl(['1', '2']);
  assert.match(u, /^\?ids=1,2&fields=effective_status/);
  assert.match(u, /ad_review_feedback/);
  assert.match(u, /effective_object_story_id/);
});

// ---- DB round-trips ----
let store: typeof import('../src/robots/socialCampaigns');

before(async () => {
  const db = await import('../src/db');
  await db.initDb();
  store = await import('../src/robots/socialCampaigns');
});

test('social_campaigns: create → patch → lease → due-for-optimize', async () => {
  const org = `org-${randomUUID()}`;
  const c = await store.createCampaignRecord({
    orgId: org, name: 'FreshCrate leads', objective: 'leads',
    brief: { product: 'FreshCrate', topics: ['weekly veg boxes'], imageCount: 30 },
    budgetModel: 'daily', dailyCapUsd: 25, totalCapUsd: 500,
    engageSpecifics: { say: 'Mention the 20% intro offer', escalateIf: 'refunds' },
  });
  assert.equal(c.status, 'draft');
  assert.equal(c.brief!.product, 'FreshCrate');
  assert.equal(c.engageSpecifics!.say, 'Mention the 20% intro offer');

  await store.updateCampaignRecord(c.id, {
    status: 'active', metaCampaignId: 'MC1', adsetIds: ['AS1', 'AS2'],
    creativePool: [{ ref: 'images/a.png', type: 'image', format: '1:1', headline: 'H', used: true, live: true, adId: 'AD1' }],
    spentUsd: 12.5,
  });
  const after = (await store.getCampaignRecord(c.id))!;
  assert.equal(after.status, 'active');
  assert.deepEqual(after.adsetIds, ['AS1', 'AS2']);
  assert.equal(after.creativePool[0].adId, 'AD1');
  assert.equal(after.spentUsd, 12.5);

  // Never optimized → due; lease is exclusive; a fresh lastOptimizedAt takes it out of the due set.
  const now = Date.now();
  // High limit: the test DB is shared across suite files, so other actives may exist.
  const due = await store.dueForOptimize(now, undefined, 10_000);
  assert.ok(due.some((d) => d.id === c.id));
  assert.equal(await store.acquireCampaignLease(c.id, now), true);
  assert.equal(await store.acquireCampaignLease(c.id, now), false); // held
  await store.updateCampaignRecord(c.id, { lastOptimizedAt: now, leaseUntil: null });
  assert.equal((await store.dueForOptimize(now, undefined, 10_000)).some((d) => d.id === c.id), false);
});

test('campaign_ads: attribution map by ad_id and post_id + state updates', async () => {
  const org = `org-${randomUUID()}`;
  const adId = `ad-${randomUUID()}`; // unique — the DB may be shared across suite files
  const postId = `post-${randomUUID()}`;
  const c = await store.createCampaignRecord({ orgId: org, name: 'Attr', objective: 'messages', status: 'active' });
  await store.recordCampaignAd({ orgId: org, campaignId: c.id, adId, adsetId: 'AS1', postId, creativeRef: 'images/x.png' });

  const byAd = await store.campaignForAdOrPost({ adId });
  assert.equal(byAd?.campaign.id, c.id);
  const byPost = await store.campaignForAdOrPost({ postId });
  assert.equal(byPost?.ad.adId, adId);
  assert.equal(await store.campaignForAdOrPost({ adId: `nope-${randomUUID()}` }), null);

  await store.setAdState(adId, { effectiveStatus: 'DISAPPROVED', live: false });
  const ads = await store.listCampaignAds(c.id);
  assert.equal(ads[0].effectiveStatus, 'DISAPPROVED');
  assert.equal(ads[0].live, false);
  assert.equal((await store.listCampaignAds(c.id, true)).length, 0); // no live ads left
});

test('social_leads: idempotent on leadgen_id + listable', async () => {
  const org = `org-${randomUUID()}`;
  const leadgenId = `lg-${randomUUID()}`;
  assert.equal(await store.recordLead({ orgId: org, leadgenId, adId: 'ad-x', fields: { full_name: 'Sara', phone: '+9715' } }), true);
  assert.equal(await store.recordLead({ orgId: org, leadgenId }), false); // duplicate webhook
  const leads = await store.listLeads(org);
  assert.equal(leads.length, 1);
  assert.equal(leads[0].fields.full_name, 'Sara');
});

// ---- Phase D: funnel planning, decision log, first-campaign trust rule ----

test('planFunnel: prospecting-only until warm audiences exist; 80/20 once they do', async () => {
  const cold = store.planFunnel({ verticalLabel: 'Dental clinic', objective: 'leads', dailyBudgetUsd: 20 });
  assert.equal(cold.stages.length, 1);
  assert.match(cold.summary, /100% on finding new people/);
  assert.match(cold.summary, /leads/);
  const warm = store.planFunnel({ verticalLabel: 'Dental clinic', objective: 'messages', dailyBudgetUsd: 20, hasWarmAudience: true });
  assert.equal(warm.stages.length, 2);
  assert.equal(warm.stages[0].sharePct + warm.stages[1].sharePct, 100);
  assert.match(warm.summary, /80%.*20%/);
  // A tiny budget can't afford two ad sets even with a warm audience (learning floors).
  assert.equal(store.planFunnel({ verticalLabel: 'X', objective: 'leads', dailyBudgetUsd: 5, hasWarmAudience: true }).stages.length, 1);
});

test('decision log: newest first, capped, statusReason set on pause + cleared on launch', async () => {
  const org = `org-${randomUUID()}`;
  const c = await store.createCampaignRecord({ orgId: org, name: 'Log', objective: 'leads', status: 'active' });
  for (let i = 1; i <= 25; i++) await store.logDecision(c, `decision ${i}`);
  const after = (await store.getCampaignRecord(c.id))!;
  const decisions = (after.funnel as any).decisions as { at: number; summary: string }[];
  assert.equal(decisions.length, 20); // capped
  assert.equal(decisions[0].summary, 'decision 25'); // newest first
  await store.logDecision(after, 'Paused — spend cap reached.', 'spend cap reached');
  const paused = (await store.getCampaignRecord(c.id))!;
  assert.equal((paused.funnel as any).statusReason, 'spend cap reached');
  await store.logDecision(paused, 'Launched.', '');
  assert.equal(((await store.getCampaignRecord(c.id))!.funnel as any).statusReason, '');
});

test('first-campaign trust rule: robotHasLaunchedBefore flips only on a real launch', async () => {
  const robotId = `rb-${randomUUID()}`;
  const org = `org-${randomUUID()}`;
  assert.equal(await store.robotHasLaunchedBefore(robotId), false);
  // generating / pending_approval / failed don't count as "launched before".
  await store.createCampaignRecord({ orgId: org, robotId, name: 'P', objective: 'leads', status: 'pending_approval' });
  await store.createCampaignRecord({ orgId: org, robotId, name: 'F', objective: 'leads', status: 'failed' });
  assert.equal(await store.robotHasLaunchedBefore(robotId), false);
  await store.createCampaignRecord({ orgId: org, robotId, name: 'A', objective: 'leads', status: 'active' });
  assert.equal(await store.robotHasLaunchedBefore(robotId), true);
  assert.equal(await store.robotHasLaunchedBefore(null), false);
});

// ---- Review-fix locks: scarcity expiry, ref resolution, keep-best guard, tool-path gate ----

test('truthful scarcity has a clock: dated urgency creatives never rotate in after expiry', async () => {
  const endsAt = Date.UTC(2026, 0, 15);
  const brief = { product: 'FreshCrate', topics: ['veg boxes'], offerEndsAt: endsAt } as any;
  const pool = [
    { ref: 'images/a.jpg', type: 'image', format: '1:1', headline: 'Offer ends Jan 15 — veg boxes', body: 'FreshCrate. Order now.', imageHash: 'h1' },
    { ref: 'images/b.jpg', type: 'image', format: '1:1', headline: 'veg boxes — done for you', body: 'FreshCrate. Order now.', imageHash: 'h2' },
  ] as any[];
  // Before the date: both shippable.
  assert.equal(store.rotatableCreatives(pool, brief, endsAt - 86_400_000).length, 2);
  // After: the dated creative is out for good; the benefit one still rotates.
  const after = store.rotatableCreatives(pool, brief, endsAt + 86_400_000);
  assert.equal(after.length, 1);
  assert.match(after[0].headline!, /done for you/);
  // Live ads still claiming the expired date are named for retirement.
  const livePool = pool.map((c, i) => ({ ...c, live: true, adId: `ad-${i}` }));
  assert.deepEqual(store.expiredUrgencyAdIds(livePool, brief, endsAt + 1), ['ad-0']);
  assert.deepEqual(store.expiredUrgencyAdIds(livePool, brief, endsAt - 1), []); // not yet
});

test('resolveCreativeRef: anchors at the org media root, refuses escapes', async () => {
  const { config } = await import('../src/config');
  const org = `org-${randomUUID()}`;
  const root = path.join(config.dataDir, 'campaign-media', org);
  fs.mkdirSync(path.join(root, 'images'), { recursive: true });
  const file = path.join(root, 'images', 'creative-1.jpg');
  fs.writeFileSync(file, 'jpg');
  assert.equal(store.resolveCreativeRef(org, 'images/creative-1.jpg'), file); // the generator's relative shape
  assert.equal(store.resolveCreativeRef(org, file), file); // absolute inside the root
  assert.equal(store.resolveCreativeRef(org, '../other-org/images/creative-1.jpg'), null); // traversal
  assert.equal(store.resolveCreativeRef(org, '/etc/passwd'), null); // absolute outside
  assert.equal(store.resolveCreativeRef(org, 'images/missing.jpg'), null); // missing file
});

test('never-empty guard keeps the BEST ad; zero-result judged spend counts against the target', () => {
  const mk = (adId: string, cpr: number | null, over: any = {}) => ({
    adId, spend: 40, impressions: 5000, ctr: 1.4, frequency: 2,
    results: cpr ? Math.round((40 / cpr) * 100) / 100 : 0, costPerResult: cpr, ...over,
  });
  // Both ads over 2x the $10 target: the survivor must be the CHEAPER ad, never last-pushed.
  const d = store.decideOptimizations([mk('GOOD-21', 21), mk('BAD-45', 45)] as any, { targetCprUsd: 10 });
  assert.deepEqual(d.pause.map((p) => p.adId), ['BAD-45']);
  assert.ok(d.notes.some((n) => /best-performing ad live/.test(n)));
  // A judged ad burning spend with ZERO results counts against the target (no false stability).
  const burn = store.decideOptimizations([mk('A', 8), mk('B', null, { spend: 100 })] as any, { targetCprUsd: 10 });
  assert.ok(!burn.notes.some((n) => /keeping the winning mix stable/.test(n)), 'no stability claim while $100 burns');
  assert.ok(burn.rotate, 'blended CPR over 1.3x target -> rotate harder');
});

test('first-campaign trust rule applies only to robot-driven campaigns (tool path keeps autopilot)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/robots/socialCampaigns.ts'), 'utf8');
  assert.match(src, /input\.robotId \? !\(await robotHasLaunchedBefore\(input\.robotId\)\) : false/);
  // The optimize pass re-reads the record before its final funnel write (mid-pass user
  // actions must never be clobbered by a stale spread).
  assert.match(src, /const latest = await getCampaignRecord\(rec\.id\)/);
});
