import bcrypt from 'bcryptjs';
import { db } from '../db.js';

// The demo account the quality gate signs in with — declared in .arksai/verify.json.
// NEVER remove it; the pre-delivery check depends on it.
export const DEMO = { email: 'demo@__APP_SLUG__.app', password: 'demo1234', name: 'Demo User' };

export function seed() {
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(DEMO.email)) return;
  db.prepare(
    'INSERT INTO users (id, email, name, password_hash, avatar_color, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run('u_demo00000001', DEMO.email, DEMO.name, bcrypt.hashSync(DEMO.password, 10), '#e8b059', Date.now());
}
