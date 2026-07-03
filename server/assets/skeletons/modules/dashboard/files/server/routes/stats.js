// Aggregation pattern: counts computed in SQL, flat camelCase out. When cloning the
// exemplar into real entities, extend this route with their aggregates (same shape).
import { Router } from 'express';
import { db } from '../db.js';

const r = Router();
r.get('/', (req, res) => {
  const total = db.prepare('SELECT COUNT(*) c FROM items WHERE user_id = ?').get(req.user.id).c;
  const done = db.prepare("SELECT COUNT(*) c FROM items WHERE user_id = ? AND status = 'done'").get(req.user.id).c;
  const recent = db
    .prepare('SELECT id, title, status, created_at FROM items WHERE user_id = ? ORDER BY created_at DESC LIMIT 5')
    .all(req.user.id)
    .map((x) => ({ id: x.id, title: x.title, status: x.status, createdAt: x.created_at }));
  res.json({ total, done, open: total - done, donePct: total ? Math.round((done / total) * 100) : 0, recent });
});
export default r;
