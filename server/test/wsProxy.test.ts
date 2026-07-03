import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import { attachWsUpgradeProxy } from '../src/deploy/wsProxy';

// The Phase-4 upgrade-forwarding test SCAFFOLD_PLAN demanded before WS is unflagged:
// a real WebSocket HANDSHAKE (101 + correct Sec-WebSocket-Accept) must round-trip
// through the /apps/<slug>/ front door to the app's local port. After the 101 the
// proxy is plain socket piping, so the handshake IS the load-bearing part.

const WS_MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function wsEchoUpstream(): Promise<{ server: net.Server; port: number }> {
  return new Promise((resolve) => {
    const server = net.createServer((sock) => {
      let buf = '';
      sock.on('data', (d) => {
        buf += d.toString('latin1');
        const end = buf.indexOf('\r\n\r\n');
        if (end === -1) return;
        const head = buf.slice(0, end);
        const key = /sec-websocket-key:\s*(\S+)/i.exec(head)?.[1] || '';
        const accept = crypto.createHash('sha1').update(key + WS_MAGIC).digest('base64');
        sock.write(
          'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
            `Sec-WebSocket-Accept: ${accept}\r\nX-Saw-Path: ${head.split(' ')[1]}\r\n\r\n`,
        );
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as net.AddressInfo).port }));
  });
}

test('WS upgrade forwarding: 101 handshake round-trips through /apps/<slug>/, prefix stripped', async () => {
  const upstream = await wsEchoUpstream();
  const front = http.createServer((_req, res) => res.end('http ok'));
  attachWsUpgradeProxy(front, (slug) => (slug === 'chatapp' ? upstream.port : null));
  await new Promise<void>((r) => front.listen(0, '127.0.0.1', () => r()));
  const frontPort = (front.address() as net.AddressInfo).port;

  const handshake = (path: string): Promise<string> =>
    new Promise((resolve, reject) => {
      const sock = net.connect(frontPort, '127.0.0.1', () => {
        sock.write(
          `GET ${path} HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
            'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n',
        );
      });
      let out = '';
      sock.on('data', (d) => {
        out += d.toString('latin1');
        if (out.includes('\r\n\r\n')) { sock.destroy(); resolve(out); }
      });
      sock.on('error', reject);
      sock.on('close', () => resolve(out));
      setTimeout(() => { sock.destroy(); resolve(out); }, 3000);
    });

  try {
    const ok = await handshake('/apps/chatapp/live/socket');
    assert.match(ok, /HTTP\/1\.1 101/);
    assert.match(ok, /Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK\+xOo=/); // RFC 6455 sample key
    assert.match(ok, /X-Saw-Path: \/live\/socket/); // the /apps/<slug> prefix was stripped

    const missing = await handshake('/apps/nope/ws');
    assert.match(missing, /404/); // unknown slug answers cleanly, never hangs
  } finally {
    front.close();
    upstream.server.close();
  }
});
