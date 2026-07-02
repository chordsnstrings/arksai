// EXEMPLAR RESOURCE — clone this file (and its migration, seed, and page) for each real
// domain entity, renaming "item(s)" throughout. Conventions it demonstrates: flat camelCase
// responses, { error } envelope, ownership scoping, validation before writes.
import { Router } from 'express';
import { nanoid } from 'nanoid';
import { db } from '../db.js';

const r = Router();
const shape = (x) => ({ id: x.id, title: x.title, notes: x.notes, status: x.status, createdAt: x.created_at });

r.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM items WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
  res.json(rows.map(shape));
});

r.post('/', (req, res) => {
  const { title, notes } = req.body || {};
  if (!title || !String(title).trim()) return res.status(400).json({ error: 'title is required' });
  const item = { id: 'i_' + nanoid(12), user_id: req.user.id, title: String(title).trim(), notes: String(notes || ''), status: 'open', created_at: Date.now() };
  db.prepare('INSERT INTO items (id, user_id, title, notes, status, created_at) VALUES (@id, @user_id, @title, @notes, @status, @created_at)').run(item);
  res.json(shape(item));
});

r.patch('/:id', (req, res) => {
  const item = db.prepare('SELECT * FROM items WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!item) return res.status(404).json({ error: 'not_found' });
  const { title, notes, status } = req.body || {};
  const next = {
    title: title !== undefined ? String(title).trim() : item.title,
    notes: notes !== undefined ? String(notes) : item.notes,
    status: status !== undefined && ['open', 'done'].includes(status) ? status : item.status,
  };
  db.prepare('UPDATE items SET title = ?, notes = ?, status = ? WHERE id = ?').run(next.title, next.notes, next.status, item.id);
  res.json(shape({ ...item, ...next }));
});

r.delete('/:id', (req, res) => {
  const done = db.prepare('DELETE FROM items WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  if (!done.changes) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
});

export default r;
