import type { ToolDef, ToolCtx } from './common';
import { providerAvailable } from '../../connectors';
import { listMetaPages } from '../../connectors/store';

/**
 * List the Facebook Pages connected to this org's Meta account — from the STORED page records
 * (enumerated at connect time), never guessed. If nothing is stored, the honest cause is the
 * connection lacking `pages_show_list` (the agent must say exactly that, not invent page names).
 */
export const listPagesTool: ToolDef = {
  name: 'list_pages',
  description:
    'List the Facebook Pages (and linked Instagram accounts) connected to this organization\'s ' +
    'Meta account. Reads the stored page records captured when the account was connected — it ' +
    'does NOT and CANNOT invent page names. If it returns none, the connection was made without ' +
    'the Pages permission (pages_show_list): tell the user to reconnect Meta and grant it — do ' +
    'not guess or list page names from memory.',
  parameters: { type: 'object', properties: {} },
  modes: ['chat', 'code', 'report'],
  available: () => providerAvailable('meta'),
  summarize: () => 'list connected Pages',
  async run(_args: any, ctx: ToolCtx): Promise<string> {
    const orgId = ctx.session.orgId;
    if (!orgId) return 'Error: organization-scoped.';
    const pages = await listMetaPages(orgId);
    if (!pages.length) {
      return (
        'No Facebook Pages are on record for this connection. This means the Meta account was ' +
        'connected WITHOUT the Pages permission (pages_show_list). To list Pages: reconnect Meta ' +
        'in Settings → Connections and grant page access. Do NOT guess page names — there are ' +
        'none available to report.'
      );
    }
    return [
      `${pages.length} connected Page(s):`,
      ...pages.map((p, i) =>
        `${i + 1}. ${p.name ?? p.pageId} (id ${p.pageId})${p.category ? ` · ${p.category}` : ''}${p.igUsername ? ` · IG @${p.igUsername}` : ''}`,
      ),
    ].join('\n');
  },
};
