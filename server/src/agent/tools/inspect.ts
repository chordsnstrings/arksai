import { inspectUi } from '../inspect';
import { detectRenderable, startPreviewServer } from '../canvasExport';
import { listeningPorts } from '../../lib/ports';
import type { ToolDef } from './common';

// Per-session count of agent-initiated inspections — so a build can't whack-a-mole one
// hard element forever. The design GATE is bounded (MAX_DESIGN_ROUNDS); this bounds the
// agent's OWN inspect→fix→re-inspect loop (which was unbounded and drove a 400-step run).
const inspectCounts = new Map<string, number>();
const SOFT_CAP = 8; // a generous budget across the whole build before we start nudging
export function _resetInspectCount(sessionId: string) { inspectCounts.delete(sessionId); }

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

    // Run it; if the result is INCONCLUSIVE (a flaky/closed context — e.g. the preview
    // server dropped mid-inspection), reboot the server and retry ONCE so the round isn't wasted.
    let res = await inspectUi(url, ctx.signal, { focus });
    if (res.ran && /inconclusive|has been closed/i.test(res.detail) && !ctx.signal.aborted) {
      startPreviewServer(ctx.session.id, dir, r);
      await new Promise((r) => setTimeout(r, 1200));
      res = await inspectUi(url, ctx.signal, { focus });
    }
    if (!res.ran) return `inspect_ui: ${res.detail}`;

    // Bound the agent's own inspect loop: once it's looked many times, tell it to SHIP or
    // SIMPLIFY rather than keep re-inspecting a hard element — a clean simple version beats
    // a fragile elaborate one (the over-iteration we actually observed).
    const n = (inspectCounts.get(ctx.session.id) ?? 0) + 1;
    inspectCounts.set(ctx.session.id, n);
    const tail =
      n >= SOFT_CAP
        ? `\n\n⚠ You have inspected this build ${n} times. STOP re-inspecting now: the result is good enough to ship. ` +
          `If ONE element still isn't pixel-perfect, SIMPLIFY it (drop a rotation/overlap, use a robust ui-kit/craft.css ` +
          `component like .ticket/.board/.spec instead of a hand-built fragile one) rather than fight CSS another round — ` +
          `a clean simple version beats a fragile elaborate one. Then finish and publish; do not call inspect_ui again unless something is actually broken.`
        : `\n\n(Inspected the LIVE rendered app — act on THIS evidence, not a guess. After your fix, inspect ONCE more to confirm, ` +
          `then move on; don't re-inspect a minor nit repeatedly — if an element fights you, simplify it.)`;
    return res.detail + tail;
  },
};
