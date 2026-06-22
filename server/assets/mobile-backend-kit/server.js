/**
 * ArksAI App Backend Kit — a clean, minimal, typed-by-convention Fastify API starter.
 *
 * The backend counterpart of the mobile UI kit: every generated app's backend starts from
 * this so client + API feel of one piece. Conventions: a consistent error envelope, input
 * validation (JSON schema per route), JWT auth, SQLite (→ Postgres later), CORS for the app,
 * and a health check. Binds process.env.PORT (publish pipeline injects it). Extend with the
 * app's real resources; keep the envelope + validation + auth patterns.
 *
 *   npm i fastify @fastify/cors @fastify/jwt better-sqlite3 bcryptjs
 *   node server.js   (PORT defaults to 4000)
 */
const Fastify = require('fastify');
const cors = require('@fastify/cors');
const jwt = require('@fastify/jwt');
const { db, migrate } = require('./db');
const bcrypt = require('bcryptjs');

const app = Fastify({ logger: true });

async function main() {
  migrate();
  await app.register(cors, { origin: true }); // the mobile client is a different origin
  await app.register(jwt, { secret: process.env.JWT_SECRET || 'dev-secret-change-me' });

  // Consistent error envelope: { error: { message, code } } — the client reads this shape.
  app.setErrorHandler((err, _req, reply) => {
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    reply.code(status).send({ error: { message: err.message || 'Server error', code: err.code || 'ERROR' } });
  });
  app.setNotFoundHandler((_req, reply) =>
    reply.code(404).send({ error: { message: 'Not found', code: 'NOT_FOUND' } }),
  );

  const auth = async (req, reply) => {
    try { await req.jwtVerify(); } catch { reply.code(401).send({ error: { message: 'Unauthorized', code: 'UNAUTHORIZED' } }); }
  };

  app.get('/health', async () => ({ ok: true }));

  // --- Auth (email + password → JWT). Validated by schema. ---
  const credSchema = {
    body: {
      type: 'object', required: ['email', 'password'],
      properties: { email: { type: 'string', minLength: 3 }, password: { type: 'string', minLength: 6 }, name: { type: 'string' } },
    },
  };

  app.post('/auth/register', { schema: credSchema }, async (req, reply) => {
    const { email, password, name } = req.body;
    const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
    if (exists) return reply.code(409).send({ error: { message: 'Email already registered', code: 'EMAIL_TAKEN' } });
    const info = db.prepare('INSERT INTO users(email, name, password_hash, created_at) VALUES (?,?,?,?)')
      .run(email.toLowerCase(), name || null, bcrypt.hashSync(password, 10), Date.now());
    const token = app.jwt.sign({ sub: info.lastInsertRowid, email });
    return { token, user: { id: info.lastInsertRowid, email, name: name || null } };
  });

  app.post('/auth/login', { schema: credSchema }, async (req, reply) => {
    const { email, password } = req.body;
    const u = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
    if (!u || !bcrypt.compareSync(password, u.password_hash))
      return reply.code(401).send({ error: { message: 'Invalid email or password', code: 'BAD_CREDENTIALS' } });
    return { token: app.jwt.sign({ sub: u.id, email: u.email }), user: { id: u.id, email: u.email, name: u.name } };
  });

  app.get('/me', { preHandler: auth }, async (req) => {
    const u = db.prepare('SELECT id, email, name FROM users WHERE id = ?').get(req.user.sub);
    return { user: u };
  });

  // --- Sample resource: items (replace with the app's real data model; keep the pattern). ---
  app.get('/items', { preHandler: auth }, async (req) =>
    ({ items: db.prepare('SELECT * FROM items WHERE user_id = ? ORDER BY created_at DESC').all(req.user.sub) }),
  );
  app.post('/items', {
    preHandler: auth,
    schema: { body: { type: 'object', required: ['title'], properties: { title: { type: 'string', minLength: 1 } } } },
  }, async (req) => {
    const info = db.prepare('INSERT INTO items(user_id, title, created_at) VALUES (?,?,?)')
      .run(req.user.sub, req.body.title, Date.now());
    return { item: db.prepare('SELECT * FROM items WHERE id = ?').get(info.lastInsertRowid) };
  });

  const port = Number(process.env.PORT) || 4000;
  await app.listen({ port, host: '0.0.0.0' });
}

main().catch((e) => { app.log.error(e); process.exit(1); });
