// Single-service production server: the built React client AND the API on ONE port
// (process.env.PORT, default 4000) — the shape the ArksAI verifier and publisher boot.
// INVARIANTS (do not change): /api/* registers BEFORE the SPA fallback; asset paths are
// relative (path-proxy safe); data lives in data/; shutdown is graceful.
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import { initSchema } from './server/db.js';
import { mountApi } from './server/api.js';

initSchema();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '1mb' }));

// --- API (must come BEFORE the SPA fallback so /api/* never returns index.html) ---
app.get('/api/health', (_req, res) => res.json({ ok: true }));
mountApi(app);
// Unknown API path → JSON 404, never HTML.
app.use('/api', (_req, res) => res.status(404).json({ error: 'not_found' }));

// --- SPA (built client) ---
const dist = path.join(__dirname, 'client', 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const port = Number(process.env.PORT) || 4000;
const server = app.listen(port, () => console.log(`app listening on :${port}`));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close(() => process.exit(0)));
