// Order management (signed-in): list, detail, and the fulfillment status flow.
import { Router } from 'express';
import { db } from '../db.js';

const r = Router();
const FLOW = ['new', 'confirmed', 'fulfilled', 'cancelled'];
const shape = (o) => ({ id: o.id, name: o.name, email: o.email, note: o.note, status: o.status, totalCents: o.total_cents, createdAt: o.created_at });
const itemShape = (i) => ({ id: i.id, productId: i.product_id, name: i.name, priceCents: i.price_cents, qty: i.qty });

r.get('/', (_req, res) => {
  res.json(db.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 500').all().map(shape));
});

r.get('/:id', (req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!o) return res.status(404).json({ error: 'not_found' });
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(o.id);
  res.json({ ...shape(o), items: items.map(itemShape) });
});

r.patch('/:id', (req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!o) return res.status(404).json({ error: 'not_found' });
  const status = String(req.body?.status || '');
  if (!FLOW.includes(status)) return res.status(400).json({ error: `status must be one of ${FLOW.join(', ')}` });
  db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, o.id);
  res.json(shape({ ...o, status }));
});

export default r;
