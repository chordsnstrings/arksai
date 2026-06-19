import { config } from '../../config';
import { connectorsEnabled, fetchReport, PROVIDERS, type Provider } from '../../connectors';
import { findForProvider, listConnectors } from '../../connectors/store';
import type { AdsRow, ReportParams } from '../../connectors/types';
import type { ToolDef } from './common';

const MAX_ROWS = 300;

function table(rows: AdsRow[]): string {
  if (!rows.length) return '(no rows returned for that date range)';
  const cols = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  const head = cols.join(' | ');
  const body = rows.slice(0, MAX_ROWS).map((r) => cols.map((c) => (r[c] ?? '')).join(' | '));
  const note = rows.length > MAX_ROWS ? `\n… (${rows.length - MAX_ROWS} more rows; ${rows.length} total)` : `\n(${rows.length} rows)`;
  return [head, ...body].join('\n') + note;
}

function isoDaysAgo(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}

/** Pull live ad-platform performance for the current org's connected accounts. */
export const fetchAdsTool: ToolDef = {
  name: 'fetch_ads',
  description:
    'Fetch LIVE ad performance from the organization\'s connected ad accounts (Meta/Facebook, ' +
    'Google Ads, TikTok Ads) — so you can build dashboards, reports, and analyses off real numbers. ' +
    'Returns a normalized table (spend, impressions, clicks, ctr, conversions, …). The user connects ' +
    'accounts in Settings → Connections; if a provider isn\'t connected, tell them to connect it there. ' +
    'Defaults to the last 30 days, broken down by campaign.',
  parameters: {
    type: 'object',
    properties: {
      provider: { type: 'string', enum: PROVIDERS as unknown as string[], description: 'meta | google | tiktok' },
      since: { type: 'string', description: 'Start date YYYY-MM-DD (default: 30 days ago)' },
      until: { type: 'string', description: 'End date YYYY-MM-DD (default: today)' },
      level: { type: 'string', enum: ['account', 'campaign', 'adset', 'ad', 'day'], description: 'Breakdown (default campaign)' },
      account_id: { type: 'string', description: 'Specific connected ad-account id (default: the first connected one)' },
      metrics: { type: 'array', items: { type: 'string' }, description: 'Optional metric names; a sensible default set is used otherwise' },
    },
    required: ['provider'],
  },
  modes: ['chat', 'code', 'report'],
  available: () => connectorsEnabled(),
  summarize: (a) => `fetch ${String(a.provider ?? 'ads')} ads`,
  async run(args, ctx) {
    const orgId = ctx.session.orgId;
    if (!orgId) return 'Error: ad connectors are organization-scoped; this session has no organization.';
    const provider = String(args.provider ?? '') as Provider;
    if (!(PROVIDERS as string[]).includes(provider)) return 'Error: provider must be one of meta, google, tiktok.';

    const conn = await findForProvider(orgId, provider, args.account_id ? String(args.account_id) : undefined);
    if (!conn) {
      const connected = (await listConnectors(orgId)).map((c) => c.provider);
      const have = connected.length ? `Connected: ${[...new Set(connected)].join(', ')}.` : 'No ad accounts are connected yet.';
      return `No active ${provider} connection for this organization. ${have} Connect it in Settings → Connections, then retry.`;
    }

    const params: ReportParams = {
      accountId: conn.accountId,
      since: args.since ? String(args.since) : isoDaysAgo(30),
      until: args.until ? String(args.until) : isoDaysAgo(0),
      level: (args.level as ReportParams['level']) || 'campaign',
      metrics: Array.isArray(args.metrics) ? args.metrics.map(String) : undefined,
    };
    try {
      const rows = await fetchReport(conn, params, ctx.signal);
      return `Live ${provider} ads — account "${conn.accountName ?? conn.accountId}", ${params.since} → ${params.until}, by ${params.level}:\n\n${table(rows)}`;
    } catch (e: any) {
      return `Error fetching ${provider} ads: ${e?.message ?? e}. The connection may need to be re-authorized in Settings → Connections.`;
    }
  },
};
