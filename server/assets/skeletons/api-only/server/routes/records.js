// EXEMPLAR key-authed resource — clone + rename per real entity.
import { Router } from 'express';
import { nanoid } from 'nanoid';
import { db } from '../db.js';

const r = Router();
const shape = (x) => ({ id: x.id, name: x.name, payload: safeJson(x.payload), createdAt: x.created_at });
const safeJson = (s) => { try { return JSON.parse(s); } catch { return s; } };

r.get('/', (_req, res) => {
  res.json(db.prepare('SELECT * FROM records ORDER BY created_at DESC LIMIT 500').all().map(shape));
});

r.post('/', (req, res) => {
  const { name, payload } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name is required' });
  const x = { id: 'r_' + nanoid(12), name: String(name).trim().slice(0, 200), payload: JSON.stringify(payload ?? {}), created_at: Date.now() };
  db.prepare('INSERT INTO records (id, name, payload, created_at) VALUES (@id, @name, @payload, @created_at)').run(x);
  res.status(201).json(shape(x));
});

r.get('/:id', (req, res) => {
  const x = db.prepare('SELECT * FROM records WHERE id = ?').get(req.params.id);
  if (!x) return res.status(404).json({ error: 'not_found' });
  res.json(shape(x));
});

r.delete('/:id', (req, res) => {
  const done = db.prepare('DELETE FROM records WHERE id = ?').run(req.params.id);
  if (!done.changes) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
});

export default r;
