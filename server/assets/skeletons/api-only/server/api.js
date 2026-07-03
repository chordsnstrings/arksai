// Route mounting + the endpoint manifest that renders the docs page. When you add a
// router, add its endpoints here too — the front door must always tell the truth.
import { requireApiKey } from './middleware/apiKey.js';
import recordsRouter from './routes/records.js';

export const ENDPOINTS = [
  { method: 'GET', path: '/api/health', auth: false, desc: 'Liveness check → { ok: true }.' },
  { method: 'GET', path: '/api/records', auth: true, desc: 'List records (newest first).' },
  { method: 'POST', path: '/api/records', auth: true, desc: 'Create a record: { name, payload? } → 201.' },
  { method: 'GET', path: '/api/records/:id', auth: true, desc: 'Fetch one record.' },
  { method: 'DELETE', path: '/api/records/:id', auth: true, desc: 'Delete a record.' },
];

export function mountApi(app) {
  app.use('/api/records', requireApiKey, recordsRouter);
}
