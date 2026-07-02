import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import { db } from '../db.js';
import { signToken } from '../lib/auth.js';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../lib/rateLimit.js';

const r = Router();
const COLORS = ['#e8b059', '#7c9cd9', '#5fb98a', '#d97c9c', '#9c7cd9', '#d9a67c'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const shape = (u) => ({ id: u.id, email: u.email, name: u.name, avatarColor: u.avatar_color });
// Credential endpoints are rate-limited (brute-force protection).
const limiter = rateLimit({ windowMs: 60_000, max: 20 });

r.post('/signup', limiter, (req, res) => {
  const { email, password, name } = req.body || {};
  if (!email || !password || !name) return res.status(400).json({ error: 'email, password and name are required' });
  if (!EMAIL_RE.test(String(email))) return res.status(400).json({ error: 'enter a valid email address' });
  if (String(password).length < 6) return res.status(400).json({ error: 'password must be at least 6 characters' });
  if (String(name).trim().length > 80) return res.status(400).json({ error: 'name is too long' });
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(String(email).toLowerCase()))
    return res.status(409).json({ error: 'an account with that email already exists' });
  const user = {
    id: 'u_' + nanoid(12),
    email: String(email).toLowerCase(),
    name: String(name).trim(),
    password_hash: bcrypt.hashSync(String(password), 10),
    avatar_color: COLORS[Math.floor(Math.random() * COLORS.length)],
    created_at: Date.now(),
  };
  db.prepare('INSERT INTO users (id, email, name, password_hash, avatar_color, created_at) VALUES (@id, @email, @name, @password_hash, @avatar_color, @created_at)').run(user);
  res.json({ token: signToken(user.id), user: shape(user) });
});

r.post('/login', limiter, (req, res) => {
  const { email, password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').toLowerCase());
  if (!u || !bcrypt.compareSync(String(password || ''), u.password_hash))
    return res.status(401).json({ error: 'invalid email or password' });
  res.json({ token: signToken(u.id), user: shape(u) });
});

r.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));

// Update the signed-in user's profile (name).
r.patch('/me', requireAuth, (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  if (!name) return res.status(400).json({ error: 'name is required' });
  if (name.length > 80) return res.status(400).json({ error: 'name is too long' });
  db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, req.user.id);
  res.json({ user: { ...req.user, name } });
});

// Change password (verifies the current one). The seeded demo account is shared with everyone
// who tries the app (and the quality gate signs in with it), so its password is fixed.
r.post('/password', requireAuth, limiter, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (String(req.user.email).startsWith('demo@'))
    return res.status(400).json({ error: 'the shared demo account’s password can’t be changed' });
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'current and new password are required' });
  if (String(newPassword).length < 6) return res.status(400).json({ error: 'new password must be at least 6 characters' });
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!u || !bcrypt.compareSync(String(currentPassword), u.password_hash))
    return res.status(401).json({ error: 'current password is incorrect' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(String(newPassword), 10), u.id);
  res.json({ ok: true });
});

export default r;
