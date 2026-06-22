# ArksAI App Backend Kit (Fastify + SQLite)

The backend counterpart of the mobile UI kit — every generated app's API starts here so
the client and server feel of one piece. Installed into an app's `server/` by the
`add_app_backend` tool, then **published on the normal pipeline** (it gets a live
`<slug>.apps.arksai.studio` URL the mobile app calls).

## What's here
- `server.js` — Fastify app: health, JWT auth (`/auth/register`, `/auth/login`, `/me`),
  a sample `items` resource (CRUD pattern), a **consistent error envelope**
  `{ error: { message, code } }`, per‑route **JSON‑schema validation**, CORS for the app,
  binds `process.env.PORT`.
- `db.js` — SQLite (better‑sqlite3) + an idempotent `migrate()`; swap to Postgres later
  behind the same helpers.
- `package.json` — Fastify 5 + jwt + cors + better‑sqlite3 + bcryptjs.

## The quality bar (match it when extending)
1. **Every route validated** (schema on body/params/query) — never trust client input.
2. **One error envelope** `{ error: { message, code } }` — the client reads this shape.
3. **Auth via the `auth` preHandler** (JWT) on protected routes; never leak another user's data.
4. **Typed, RESTful resources**; migrations for schema; indexes on foreign keys.
5. Bind `process.env.PORT`, host `0.0.0.0`; a `/health` route (the deploy verify hits it).

## Wiring the client
The mobile app calls this API's live URL with a typed API client + the JWT from
`/auth/login`. Store the base URL in the app's config; attach `Authorization: Bearer <token>`.
Replace `items` with the app's real data model, keeping the validation/envelope/auth patterns.
