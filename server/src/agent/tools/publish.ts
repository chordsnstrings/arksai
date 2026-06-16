import { publishSession } from '../../deploy/publish';
import type { ToolDef } from './common';

/**
 * Publish the built app to a durable public URL the (non-technical) user can
 * actually open and use — the "it's actually live" half of the promise.
 */
export const publishAppTool: ToolDef = {
  name: 'publish_app',
  description:
    'Publish the current app to a public URL the user can open AND SHARE with anyone (no login needed to view). ' +
    'This is a 24-HOUR PREVIEW: the link auto-deletes 24h after publishing (re-publish to refresh it). Works for ' +
    'static sites/SPAs and node/python server apps. Use it once the app is built and verified — this is how the ' +
    'user gets a finished, live, shareable result without doing anything technical. Tell them it stays live for 24 hours.',
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
        const why = dep.verifyDetail ? `\n\n${dep.verifyDetail}` : '';
        return (
          `Published to ${dep.url}, but the LIVE app FAILED verification — do NOT give this URL to the user yet. ` +
          `Diagnose and fix the issue, then call publish_app again to republish.${why}`
        );
      }
      const verified = dep.verifyDetail ? ` ${dep.verifyDetail}` : '';
      return `Published live at ${dep.url} (${dep.kind}).${verified} Share this link with anyone — no login needed to view. It's a 24-HOUR PREVIEW that auto-deletes after 24h; re-publish to refresh it. Give the user the URL and mention the 24-hour window.`;
    } catch (e: any) {
      return `Error: publish failed — ${e?.message ?? e}`;
    }
  },
};
