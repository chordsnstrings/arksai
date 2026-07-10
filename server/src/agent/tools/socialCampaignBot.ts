import type { ToolDef, ToolCtx } from './common';
import { providerAvailable } from '../../connectors';
import {
  setupManagedCampaign, launchManagedCampaign, pauseManagedCampaign,
  getCampaignRecord, listCampaignRecords, listCampaignAds, listLeads,
  type CampaignObjective,
} from '../../robots/socialCampaigns';

/**
 * Campaign-bot agent surface. `launch_managed_campaign` runs the WHOLE setup loop (brief →
 * funnel → ~30-creative pool → assemble PAUSED → autopilot-within-cap launch decision);
 * `manage_campaign` approves/pauses/inspects. The 48h optimise loop runs from the scheduler,
 * not from here.
 */

export const launchManagedCampaignTool: ToolDef = {
  name: 'launch_managed_campaign',
  description:
    'Run the FULL campaign bot for Facebook/Instagram from one brief: designs the funnel for the ' +
    'chosen outcome (leads via Instant Form / messages / traffic / sales — sales degrades honestly ' +
    'without a Pixel), auto-generates a rotating creative pool (~30 images across mobile+web ' +
    'formats, generation-cost capped), assembles campaign→ad sets→Dynamic Creative ads ALL PAUSED, ' +
    'then launches ONLY if autopilot:true AND within daily_cap_usd (else it awaits approval). ' +
    'The 48h optimiser then rebalances automatically. This call takes several minutes ' +
    '(creative generation). Budget: budget_model daily|lifetime + budget_usd (+ duration_days ' +
    'for lifetime).',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      product: { type: 'string', description: 'What is being promoted' },
      topics: { type: 'array', items: { type: 'string' }, description: 'Angles/topics the creatives + replies use' },
      objective: { type: 'string', enum: ['leads', 'messages', 'traffic', 'sales', 'engagement', 'awareness'] },
      destination: { type: 'string', description: 'URL (traffic/sales) or messenger|instagram_direct (messages); leads auto-creates an Instant Form' },
      cta: { type: 'string', description: 'CTA button, e.g. SIGN_UP / SHOP_NOW / LEARN_MORE' },
      budget_model: { type: 'string', enum: ['daily', 'lifetime'] },
      budget_usd: { type: 'number' },
      duration_days: { type: 'number' },
      daily_cap_usd: { type: 'number', description: 'HARD ceiling on daily spend (launch blocked above it)' },
      generation_cap_usd: { type: 'number', description: 'Cap on creative-generation spend (default $3)' },
      image_count: { type: 'number', description: 'Creative pool size (default 30, max 50)' },
      audience: { type: 'object', description: '{countries:[ISO2], age_min, age_max, genders, interests, broad:true}' },
      engage_say: { type: 'string', description: 'What to say when people comment/DM about these ads' },
      engage_do_not_say: { type: 'string' },
      engage_escalate_if: { type: 'string' },
      autopilot: { type: 'boolean', description: 'true → launch automatically within the cap; false → assemble paused and ask' },
      account_id: { type: 'string' },
    },
    required: ['name', 'product', 'objective', 'budget_model', 'budget_usd', 'daily_cap_usd'],
  },
  modes: ['chat', 'code'],
  available: () => providerAvailable('meta'),
  summarize: (a) => `campaign bot: ${String(a.name ?? '').slice(0, 30)}`,
  async run(args: any, ctx: ToolCtx): Promise<string> {
    const orgId = ctx.session.orgId;
    if (!orgId) return 'Error: organization-scoped.';
    const r = await setupManagedCampaign(
      {
        orgId,
        name: String(args.name),
        brief: {
          product: String(args.product),
          topics: Array.isArray(args.topics) ? args.topics.map(String) : [],
          cta: args.cta ? String(args.cta) : undefined,
          destination: args.destination ? String(args.destination) : undefined,
          audience: args.audience && typeof args.audience === 'object'
            ? {
                countries: Array.isArray(args.audience.countries) ? args.audience.countries.map(String) : undefined,
                ageMin: args.audience.age_min, ageMax: args.audience.age_max,
                genders: args.audience.genders, interests: args.audience.interests,
                broad: args.audience.broad !== false,
              }
            : undefined,
          imageCount: args.image_count ? Number(args.image_count) : 30,
        },
        objective: String(args.objective) as CampaignObjective,
        budgetModel: args.budget_model === 'lifetime' ? 'lifetime' : 'daily',
        budgetUsd: Number(args.budget_usd),
        durationDays: args.duration_days ? Number(args.duration_days) : undefined,
        engageSpecifics: args.engage_say || args.engage_do_not_say || args.engage_escalate_if
          ? { say: args.engage_say, doNotSay: args.engage_do_not_say, escalateIf: args.engage_escalate_if }
          : null,
        autonomyLevel: args.autopilot ? 85 : 30,
        adDailyCapUsd: Math.max(1, Number(args.daily_cap_usd)),
        generationCapUsd: args.generation_cap_usd ? Number(args.generation_cap_usd) : 3,
        accountId: args.account_id ? String(args.account_id) : undefined,
        signal: ctx.signal,
        addCost: ctx.addCost,
      },
      ctx.repoDir,
    );
    const head = r.ok ? (r.launched ? '🚀 CAMPAIGN LIVE' : '⏸ ASSEMBLED — AWAITING APPROVAL') : '❌ NOT LAUNCHED';
    return [
      `${head}${r.campaignId ? ` (id ${r.campaignId})` : ''}`,
      r.detail,
      r.degradeNote ? `Note: ${r.degradeNote}` : '',
      r.generatedCreatives ? `Creative pool: ${r.generatedCreatives} (generation spend $${r.generationSpendUsd})` : '',
    ].filter(Boolean).join('\n');
  },
};

