// PUBLIC intake endpoint (no auth) — server-side validation, stored to the submissions
// table (the in-app outbox). Delivery to email/webhook is an optional later wire-up; the
// flow is fully demonstrable with zero credentials.
import { Router } from 'express';
import { nanoid } from 'nanoid';
import { db } from '../db.js';

const r = Router();
r.post('/', (req, res) => {
  const { name, email, message } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name is required' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email || ''))) return res.status(400).json({ error: 'a valid email is required' });
  if (!message || String(message).trim().length < 3) return res.status(400).json({ error: 'message is required' });
  db.prepare('INSERT INTO submissions (id, name, email, message, created_at) VALUES (?, ?, ?, ?, ?)').run(
    's_' + nanoid(12), String(name).trim().slice(0, 120), String(email).trim().slice(0, 200), String(message).trim().slice(0, 4000), Date.now(),
  );
  res.json({ ok: true });
});
export default r;
