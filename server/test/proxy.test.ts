import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { proxyFetch } from '../src/lib/proxy';

/** Minimal fake of the FastifyRequest fields proxyFetch reads. */
function fakeReq(method = 'GET', body?: any): any {
  return { method, body };
}

async function listen(handler: http.RequestListener): Promise<{ port: number; close: () => void }> {
  const server = http.createServer(handler);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return { port, close: () => server.close() };
}

test('proxyFetch: returns buffered body + forwarded headers on a clean response', async () => {
  const s = await listen((_req, res) => {
    res.setHeader('content-type', 'text/html');
    res.setHeader('cache-control', 'no-store');
    res.end('<html>ok</html>');
  });
  try {
    const r = await proxyFetch(`http://127.0.0.1:${s.port}/`, fakeReq());
    assert.ok(r);
    assert.equal(r!.status, 200);
    assert.equal(r!.contentType.includes('text/html'), true);
    assert.equal(r!.headers['cache-control'], 'no-store');
    assert.equal(r!.body.toString('utf8'), '<html>ok</html>');
  } finally {
    s.close();
  }
});

test('proxyFetch: a server that destroys the socket mid-body → clean null (no throw)', async () => {
  // Declares a large Content-Length then destroys the socket → premature close.
  const s = await listen((_req, res) => {
    res.setHeader('content-type', 'text/plain');
    res.setHeader('content-length', '1000');
    res.write('partial');
    res.socket?.destroy(); // abort before the declared length is sent
  });
  try {
    const r = await proxyFetch(`http://127.0.0.1:${s.port}/`, fakeReq(), 5000);
    // It must NOT throw ERR_STREAM_PREMATURE_CLOSE up the stack; it returns null
    // so the route can answer with a clean 502.
    assert.equal(r, null);
  } finally {
    s.close();
  }
});

test('proxyFetch: unreachable upstream → null (caller sends 502)', async () => {
  // Nothing is listening on this port.
  const r = await proxyFetch('http://127.0.0.1:1/', fakeReq(), 2000);
  assert.equal(r, null);
});

test('proxyFetch: forwards non-GET method to the upstream', async () => {
  let seen = '';
  const s = await listen((req, res) => {
    seen = req.method ?? '';
    res.setHeader('content-type', 'application/json');
    res.end('{"ok":true}');
  });
  try {
    const r = await proxyFetch(`http://127.0.0.1:${s.port}/`, fakeReq('POST', 'x=1'));
    assert.ok(r);
    assert.equal(seen, 'POST');
    assert.equal(r!.body.toString('utf8'), '{"ok":true}');
  } finally {
    s.close();
  }
});

test('proxyFetch: re-serializes a parsed JSON body + forwards content-type & authorization', async () => {
  let received: { body: string; ctype?: string; auth?: string } = { body: '' };
  const s = await listen((req, res) => {
    let buf = '';
    req.on('data', (c) => (buf += c));
    req.on('end', () => {
      received = { body: buf, ctype: req.headers['content-type'], auth: req.headers['authorization'] };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });
  });
  try {
    // Fastify hands proxyFetch a PARSED object body + headers — the bug was sending the
    // object straight to fetch ("[object Object]") and dropping content-type/authorization.
    const req: any = {
      method: 'POST',
      body: { email: 't@t.com', password: 'secret123' },
      headers: { 'content-type': 'application/json', authorization: 'Bearer abc.def.ghi' },
    };
    const r = await proxyFetch(`http://127.0.0.1:${s.port}/`, req);
    assert.ok(r);
    // The upstream received VALID JSON (re-serialized), not "[object Object]".
    assert.deepEqual(JSON.parse(received.body), { email: 't@t.com', password: 'secret123' });
    assert.match(received.ctype || '', /application\/json/);
    assert.equal(received.auth, 'Bearer abc.def.ghi'); // JWT forwarded
  } finally {
    s.close();
  }
});
