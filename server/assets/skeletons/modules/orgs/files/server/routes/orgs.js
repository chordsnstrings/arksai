import { Router } from 'express';
import { nanoid } from 'nanoid';
import { db } from '../db.js';
import { withOrg } from '../middleware/withOrg.js';

const r = Router();
const slugify = (s) => String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'org';

/** My orgs. */
r.get('/', (req, res) => {
  const rows = db.prepare(
    'SELECT o.id, o.slug, o.name, m.role FROM orgs o JOIN memberships m ON m.org_id = o.id WHERE m.user_id = ? ORDER BY o.created_at',
  ).all(req.user.id);
  res.json(rows.map((x) => ({ id: x.id, slug: x.slug, name: x.name, role: x.role })));
});

/** Create an org (creator becomes owner; an invite code is minted). */
r.post('/', (req, res) => {
  const { name } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name is required' });
  let slug = slugify(name);
  if (db.prepare('SELECT 1 FROM orgs WHERE slug = ?').get(slug)) slug = `${slug}-${nanoid(4).toLowerCase()}`;
  const org = { id: 'o_' + nanoid(12), slug, name: String(name).trim(), created_at: Date.now() };
  db.prepare('INSERT INTO orgs (id, slug, name, created_at) VALUES (@id, @slug, @name, @created_at)').run(org);
  db.prepare('INSERT INTO memberships (org_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)').run(org.id, req.user.id, 'owner', Date.now());
  db.prepare('INSERT INTO invites (code, org_id, uses_left, created_at) VALUES (?, ?, ?, ?)').run('INV-' + nanoid(8).toUpperCase(), org.id, 25, Date.now());
  res.json({ id: org.id, slug: org.slug, name: org.name, role: 'owner' });
});

/** Join with an invite code (top-level — you can't be a member yet, so no withOrg gate). */
r.post('/join', (req, res) => {
  const { code } = req.body || {};
  const inv = db.prepare('SELECT * FROM invites WHERE code = ?').get(String(code || '').trim().toUpperCase());
  if (!inv || inv.uses_left <= 0) return res.status(404).json({ error: 'invalid or exhausted invite code' });
  const org = db.prepare('SELECT * FROM orgs WHERE id = ?').get(inv.org_id);
  if (db.prepare('SELECT 1 FROM memberships WHERE org_id = ? AND user_id = ?').get(org.id, req.user.id))
    return res.json({ id: org.id, slug: org.slug, name: org.name, role: 'member' });
  db.prepare('INSERT INTO memberships (org_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)').run(org.id, req.user.id, 'member', Date.now());
  db.prepare('UPDATE invites SET uses_left = uses_left - 1 WHERE code = ?').run(inv.code);
  res.json({ id: org.id, slug: org.slug, name: org.name, role: 'member' });
});

/** Org detail + invite (members only; invite code owner/admin only). */
r.get('/:slug', withOrg, (req, res) => {
  const out = { id: req.org.id, slug: req.org.slug, name: req.org.name, role: req.orgRole };
  if (['owner', 'admin'].includes(req.orgRole)) {
    const inv = db.prepare('SELECT code, uses_left FROM invites WHERE org_id = ? ORDER BY created_at DESC').get(req.org.id);
    if (inv) out.invite = { code: inv.code, usesLeft: inv.uses_left };
  }
  res.json(out);
});

export default r;
