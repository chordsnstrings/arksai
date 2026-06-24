import { inspectUi } from '../inspect';
import { detectRenderable, startPreviewServer } from '../canvasExport';
import { listeningPorts } from '../../lib/ports';
import type { ToolDef } from './common';

/**
 * Diagnose a complaint about the built web app by actually RENDERING + INTERACTING with it —
 * the developer's loop, given to a text-only agent. Far better than guessing from code.
 */
export const inspectUiTool: ToolDef = {
  name: 'inspect_ui',
  description:
    'Diagnose ANY complaint about the built web app by opening it in a REAL browser (desktop + mobile), ' +
    'LOOKING at it, CLICKING the controls, and reading the DOM/console/network — so you find the CAUSE, not ' +
    'just the symptom. Returns: a vision description of the page at desktop and 390px mobile, uncaught JS errors, ' +
    'broken requests (404 assets/links/APIs), mobile horizontal overflow, the result of clicking each ' +
    'button/toggle (did it DO anything, or is it dead?), and — when you pass `focus` — the exact computed ' +
    'state of the element the user mentioned (is it hidden? what colour on what background? what size?). ' +
    'USE THIS the moment the user says something "looks wrong", "is broken", or "doesn\'t work" — BEFORE editing ' +
    '(never guess blind), and AGAIN after your fix to VERIFY it actually worked. Pass the user\'s own words as `focus`.',
  parameters: {
    type: 'object',
    properties: {
      focus: {
        type: 'string',
        description: "What the user is complaining about, in their words (e.g. \"mobile menu doesn't open\", \"the Book Now button does nothing\", \"pricing cards overflow\"). Targets which control to click + which element to inspect.",
      },
      path: { type: 'string', description: 'Which page to inspect (e.g. "pricing.html" or "/about"). Default: the home page.' },
    },
  },
  modes: ['code'],
  summarize: (a) => (a?.focus ? `inspect: ${String(a.focus).slice(0, 44)}` : 'inspect the UI'),
  async run(args, ctx) {
    const dir = ctx.repoDir;
    const r = detectRenderable(dir);
    if (!r.renderable) {
      return 'inspect_ui: no runnable web app or static site (index.html) was found in the workspace to inspect. Build the app first.';
    }

    // Boot a fresh preview server (static → python file server; app → its start command on PORT 4000).
    const wantedPort = startPreviewServer(ctx.session.id, dir, r);
    if (!wantedPort) return 'inspect_ui: could not start a server to render the app. Make sure it builds/runs.';

    // Wait for it to actually listen (apps need a moment to boot).
    let port: number | null = null;
    const deadline = Date.now() + 22_000;
    while (Date.now() < deadline && !ctx.signal.aborted) {
      await new Promise((res) => setTimeout(res, 600));
      const live = listeningPorts();
      if (live.includes(wantedPort)) {
        port = wantedPort;
        break;
      }
    }
    if (!port) {
      return `inspect_ui: the app didn't open a port within 22s — it may have crashed on startup. Check the start command / build, then try again.`;
    }

    const rel = String(args.path ?? '').replace(/^\/+/, '');
    const url = `http://127.0.0.1:${port}/${rel}`;
    const focus = typeof args.focus === 'string' ? args.focus : '';
    const res = await inspectUi(url, ctx.signal, { focus });
    if (!res.ran) return `inspect_ui: ${res.detail}`;
    return (
      res.detail +
      `\n\n(Inspected the LIVE rendered app — act on THIS evidence, not a guess. After you change the code, call inspect_ui again to confirm the issue is actually gone.)`
    );
  },
};