export const manageCampaignTool: ToolDef = {
  name: 'manage_campaign',
  description:
    'Manage a bot-run campaign: action=status (record + ads + recent leads), approve (launch a ' +
    'pending campaign — the owner has said yes), pause (stop spend, always allowed), list (all ' +
    'managed campaigns for this org).',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['status', 'approve', 'pause', 'list'] },
      campaign_id: { type: 'string' },
      reason: { type: 'string' },
    },
    required: ['action'],
  },
  modes: ['chat', 'code', 'report'],
  available: () => providerAvailable('meta'),
  summarize: (a) => `campaign ${String(a.action ?? '')}`,
  async run(args: any, ctx: ToolCtx): Promise<string> {
    const orgId = ctx.session.orgId;
    if (!orgId) return 'Error: organization-scoped.';
    const action = String(args.action);
    if (action === 'list') {
      const all = await listCampaignRecords(orgId);
      if (!all.length) return 'No managed campaigns yet.';
      return all.map((c) => `${c.status.toUpperCase()} · ${c.name} · ${c.objective} · $${(c.dailyCapUsd ?? 0)}/day cap · spent $${c.spentUsd}${c.endAt ? ` · ends ${new Date(c.endAt).toISOString().slice(0, 10)}` : ''} · id ${c.id}`).join('\n');
    }
    const id = String(args.campaign_id ?? '');
    const rec = await getCampaignRecord(id);
    if (!rec || rec.orgId !== orgId) return 'Error: unknown campaign for this organization.';
    if (action === 'approve') {
      const r = await launchManagedCampaign(id, ctx.session.createdBy ?? 'owner');
      return r.ok ? `✅ ${r.detail}` : `Error: ${r.detail}`;
    }
    if (action === 'pause') {
      const r = await pauseManagedCampaign(id, String(args.reason ?? 'owner request'));
      return r.ok ? `⏸ ${r.detail}` : `Error: ${r.detail}`;
    }
    // status
    const ads = await listCampaignAds(id);
    const leads = (await listLeads(orgId, 10)).filter((l) => l.campaignId === id);
    const pool = rec.creativePool;
    return [
      `${rec.name} — ${rec.status.toUpperCase()} (${rec.objective})`,
      `Budget: ${rec.budgetModel === 'lifetime' ? `$${rec.totalCapUsd} total` : ''} cap $${rec.dailyCapUsd}/day · spent $${rec.spentUsd}`,
      `Pool: ${pool.length} creatives (${pool.filter((p) => p.live).length} live, ${pool.filter((p) => !p.used).length} fresh)`,
      `Ads: ${ads.map((a) => `${a.adId}${a.effectiveStatus ? ` [${a.effectiveStatus}]` : ''}${a.live ? '' : ' (off)'}`).join(', ') || 'none'}`,
      rec.lastOptimizedAt ? `Last optimised: ${new Date(rec.lastOptimizedAt).toISOString()}` : 'Not yet optimised (48h loop pending).',
      leads.length ? `Recent leads: ${leads.length} (latest ${new Date(leads[0].createdAt).toISOString().slice(0, 16)})` : '',
    ].filter(Boolean).join('\n');
  },
};

export const SOCIAL_CAMPAIGN_BOT_TOOLS: ToolDef[] = [launchManagedCampaignTool, manageCampaignTool];
