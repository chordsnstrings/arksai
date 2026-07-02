// SSE-first live updates: proxy-safe (plain HTTP streaming — WebSocket upgrade through the
// /apps/<slug>/ path proxy is not guaranteed). publish() fans out to every connected client;
// the client hook (lib/live.js) reconnects automatically. Swap transports later without
// touching app code — everything goes through publish()/useLive().
import { Router } from 'express';

const r = Router();
const clients = new Set();

export function publish(event, data) {
  const line = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) { try { res.write(line); } catch {} }
}

r.get('/events', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.write('event: hello\ndata: {"ok":true}\n\n');
  clients.add(res);
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 25000);
  req.on('close', () => { clearInterval(ping); clients.delete(res); });
});

export default r;
