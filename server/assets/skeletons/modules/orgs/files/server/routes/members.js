// Org-scoped router — Router({ mergeParams: true }) is REQUIRED (see withOrg.js).
import { Router } from 'express';
import { db } from '../db.js';

const r = Router({ mergeParams: true });
r.get('/', (req, res) => {
  const rows = db.prepare(
    'SELECT u.id, u.name, u.email, u.avatar_color, m.role, m.joined_at FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.org_id = ? ORDER BY m.joined_at',
  ).all(req.org.id);
  res.json(rows.map((x) => ({ id: x.id, name: x.name, email: x.email, avatarColor: x.avatar_color, role: x.role, joinedAt: x.joined_at })));
});
export default r;
