import { publishSession } from '../../deploy/publish';
import { config } from '../../config';
import type { ToolDef } from './common';

/** Turn the deployment's stored path (e.g. "/apps/foo/") into the absolute URL the user opens.
 *  When appsSubdomainBase is configured (and DNS/TLS are live), advertise the clean subdomain.
 *  Pure + unit-tested. */
export function buildPublicUrl(depUrl: string, opts: { publicBaseUrl: string; appsSubdomainBase: string }): string {
  if (/^https?:\/\//i.test(depUrl)) return depUrl;
  const m = /^\/apps\/([^/]+)\/?/.exec(depUrl);
  if (m && opts.appsSubdomainBase) return `https://${m[1]}.${opts.appsSubdomainBase}/`;
  return `${opts.publicBaseUrl}${depUrl}`;
}

const liveUrl = (depUrl: string): string =>
  buildPublicUrl(depUrl, { publicBaseUrl: config.publicBaseUrl, appsSubdomainBase: config.appsSubdomainBase });

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
      const url = liveUrl(dep.url);
      if (dep.status === 'error') {
        // Fix-explaining failure text (modelled on build_apk's): even with no verify detail the
        // model gets a concrete diagnosis path instead of a bare "diagnose and fix".
        const why = dep.verifyDetail
          ? `\n\nWhat the live check saw:\n${dep.verifyDetail}`
          : `\n\nNo verify detail was captured, so diagnose in this order (most common causes first): ` +
            `(1) fetch the live URL yourself and read the response — a 404 usually means the entry point is missing ` +
            `(a static site MUST have a root index.html; a server app MUST serve "/") ; (2) a server app that works ` +
            `locally but 502s live usually isn't listening on process.env.PORT, or its start script is missing/wrong ` +
            `in package.json; (3) blank page but 200 → open the browser console via the verify gate — a root-absolute ` +
            `asset path ("/app.js") breaks under /apps/<slug>/ (use relative paths); (4) an API app returning HTML → ` +
            `route order (API routes must register before the SPA fallback).`;
        return (
          `Published to ${url}, but the LIVE app FAILED verification — do NOT give this URL to the user yet. ` +
          `Fix the issue with a targeted edit, then call publish_app again to republish.${why}`
        );
      }
      const verified = dep.verifyDetail ? ` ${dep.verifyDetail}` : '';
      return (
        `Published live at ${url} (${dep.kind}).${verified} Give the user this EXACT url, verbatim — copy it ` +
        `character-for-character; do NOT shorten it, drop the "/apps/…/" path, or invent a subdomain (a made-up ` +
        `host like "<name>.arksai.studio" will NOT work). Share this link with anyone — no login needed to view. ` +
        `It's a 24-HOUR PREVIEW that auto-deletes after 24h; re-publish to refresh it. Mention the 24-hour window.`
      );
    } catch (e: any) {
      return `Error: publish failed — ${e?.message ?? e}`;
    }
  },
};
