import type { ToolDef, ToolCtx } from './common';
import {
  createCampaignRequest, createAdSetRequest, createCreativeRequest, createAdRequest,
  updateStatusRequest, updateBudgetRequest, graphPost, resolveAdCreds,
  type Objective, type Targeting,
} from '../../connectors/metaCampaigns';
import { guardCampaignAction, recordCampaignAction, listCampaignActions, type SpendCaps } from '../../robots/campaigns';
import { resolveSocialCreds } from '../../robots/social';
import { fetchReport } from '../../connectors';
import { findForProvider } from '../../connectors/store';

/**
 * Track C tools — paid ads. Campaigns are created PAUSED; launch/budget changes are gated:
 * they require approval (approved:true, set by the owner via the robot's approval lane, or
 * automatically only at Autopilot) AND stay within the spend cap. Every mutation is audited.
 */

// Default guard caps for a chat/commander session (the Social robot's per-robot cap refines
// this at the surfacing layer; the arg cap can only tighten it).
const DEFAULT_DAILY_CAP_USD = 100;

function caps(argCap?: number): SpendCaps {
  const cap = Math.min(DEFAULT_DAILY_CAP_USD, Number(argCap) || DEFAULT_DAILY_CAP_USD);
  return { dailyCapUsd: cap, requireApproval: true };
}

async function adCreds(orgId: string, accountId?: string) {
  return resolveAdCreds(orgId, accountId);
}

export const planCampaignTool: ToolDef = {
  name: 'plan_campaign',
  description:
    'Design a paid Facebook/Instagram ad campaign from a brief and return a structured plan to ' +
    'review BEFORE anything is created. Include objective, daily budget, audience (countries, ' +
    'age, interests), placements (incl. Instagram), and a creative brief. Writes nothing.',
  parameters: {
    type: 'object',
    properties: { brief: { type: 'string' }, daily_budget_usd: { type: 'number' }, goal: { type: 'string' } },
    required: ['brief'],
  },
  modes: ['chat', 'code'],
  summarize: () => 'plan a campaign',
  async run(args: any): Promise<string> {
    return (
      `Design ONE ad campaign for this brief and present it for approval as a plan: objective ` +
      `(traffic/engagement/leads/sales/awareness), daily budget (USD), audience (countries, age ` +
      `range, genders, interests), placements (Facebook + Instagram feed/stories/reels), and a ` +
      `creative brief (headline, primary text, CTA, what image/video to make). Do NOT create ` +
      `anything until the owner approves. Brief: ${String(args.brief).slice(0, 1000)}` +
      (args.daily_budget_usd ? `\nDaily budget: $${args.daily_budget_usd}.` : '')
    );
  },
};

export const createCampaignTool: ToolDef = {
  name: 'create_campaign',
  description:
    'Create a PAUSED Facebook/Instagram ad campaign (campaign → ad set → ad + creative). Nothing ' +
    'spends until you call launch_campaign. objective: traffic|engagement|leads|sales|awareness. ' +
    'targeting: {countries:[ISO2], age_min, age_max, genders:[male|female], interests:[ids], ' +
    'instagram:true}. creative: {message, link, cta, image_url?}. Returns the created ids.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      objective: { type: 'string', enum: ['traffic', 'engagement', 'leads', 'sales', 'awareness'] },
      daily_budget_usd: { type: 'number' },
      targeting: { type: 'object' },
      creative: { type: 'object' },
      account_id: { type: 'string' },
    },
    required: ['name', 'objective', 'daily_budget_usd', 'targeting', 'creative'],
  },
  modes: ['chat', 'code'],
  summarize: (a) => `create campaign "${String(a.name ?? '').slice(0, 30)}"`,
  async run(args: any, ctx: ToolCtx): Promise<string> {
    const orgId = ctx.session.orgId;
    if (!orgId) return 'Error: organization-scoped.';
    const creds = await adCreds(orgId, args.account_id);
    if (!creds) return 'Error: no Meta ad account is connected. Connect it under Settings → Connections.';
    const t: Targeting = {
      countries: Array.isArray(args.targeting?.countries) ? args.targeting.countries.map(String) : [],
      ageMin: args.targeting?.age_min, ageMax: args.targeting?.age_max,
      genders: args.targeting?.genders, interests: args.targeting?.interests,
      instagram: !!args.targeting?.instagram,
    };
    if (!t.countries.length) return 'Error: targeting.countries is required (ISO-2 codes, e.g. ["AE"]).';
    // IG placement needs a linked Page+IG.
    const social = t.instagram ? await resolveSocialCreds(orgId) : null;
    const guard = guardCampaignAction({ action: 'create_campaign', approved: true, wantsInstagram: t.instagram, hasPageAndIg: !!(social && social.igUserId) }, caps(args.daily_budget_usd));
    if (!guard.ok) return `Error: ${guard.reason}`;
    try {
      const c = createCampaignRequest(creds.accountId, { name: String(args.name), objective: String(args.objective) as Objective });
      const campaign = await graphPost(c.url, creds.accessToken, c.body);
      const campaignId = String(campaign.id);
      const s = createAdSetRequest(creds.accountId, { campaignId, name: `${args.name} — ad set`, dailyBudgetUsd: Number(args.daily_budget_usd), targeting: t });
      const adset = await graphPost(s.url, creds.accessToken, s.body);
      const cr = createCreativeRequest(creds.accountId, {
        name: `${args.name} — creative`, pageId: social?.pageId || String(args.creative?.page_id || ''),
        instagramActorId: social?.igUserId || undefined,
        message: String(args.creative?.message || ''), link: String(args.creative?.link || ''),
        imageUrl: args.creative?.image_url ? String(args.creative.image_url) : undefined,
        cta: args.creative?.cta ? String(args.creative.cta) : undefined,
      });
      const creative = await graphPost(cr.url, creds.accessToken, cr.body);
      const a = createAdRequest(creds.accountId, { name: `${args.name} — ad`, adSetId: String(adset.id), creativeId: String(creative.id) });
      const ad = await graphPost(a.url, creds.accessToken, a.body);
      await recordCampaignAction({ orgId, connectorId: null, action: 'create_campaign', objectIds: JSON.stringify({ campaignId, adsetId: adset.id, adId: ad.id }), requestedBudgetUsd: Number(args.daily_budget_usd), status: 'executed', detail: String(args.name) });
      return `✅ Created PAUSED campaign "${args.name}".\ncampaign_id: ${campaignId}\nad_set_id: ${adset.id}\nad_id: ${ad.id}\nNothing is spending yet — call launch_campaign (with the owner's approval) to go live.`;
    } catch (e: any) {
      await recordCampaignAction({ orgId, action: 'create_campaign', status: 'failed', detail: e?.message ?? String(e) }).catch(() => {});
      return `Error creating campaign: ${e?.message ?? e}`;
    }
  },
};

