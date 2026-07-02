// Aggregation pattern: counts computed in SQL, flat camelCase out. Extend per real entities.
import { Router } from 'express';
import { db } from '../db.js';

const r = Router();
r.get('/', (req, res) => {
  const total = db.prepare('SELECT COUNT(*) c FROM items WHERE user_id = ?').get(req.user.id).c;
  const done = db.prepare("SELECT COUNT(*) c FROM items WHERE user_id = ? AND status = 'done'").get(req.user.id).c;
  res.json({ total, done, open: total - done, donePct: total ? Math.round((done / total) * 100) : 0 });
});
export default r;
