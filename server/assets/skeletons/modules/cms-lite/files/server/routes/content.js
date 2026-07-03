// PUBLIC content read API — published posts only. A public site/blog reads from here.
import { Router } from 'express';
import { db } from '../db.js';

const r = Router();
const card = (p) => ({ id: p.id, slug: p.slug, title: p.title, excerpt: p.excerpt, updatedAt: p.updated_at });

r.get('/', (_req, res) => {
  res.json(db.prepare('SELECT * FROM posts WHERE published = 1 ORDER BY updated_at DESC LIMIT 200').all().map(card));
});

r.get('/:slug', (req, res) => {
  const p = db.prepare('SELECT * FROM posts WHERE slug = ? AND published = 1').get(String(req.params.slug));
  if (!p) return res.status(404).json({ error: 'not_found' });
  res.json({ ...card(p), bodyMd: p.body_md });
});

export default r;
