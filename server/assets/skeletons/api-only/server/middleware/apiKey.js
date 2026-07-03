// API-key auth for machine clients: X-API-Key header (or Bearer). Keys live in the
// api_keys table — created at seed and via POST /api/keys (which itself needs a key).
import { db } from '../db.js';

export function requireApiKey(req, res, next) {
  const raw = req.get('x-api-key') || (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const key = raw && db.prepare('SELECT * FROM api_keys WHERE key = ? AND revoked = 0').get(raw);
  if (!key) return res.status(401).json({ error: 'a valid API key is required (X-API-Key header)' });
  req.apiKey = { id: key.id, name: key.name };
  next();
}
