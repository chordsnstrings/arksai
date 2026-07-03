import type http from 'node:http';
import net from 'node:net';

/**
 * WebSocket upgrade forwarding for published apps (SCAFFOLD_PLAN Phase 4).
 *
 * The /apps/<slug>/ reverse proxy is fetch-based, and fetch cannot carry an HTTP UPGRADE —
 * so a published app's WebSocket used to die at the front door (the client shim rewrote the
 * URL correctly, then the handshake 404'd). This attaches a raw 'upgrade' listener to the
 * HTTP server: it resolves the deployment's local port, replays the upgrade request head
 * with the /apps/<slug> prefix stripped (and Host rewritten), and pipes the sockets both
 * ways. Everything after the 101 is plain TCP piping, so frames flow untouched.
 *
 * Port resolution is injected so the unit tests run against a plain http server with a fake
 * resolver — no deployment store needed. SSE remains the DEFAULT transport in the realtime
 * module (proxy-safe everywhere); this makes real WS apps (chat, multiplayer, live cursors)
 * work at their published URL too.
 */
export function attachWsUpgradeProxy(
  server: http.Server,
  resolvePort: (slug: string) => number | null | Promise<number | null>,
): void {
  server.on('upgrade', async (req, socket, head) => {
    try {
      const m = (req.url || '').match(/^\/apps\/([a-z0-9][a-z0-9-]*)(\/[^ ]*)?$/);
      if (!m) {
        socket.destroy(); // not a published-app upgrade — nothing else serves WS here
        return;
      }
      const port = await resolvePort(m[1]);
      if (!port) {
        socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
        return;
      }
      const rest = m[2] || '/';
      const upstream = net.connect(port, '127.0.0.1', () => {
        let raw = `${req.method} ${rest} HTTP/1.1\r\n`;
        for (let i = 0; i < req.rawHeaders.length; i += 2) {
          const k = req.rawHeaders[i];
          const v = /^host$/i.test(k) ? `127.0.0.1:${port}` : req.rawHeaders[i + 1];
          raw += `${k}: ${v}\r\n`;
        }
        raw += '\r\n';
        upstream.write(raw);
        if (head?.length) upstream.write(head);
        upstream.pipe(socket);
        socket.pipe(upstream);
      });
      upstream.on('error', () => socket.destroy());
      socket.on('error', () => upstream.destroy());
      upstream.setTimeout(0);
      if (socket instanceof net.Socket) socket.setTimeout(0);
    } catch {
      try { socket.destroy(); } catch {}
    }
  });
}
