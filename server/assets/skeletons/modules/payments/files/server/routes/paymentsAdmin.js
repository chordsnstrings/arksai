// Owner settings (signed-in): paste provider keys, see configured state. WRITE-ONLY —
// secrets are never returned over the API, only booleans + key tails for recognition.
import { Router } from 'express';
import { db } from '../db.js';
import { getSettings, saveSettings, providersConfigured } from '../lib/payments.js';

const r = Router();

r.get('/settings', (_req, res) => {
  const s = getSettings();
  const tail = (v) => (v ? `…${String(v).slice(-4)}` : '');
  res.json({
    ...providersConfigured(),
    stripeKeyTail: tail(s.stripeSecretKey),
    paypalClientTail: tail(s.paypalClientId),
    paypalLive: s.paypalLive,
  });
});

r.put('/settings', (req, res) => {
  const b = req.body || {};
  const clean = (v) => (v === undefined ? undefined : String(v).trim().slice(0, 300));
  saveSettings({
    stripeSecretKey: clean(b.stripeSecretKey),
    paypalClientId: clean(b.paypalClientId),
    paypalSecret: clean(b.paypalSecret),
    paypalLive: b.paypalLive,
  });
  res.json({ ok: true, ...providersConfigured() });
});

// Payment history for the owner (order + provider + status).
r.get('/history', (_req, res) => {
  const rows = db.prepare('SELECT p.*, o.email AS buyer_email FROM payments p LEFT JOIN orders o ON o.id = p.order_id ORDER BY p.created_at DESC LIMIT 200').all();
  res.json(rows.map((p) => ({ id: p.id, orderId: p.order_id, provider: p.provider, status: p.status, amountCents: p.amount_cents, buyerEmail: p.buyer_email, createdAt: p.created_at })));
});

export default r;