async function setStatus(ctx: ToolCtx, objectId: string, status: 'ACTIVE' | 'PAUSED', accountId?: string): Promise<string> {
  const orgId = ctx.session.orgId!;
  const creds = await adCreds(orgId, accountId);
  if (!creds) return 'Error: no Meta ad account is connected.';
  const u = updateStatusRequest(objectId, status);
  await graphPost(u.url, creds.accessToken, u.body);
  await recordCampaignAction({ orgId, action: status === 'ACTIVE' ? 'launch' : 'pause', objectIds: JSON.stringify({ objectId }), status: 'executed' });
  return `✅ ${objectId} is now ${status}.`;
}

export const launchCampaignTool: ToolDef = {
  name: 'launch_campaign',
  description:
    'Set a campaign or ad set LIVE (this SPENDS MONEY). Requires approved:true (the owner has ' +
    'approved) and stays within the daily spend cap. daily_budget_usd is the ad set\'s daily ' +
    'budget for the cap check. Use pause_campaign to stop it.',
  parameters: {
    type: 'object',
    properties: { object_id: { type: 'string', description: 'campaign_id or ad_set_id' }, daily_budget_usd: { type: 'number' }, approved: { type: 'boolean' }, account_id: { type: 'string' } },
    required: ['object_id', 'daily_budget_usd'],
  },
  modes: ['chat', 'code'],
  summarize: () => 'launch a campaign',
  async run(args: any, ctx: ToolCtx): Promise<string> {
    if (!ctx.session.orgId) return 'Error: organization-scoped.';
    const guard = guardCampaignAction({ action: 'launch', approved: !!args.approved, requestedDailyUsd: Number(args.daily_budget_usd) }, caps(args.daily_budget_usd));
    if (!guard.ok) {
      await recordCampaignAction({ orgId: ctx.session.orgId, action: 'launch', objectIds: JSON.stringify({ objectId: args.object_id }), requestedBudgetUsd: Number(args.daily_budget_usd), status: 'proposed', detail: guard.reason }).catch(() => {});
      return `Not launched — ${guard.reason}`;
    }
    try {
      return await setStatus(ctx, String(args.object_id), 'ACTIVE', args.account_id);
    } catch (e: any) {
      return `Error launching: ${e?.message ?? e}`;
    }
  },
};

export const pauseCampaignTool: ToolDef = {
  name: 'pause_campaign',
  description: 'Pause a live campaign or ad set (stops spend immediately). Always allowed.',
  parameters: { type: 'object', properties: { object_id: { type: 'string' }, account_id: { type: 'string' } }, required: ['object_id'] },
  modes: ['chat', 'code'],
  summarize: () => 'pause a campaign',
  async run(args: any, ctx: ToolCtx): Promise<string> {
    if (!ctx.session.orgId) return 'Error: organization-scoped.';
    try {
      return await setStatus(ctx, String(args.object_id), 'PAUSED', args.account_id);
    } catch (e: any) {
      return `Error pausing: ${e?.message ?? e}`;
    }
  },
};

