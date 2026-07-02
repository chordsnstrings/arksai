import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import { db } from '../db.js';
import { signToken } from '../lib/auth.js';
import { requireAuth } from '../middleware/auth.js';

const r = Router();
const COLORS = ['#e8b059', '#7c9cd9', '#5fb98a', '#d97c9c', '#9c7cd9', '#d9a67c'];
const shape = (u) => ({ id: u.id, email: u.email, name: u.name, avatarColor: u.avatar_color });

r.post('/signup', (req, res) => {
  const { email, password, name } = req.body || {};
  if (!email || !password || !name) return res.status(400).json({ error: 'email, password and name are required' });
  if (String(password).length < 6) return res.status(400).json({ error: 'password must be at least 6 characters' });
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

r.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').toLowerCase());
  if (!u || !bcrypt.compareSync(String(password || ''), u.password_hash))
    return res.status(401).json({ error: 'invalid email or password' });
  res.json({ token: signToken(u.id), user: shape(u) });
});

r.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));

export default r;
