// PUBLIC checkout — records a validated order with server-computed totals (prices are
// NEVER trusted from the client). Payment collection is a deliberate seam: orders land as
// status "new" and the business confirms them (pay on invoice/delivery/pickup — a real
// production pattern). To take card payments at checkout, verify a payment-provider
// session here (e.g. a Stripe Checkout webhook) and mark the order "paid" — everything
// else (cart, totals, order records, fulfillment) is already complete.
import { Router } from 'express';
import { nanoid } from 'nanoid';
import { db } from '../db.js';
import { rateLimit } from '../lib/rateLimit.js';

const r = Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

r.post('/', rateLimit({ windowMs: 60_000, max: 30 }), (req, res) => {
  const { name, email, note, items } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name is required' });
  if (!EMAIL_RE.test(String(email || ''))) return res.status(400).json({ error: 'a valid email is required' });
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'the cart is empty' });
  if (items.length > 100) return res.status(400).json({ error: 'too many items' });

  const lines = [];
  for (const it of items) {
    const qty = Math.round(Number(it?.qty));
    if (!Number.isFinite(qty) || qty < 1 || qty > 999) return res.status(400).json({ error: 'each item needs a quantity between 1 and 999' });
    const p = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(String(it?.productId || ''));
    if (!p) return res.status(400).json({ error: 'an item in the cart is no longer available — refresh and try again' });
    lines.push({ product: p, qty });
  }
  const total = lines.reduce((s, l) => s + l.product.price_cents * l.qty, 0);

  const orderId = 'o_' + nanoid(12);
  const insOrder = db.prepare('INSERT INTO orders (id, name, email, note, status, total_cents, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const insItem = db.prepare('INSERT INTO order_items (id, order_id, product_id, name, price_cents, qty) VALUES (?, ?, ?, ?, ?, ?)');
  const tx = db.transaction(() => {
    insOrder.run(orderId, String(name).trim().slice(0, 120), String(email).trim().toLowerCase().slice(0, 200), String(note || '').slice(0, 1000), 'new', total, Date.now());
    for (const l of lines) insItem.run('oi_' + nanoid(12), orderId, l.product.id, l.product.name, l.product.price_cents, l.qty);
  });
  tx();
  res.json({ orderId, totalCents: total, status: 'new' });
});

export default r;
