// API-only service: JSON endpoints + a self-documenting index page, ONE port
// (process.env.PORT, default 4000). INVARIANTS: /api/* before the fallback; JSON
// errors everywhere; data in data/; graceful shutdown.
import express from 'express';
import { initSchema } from './server/db.js';
import { mountApi, ENDPOINTS } from './server/api.js';
import { docsPage } from './server/docs.js';

initSchema();

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));
mountApi(app);
app.use('/api', (_req, res) => res.status(404).json({ error: 'not_found' }));

// The self-documenting index — the API's front door for a developer.
app.get('/', (_req, res) => res.type('html').send(docsPage(ENDPOINTS)));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(err);
  if (!res.headersSent) res.status(500).json({ error: 'something went wrong — please try again' });
});

const port = Number(process.env.PORT) || 4000;
const server = app.listen(port, () => console.log(`api listening on :${port}`));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close(() => process.exit(0)));
