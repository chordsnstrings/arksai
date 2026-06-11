import type { FastifyReply, FastifyRequest } from 'fastify';

export interface SseChannel {
  send(data: unknown, id?: number): void;
  close(): void;
  onClose(fn: () => void): void;
}

const HEARTBEAT_MS = 15_000;

export function openSse(req: FastifyRequest, reply: FastifyReply): SseChannel {
  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': connected\n\n');

  const heartbeat = setInterval(() => {
    try {
      res.write(': hb\n\n');
    } catch {}
  }, HEARTBEAT_MS);

  const closeFns: (() => void)[] = [];
  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    for (const fn of closeFns) fn();
  };
  req.raw.on('close', cleanup);

  return {
    send(data, id) {
      if (closed) return;
      try {
        const idLine = id !== undefined ? `id: ${id}\n` : '';
        res.write(`${idLine}data: ${JSON.stringify(data)}\n\n`);
      } catch {}
    },
    close() {
      cleanup();
      try {
        res.end();
      } catch {}
    },
    onClose(fn) {
      closeFns.push(fn);
    },
  };
}

export function lastEventId(req: FastifyRequest): number {
  const raw = req.headers['last-event-id'];
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isFinite(n) ? n : 0;
}
