import { config } from '../../config';
import { connectorsEnabled, fetchReport, PROVIDERS, type Provider } from '../../connectors';
import { findForProvider, listConnectors } from '../../connectors/store';
import type { AdsRow, Connector, ReportParams } from '../../connectors/types';
import type { ToolDef } from './common';

const MAX_ROWS = 300;

/** Resolve a connector by exact account id OR by (fuzzy) account name — every connected ad
 *  account is its own connector row, so "FXP" or its id both find the right one. Returns the
 *  match plus the full candidate list for that provider (so callers can show what IS connected). */
async function resolveAccount(orgId: string, provider: Provider, sel: string | undefined): Promise<{ match: Connector | null; candidates: Connector[] }> {
  const candidates = (await listConnectors(orgId)).filter((c) => c.provider === provider && c.status !== 'revoked');
  if (!sel) return { match: candidates[0] ?? null, candidates };
  const q = sel.trim().toLowerCase();
  const match =
    candidates.find((c) => c.accountId.toLowerCase() === q || `act_${c.accountId}`.toLowerCase() === q) ??
    candidates.find((c) => (c.accountName ?? '').toLowerCase() === q) ??
    candidates.find((c) => (c.accountName ?? '').toLowerCase().includes(q)) ??
    null;
  return { match, candidates };
}

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
      account_id: { type: 'string', description: 'Which connected ad account — its id OR its name (e.g. "FXP"). Call list_ad_accounts first to see them. Default: the first connected one.' },
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

    const sel = args.account_id ? String(args.account_id) : undefined;
    const { match: conn, candidates } = await resolveAccount(orgId, provider, sel);
    if (!conn) {
      // A selector that matched nothing among REAL connected accounts is NOT a "connect it"
      // situation — list what IS connected so the caller can pick the right one (or its id).
      if (sel && candidates.length) {
        return `No ${provider} ad account matches "${sel}". These ${provider} accounts ARE connected — use one of these (by name or id): ${candidates.map((c) => `${c.accountName ?? c.accountId} (id ${c.accountId})`).join('; ')}. Do NOT tell the user to reconnect — the accounts are already connected.`;
      }
      const connected = (await listConnectors(orgId)).map((c) => c.provider);
      const have = connected.length ? `Connected providers: ${[...new Set(connected)].join(', ')}.` : 'No ad accounts are connected yet.';
      return `No ${provider} ad account is connected for this organization. ${have} Connect it in Settings → Connections, then retry.`;
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
      return `Live ${provider} ads — account "${conn.accountName ?? conn.accountId}" (id ${conn.accountId}), ${params.since} → ${params.until}, by ${params.level}:\n\n${table(rows)}`;
    } catch (e: any) {
      return `Error fetching ${provider} ads for "${conn.accountName ?? conn.accountId}": ${e?.message ?? e}`;
    }
  },
};

/** List EVERY connected ad account (all providers) with its real id — so the agent can target
 *  a specific one (e.g. FXP) instead of only ever seeing the first. Reads the connector store;
 *  never guesses. An org routinely connects several Meta ad accounts, each its own row. */
export const listAdAccountsTool: ToolDef = {
  name: 'list_ad_accounts',
  description:
    'List ALL connected ad accounts for this organization (Meta / Google / TikTok) with each ' +
    'account\'s name, real id, and status. Call this FIRST whenever the user names a specific ad ' +
    'account (e.g. "FXP") or asks "which accounts are connected" — then pass the chosen account\'s ' +
    'id (or name) to fetch_ads / the campaign tools. Reads the stored connections; it does not ' +
    'guess. If an account the user expects is missing, only THEN is reconnecting relevant.',
  parameters: { type: 'object', properties: {} },
  modes: ['chat', 'code', 'report'],
  available: () => connectorsEnabled(),
  summarize: () => 'list ad accounts',
  async run(_args, ctx) {
    const orgId = ctx.session.orgId;
    if (!orgId) return 'Error: ad connectors are organization-scoped; this session has no organization.';
    const conns = (await listConnectors(orgId)).filter((c) => c.status !== 'revoked');
    if (!conns.length) return 'No ad accounts are connected. The user connects them in Settings → Connections.';
    const byProvider = new Map<string, Connector[]>();
    for (const c of conns) (byProvider.get(c.provider) ?? byProvider.set(c.provider, []).get(c.provider)!).push(c);
    const lines: string[] = [`${conns.length} connected ad account(s):`];
    for (const [prov, list] of byProvider) {
      lines.push(`\n${prov.toUpperCase()}:`);
      for (const c of list) lines.push(`  • ${c.accountName ?? c.accountId} — id ${c.accountId}${c.status !== 'active' ? ` [${c.status}]` : ''}`);
    }
    lines.push('\nTo pull one account\'s data, call fetch_ads with account_id set to its name or id.');
    return lines.join('\n');
  },
};
