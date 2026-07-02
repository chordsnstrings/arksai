import { Router } from 'express';
import { db } from '../db.js';

const r = Router();
r.get('/', (_req, res) => {
  const rows = db.prepare('SELECT * FROM job_runs ORDER BY ran_at DESC LIMIT 50').all();
  res.json(rows.map((x) => ({ id: x.id, name: x.name, ok: !!x.ok, detail: x.detail, ranAt: x.ran_at, ms: x.ms })));
});
export default r;
