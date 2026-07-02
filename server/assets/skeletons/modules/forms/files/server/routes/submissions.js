import { Router } from 'express';
import { db } from '../db.js';

const r = Router();
r.get('/', (_req, res) => {
  const rows = db.prepare('SELECT * FROM submissions ORDER BY created_at DESC LIMIT 200').all();
  res.json(rows.map((x) => ({ id: x.id, name: x.name, email: x.email, message: x.message, createdAt: x.created_at })));
});
export default r;
