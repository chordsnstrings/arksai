// THE tenancy boundary — every org-scoped router goes through this, and every org-scoped
// router MUST be created with Router({ mergeParams: true }) or :slug is invisible to it
// (the classic Express sub-router bug — a real shipped incident). The org id NEVER comes
// from the client as authority: JWT names the user, the URL names the org, and membership
// is verified here before any read or write.
import { db } from '../db.js';

export function withOrg(req, res, next) {
  const slug = req.params.slug;
  if (!slug) return res.status(400).json({ error: 'missing_slug' });
  const org = db.prepare('SELECT * FROM orgs WHERE slug = ?').get(slug);
  if (!org) return res.status(404).json({ error: 'not_found' });
  const member = db.prepare('SELECT role FROM memberships WHERE org_id = ? AND user_id = ?').get(org.id, req.user.id);
  if (!member) return res.status(404).json({ error: 'not_found' }); // 404, not 403 — don't leak org existence
  req.org = { id: org.id, slug: org.slug, name: org.name };
  req.orgRole = member.role;
  next();
}
