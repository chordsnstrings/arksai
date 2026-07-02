import { verifyToken } from '../lib/auth.js';
import { db } from '../db.js';

/** Bearer-token guard: sets req.user or 401s with the standard { error } envelope. */
export function requireAuth(req, res, next) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  const userId = m ? verifyToken(m[1]) : null;
  if (!userId) return res.status(401).json({ error: 'unauthorized' });
  const user = db.prepare('SELECT id, email, name, avatar_color FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(401).json({ error: 'unauthorized' });
  req.user = { id: user.id, email: user.email, name: user.name, avatarColor: user.avatar_color };
  next();
}