export const setBudgetTool: ToolDef = {
  name: 'set_budget',
  description: 'Change an ad set\'s daily budget (USD). Requires approved:true and stays within the spend cap.',
  parameters: {
    type: 'object',
    properties: { ad_set_id: { type: 'string' }, daily_budget_usd: { type: 'number' }, approved: { type: 'boolean' }, account_id: { type: 'string' } },
    required: ['ad_set_id', 'daily_budget_usd'],
  },
  modes: ['chat', 'code'],
  summarize: () => 'change a budget',
  async run(args: any, ctx: ToolCtx): Promise<string> {
    const orgId = ctx.session.orgId;
    if (!orgId) return 'Error: organization-scoped.';
    const guard = guardCampaignAction({ action: 'budget_change', approved: !!args.approved, requestedDailyUsd: Number(args.daily_budget_usd) }, caps(args.daily_budget_usd));
    if (!guard.ok) return `Not changed — ${guard.reason}`;
    const creds = await adCreds(orgId, args.account_id);
    if (!creds) return 'Error: no Meta ad account is connected.';
    try {
      const u = updateBudgetRequest(String(args.ad_set_id), Number(args.daily_budget_usd));
      await graphPost(u.url, creds.accessToken, u.body);
      await recordCampaignAction({ orgId, action: 'budget_change', objectIds: JSON.stringify({ adSetId: args.ad_set_id }), requestedBudgetUsd: Number(args.daily_budget_usd), status: 'executed' });
      return `✅ Ad set ${args.ad_set_id} daily budget set to $${args.daily_budget_usd}.`;
    } catch (e: any) {
      return `Error setting budget: ${e?.message ?? e}`;
    }
  },
};

export const campaignReportTool: ToolDef = {
  name: 'campaign_report',
  description: 'Live performance for the org\'s Meta ad campaigns (spend, impressions, clicks, CTR, conversions) with deterministic optimisation suggestions (pause weak ads, shift budget to the best).',
  parameters: {
    type: 'object',
    properties: { since: { type: 'string' }, until: { type: 'string' }, level: { type: 'string', enum: ['campaign', 'adset', 'ad'] }, account_id: { type: 'string' } },
  },
  modes: ['chat', 'code', 'report'],
  summarize: () => 'campaign report',
  async run(args: any, ctx: ToolCtx): Promise<string> {
    const orgId = ctx.session.orgId;
    if (!orgId) return 'Error: organization-scoped.';
    const conn = await findForProvider(orgId, 'meta', args.account_id ? String(args.account_id) : undefined);
    if (!conn) return 'Error: no Meta ad account is connected.';
    const iso = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
    try {
      const rows = await fetchReport(conn, { accountId: conn.accountId, since: args.since ? String(args.since) : iso(14), until: args.until ? String(args.until) : iso(0), level: (args.level as any) || 'ad' }, ctx.signal);
      if (!rows.length) return 'No ad performance for that range (campaigns may be new or paused).';
      // Deterministic suggestions.
      const withCtr = rows.map((r: any) => ({ ...r, _ctr: Number(r.ctr) || (Number(r.clicks) / Math.max(1, Number(r.impressions))) * 100, _imp: Number(r.impressions) || 0 }));
      const weak = withCtr.filter((r) => r._imp >= 500 && r._ctr < 0.5);
      const best = [...withCtr].sort((a, b) => b._ctr - a._ctr)[0];
      const table = [Array.from(new Set(rows.flatMap((r) => Object.keys(r)))).join(' | '), ...rows.slice(0, 50).map((r) => Object.values(r).join(' | '))].join('\n');
      const tips: string[] = [];
      if (best) tips.push(`Top performer (CTR ${best._ctr.toFixed(2)}%) — consider shifting budget here.`);
      if (weak.length) tips.push(`${weak.length} ad(s) with CTR < 0.5% after 500+ impressions — consider pausing.`);
      return `Live Meta ads (${conn.accountName ?? conn.accountId}):\n\n${table}\n\nSuggestions:\n${tips.length ? tips.map((t) => `• ${t}`).join('\n') : '• Performance looks healthy.'}`;
    } catch (e: any) {
      return `Error fetching report: ${e?.message ?? e}`;
    }
  },
};

export const listCampaignActionsTool: ToolDef = {
  name: 'campaign_actions_log',
  description: 'The audit trail of ad actions this organization has taken (created/launched/paused/budget changes) with status.',
  parameters: { type: 'object', properties: { limit: { type: 'number' } } },
  modes: ['chat', 'code', 'report'],
  summarize: () => 'ad action log',
  async run(args: any, ctx: ToolCtx): Promise<string> {
    if (!ctx.session.orgId) return 'Error: organization-scoped.';
    const rows = await listCampaignActions(ctx.session.orgId, Number(args.limit) || 30);
    if (!rows.length) return 'No ad actions yet.';
    return rows.map((r) => `${new Date(r.createdAt).toISOString().slice(0, 16)} · ${r.action} · ${r.status}${r.requestedBudgetUsd ? ` · $${r.requestedBudgetUsd}/day` : ''}${r.detail ? ` · ${r.detail}` : ''}`).join('\n');
  },
};

export const META_CAMPAIGN_TOOLS: ToolDef[] = [
  planCampaignTool, createCampaignTool, launchCampaignTool, pauseCampaignTool, setBudgetTool, campaignReportTool, listCampaignActionsTool,
];
