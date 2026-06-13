# ArksAI — project memory

A self-hosted, Claude-Code-style web coding agent powered by DeepSeek, with an
engine-orchestration layer (Suno for music, more later). This file is the
durable context to reuse every session.

## Stack & layout
- npm workspaces: `server/` (Fastify + TS), `client/` (React + Vite), `shared/types.ts` (the contract).
- Storage: dual driver in `server/src/db` — PostgreSQL when `DATABASE_URL` is set, else SQLite on the volume. The store (`server/src/sessions/store.ts`) is async.
- Agent loop: `server/src/agent/runner.ts`. Tools in `server/src/agent/tools/`. Prompts in `server/src/agent/prompts.ts`.
- Engines/orchestration: `server/src/engines/` (registry + suno). Add an engine = registry entry + a gated tool.
- Modes: chat / plan / code. Models are ArksAI-branded labels (`deepseek-v4-flash` = "ArksAI Flash", `-pro` = "ArksAI Pro"); model list is fetched live from DeepSeek's /models.
- Canvas (in-app dev preview): `client/src/components/Canvas.tsx` (Preview/Files tabs). Preview proxies through `/api/sessions/:id/preview/:port/*` (`server/src/routes/preview.ts`), which rewrites root-absolute `src/href="/..."` and injects `<base href>`. Listening ports come from `/ports` → `server/src/lib/ports.ts` (`listeningPorts` parses /proc/net/tcp{,6}).

## How to work here
- Before claiming done: `npm run typecheck && npm test && npm run build` (12 tests). All must pass.
- After changes: commit to `main` and push. **Auto-deploy** (systemd timer on the Droplet) pulls + rebuilds `main` every ~2 min — no manual deploy needed. Don't hand-edit files in `/opt/arksai` (overwritten); `.env` is safe.
- The user wants work landed on `main`. The web/task harness sometimes assigns a feature branch (e.g. `claude/...`); auto-deploy only watches `main`, so commit/merge to `main` — the user has said "commit to main" explicitly and repeatedly.
- Local manual run for testing: `APP_PASSWORD=testpass PORT=3000 DEEPSEEK_API_KEY=... nohup node server/dist/server/src/index.js &` — start it in an ISOLATED bash command (a `pkill`/`kill` in the same command kills the new start; that's burned me repeatedly).
- To reproduce UI bugs, drive a real headless browser (Playwright is installed) and click the actual element — curl tests miss frontend-path bugs (the DELETE-400 bug was only visible through the browser).

## Deployment (DigitalOcean)
- Droplet **arksai**, 4 GB, region **blr1 (Bangalore)**, in DO project **"ARKS AI Platform"**. Public IP **159.89.172.210**.
- App URL: **http://159.89.172.210** (plain HTTP; TLS via `docker-compose.tls.yml` + Caddy is parked — needs a domain to avoid self-signed warnings).
- Managed Postgres **arksai-db** exists (PG16, blr1) but is only used if `DATABASE_URL` is set; currently on SQLite + the `arksai-data` volume.
- Redeploy manually if ever needed: `cd /opt/arksai && ./deploy.sh` (plain) or `./deploy.sh tls`.
- I (the assistant) CANNOT reach the Droplet directly — sandbox egress blocks its IP and SSH; the DO API token only manages infrastructure, not shell. Deploy happens via push→auto-deploy.

## Secrets (NEVER commit real values here)
- All live secrets are in `/opt/arksai/.env` on the Droplet: `APP_PASSWORD`, `DEEPSEEK_API_KEY`, `GITHUB_TOKEN`, `SERPER_API_KEY`, `SUNO_API_KEY`. Read the login password with `grep APP_PASSWORD /opt/arksai/.env`.
- `AGENT_UNRESTRICTED=true` is set (full host access for the agent) — single-operator trusted mode.
- Keys pasted in chat are considered exposed and should be rotated.

## Engine notes
- Suno (sunoapi.org/apibox): `generate_music` tool, gated on `SUNO_API_KEY`. Cost per track added to the session cost bar (`SUNO_COST_PER_TRACK`, default $0.08). The real API call was never validated from the sandbox (egress) — validate on the Droplet; adjust request shape in `server/src/engines/suno.ts` if it errors.

## Gotchas learned the hard way
- Empty JSON body → Fastify 400. The client must not send `Content-Type: application/json` without a body; server has a tolerant JSON parser. (Caused the DELETE-not-working bug.)
- Agent apps default to `PORT=4000` (childEnv) so they can't collide with / kill ArksAI on 3000.
- DeepSeek v4 models default to THINKING mode — for tiny calls (titles) use the non-thinking `deepseek-chat` alias or the token budget is eaten by reasoning.
- The sandbox/container has noise listening ports that are NOT apps (saw 2024, 2025, plus ephemeral 34xxx). Canvas must never auto-load the *lowest* port (`ports[0]`). `pickPreviewPort` in Canvas.tsx prefers known dev ports (agent default 4000 first, then 5173/3000/8080/…) and only auto-picks a single plausible 3000–9999 port otherwise; `orderPorts` lists recognised dev ports first. (This was the "canvas won't load apps" bug — it had been loading port 2024 and showing 502/401.)

## Behavior defaults baked into the agent
- UI builds: modern/minimal/responsive, generous padding, micro-animations; ASK the user to choose a color palette (offer named complementary palettes) before building.
- Code mode: mandatory verification gate (static checks + runtime boot/flow for apps) before completion.
- Music: act as a Suno expert; confirm the brief before the first (paid) generation.
- Global/project memory feature exists in-app (`/memory`, ARKS.md) — separate from this file.
