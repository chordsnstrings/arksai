import { publishSession } from '../../deploy/publish';
import type { ToolDef } from './common';

/**
 * Publish the built app to a durable public URL the (non-technical) user can
 * actually open and use — the "it's actually live" half of the promise.
 */
export const publishAppTool: ToolDef = {
  name: 'publish_app',
  description:
    'Publish the current app to a durable public URL the user can open and use. It survives the session ' +
    'and server restarts. Works for static sites/SPAs and node/python server apps. Use it once the app is ' +
    'built and verified — this is how the user gets a finished, live result without doing anything technical.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'A short name for the app (used in the public URL slug).' },
    },
  },
  modes: ['code'],
  summarize: (a) => `publish ${String(a.name ?? 'app')}`,
  async run(args, ctx) {
    try {
      const dep = await publishSession(ctx.session.id, args.name ? String(args.name) : undefined);
      if (dep.status === 'error') {
        return `Snapshotted to ${dep.url}, but the server app didn't start — verify it boots with its start command, then republish.`;
      }
      return `Published live at ${dep.url} (${dep.kind}). The user can open it now; it stays up across sessions and server restarts.`;
    } catch (e: any) {
      return `Error: publish failed — ${e?.message ?? e}`;
    }
  },
};
