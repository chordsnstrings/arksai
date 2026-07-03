// Product catalog. Reading is PUBLIC (a storefront can browse without an account);
// creating/editing requires a signed-in user (per-route requireAuth).
import { Router } from 'express';
import { nanoid } from 'nanoid';
import { db } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const r = Router();
const shape = (p) => ({
  id: p.id, name: p.name, description: p.description, category: p.category,
  priceCents: p.price_cents, imageUrl: p.image_url, active: !!p.active, createdAt: p.created_at,
});

// Public: browse active products; optional ?q= search and ?category= filter.
r.get('/', (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const cat = String(req.query.category || '').trim();
  let rows = db.prepare('SELECT * FROM products WHERE active = 1 ORDER BY created_at DESC LIMIT 500').all();
  if (cat) rows = rows.filter((p) => p.category === cat);
  if (q) rows = rows.filter((p) => `${p.name} ${p.description} ${p.category}`.toLowerCase().includes(q));
  res.json(rows.map(shape));
});

// Signed-in: the full list including inactive (the management view).
r.get('/all', requireAuth, (_req, res) => {
  res.json(db.prepare('SELECT * FROM products ORDER BY created_at DESC LIMIT 500').all().map(shape));
});

r.get('/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'not_found' });
  res.json(shape(p));
});

r.post('/', requireAuth, (req, res) => {
  const { name, description, category, priceCents, imageUrl } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name is required' });
  const price = Math.round(Number(priceCents));
  if (!Number.isFinite(price) || price < 0) return res.status(400).json({ error: 'priceCents must be a non-negative integer' });
  const p = {
    id: 'p_' + nanoid(12), name: String(name).trim().slice(0, 140),
    description: String(description || '').slice(0, 2000), category: String(category || '').trim().slice(0, 60),
    price_cents: price, image_url: String(imageUrl || '').slice(0, 500), active: 1, created_at: Date.now(),
  };
  db.prepare('INSERT INTO products (id, name, description, category, price_cents, image_url, active, created_at) VALUES (@id, @name, @description, @category, @price_cents, @image_url, @active, @created_at)').run(p);
  res.json(shape(p));
});

r.patch('/:id', requireAuth, (req, res) => {
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'not_found' });
  const b = req.body || {};
  const price = b.priceCents !== undefined ? Math.round(Number(b.priceCents)) : p.price_cents;
  if (!Number.isFinite(price) || price < 0) return res.status(400).json({ error: 'priceCents must be a non-negative integer' });
  const next = {
    name: b.name !== undefined ? String(b.name).trim().slice(0, 140) : p.name,
    description: b.description !== undefined ? String(b.description).slice(0, 2000) : p.description,
    category: b.category !== undefined ? String(b.category).trim().slice(0, 60) : p.category,
    price_cents: price,
    image_url: b.imageUrl !== undefined ? String(b.imageUrl).slice(0, 500) : p.image_url,
    active: b.active !== undefined ? (b.active ? 1 : 0) : p.active,
  };
  if (!next.name) return res.status(400).json({ error: 'name is required' });
  db.prepare('UPDATE products SET name=@name, description=@description, category=@category, price_cents=@price_cents, image_url=@image_url, active=@active WHERE id=@id').run({ ...next, id: p.id });
  res.json(shape({ ...p, ...next }));
});

r.delete('/:id', requireAuth, (req, res) => {
  const done = db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  if (!done.changes) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
});

export default r;
