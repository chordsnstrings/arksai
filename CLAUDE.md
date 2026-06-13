# ArksAI — project memory

A self-hosted, Claude-Code-style web coding agent powered by DeepSeek, with an
engine-orchestration layer (Suno for music, more later). This file is the
durable context to reuse every session.

## Stack & layout
- npm workspaces: `server/` (Fastify + TS), `client/` (React + Vite), `shared/types.ts` (the contract).
- Storage: dual driver in `server/src/db` — PostgreSQL when `DATABASE_URL` is set, else SQLite on the volume. The store (`server/src/sessions/store.ts`) is async.
- Agent loop: `server/src/agent/runner.ts`. Tools in `server/src/agent/tools/`. Prompts in `server/src/agent/prompts.ts`.
- Engines/orchestration: `server/src/engines/` (registry + suno). Add an engine = registry entry + a gated tool.
- Modes: chat / plan / code / **report**. Report mode (`render_report` + `add_fonts` tools, report block in `prompts.ts`) turns pasted text/CSV/uploads into a designed PDF or 16:9 deck via bespoke HTML/CSS → headless-Chromium `page.pdf()`; curated toolset via `REPORT_TOOLS` in `tools/index.ts` (no git/verify). **No fixed templates** — each report is designed bespoke but MUST follow the protocol (minimal/modern/typography-first, light by default, charts+tables, centered cover, page-break-safe). `add_fonts` installs self-hosted Inter/Source Serif 4/Space Grotesk (`server/assets/report-fonts/`) so fonts are always embedded. Agent ALWAYS asks branding (colors/accent or upload a logo). Both doc+deck per request; narrative+cited benchmarks allowed, never fabricate figures.
- **Report PAGE MECHANICS (verified, baked into the prompt)**: margins go on `@page{margin:18mm 16mm}` so they repeat on EVERY physical page (NOT on a fixed-width padded container — that was the continuation-page bleed bug). Cover is centered with `min-height:calc(100vh - 36mm)` (36mm = 2× the vertical margin; `@page:first{margin:0}` is NOT honored by Chromium). Tables: compact (`padding:1.1mm 2.6mm`, 9pt, lh 1.3), centered, zebra rows + faint column hairlines, `<thead>` repeats. **Verify PDFs by rasterizing with the `mupdf` npm pkg** (WASM, no native deps) → PNG → Read it; headless Chromium can't screenshot a PDF (it downloads it). Core needs no MiniMax; vision QC (`see_image`) lights up when keyed.
- Models are ArksAI-branded labels (`deepseek-v4-flash` = "ArksAI Flash", `-pro` = "ArksAI Pro"); model list is fetched live from DeepSeek's /models.
- Sandbox egress is a **curated allowlist proxy** (set per environment, applies to NEW sessions only). `api.deepseek.com` is allowed; `api.minimax.io` was added but a running session keeps its old policy — MiniMax validation needs a fresh session. Generated-media download URLs sit on storage/CDN hosts that also need allowlisting.
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
- All live secrets are in `/opt/arksai/.env` on the Droplet: `APP_PASSWORD`, `DEEPSEEK_API_KEY`, `GITHUB_TOKEN`, `SERPER_API_KEY`, `SUNO_API_KEY`, `MINIMAX_API_KEY`. Read the login password with `grep APP_PASSWORD /opt/arksai/.env`.
- MiniMax key was added to the roster (config + `listEngines()` + `secretValues()` + `.env.example`); usage TBD. Its value is NOT in any tracked file — for dev it's in the **gitignored** repo-root `.env` (`MINIMAX_API_KEY=`, `MINIMAX_BASE_URL=https://api.minimax.io/v1`); durable home is `/opt/arksai/.env` on the Droplet. Optionally `MINIMAX_GROUP_ID=` for T2A/voice.
- **The GitHub repo `chordsnstrings/arksai` is PUBLIC.** Never commit any real secret (CLAUDE.md included) — it would be scraped/auto-revoked in minutes. Secrets live only in gitignored `.env` (local) and `/opt/arksai/.env` (Droplet).
- `AGENT_UNRESTRICTED=true` is set (full host access for the agent) — single-operator trusted mode.
- Keys pasted in chat are considered exposed and should be rotated.

## Engine notes
- Engine roster lives in `server/src/engines/registry.ts` (`listEngines()`), surfaced at `GET /api/engines`. Each engine = registry entry (gated on its key) + a tool. Keys are read in `server/src/config.ts`.
- Suno (sunoapi.org/apibox): `generate_music` tool, gated on `SUNO_API_KEY`. Cost per track added to the session cost bar (`SUNO_COST_PER_TRACK`, default $0.08). The real API call was never validated from the sandbox (egress) — validate on the Droplet; adjust request shape in `server/src/engines/suno.ts` if it errors.
- MiniMax (`server/src/engines/minimax.ts`): wired as the "anything DeepSeek can't do" provider. Gated tools (`server/src/agent/tools/minimax.ts`): `see_image` (vision/VLM — also used in the verify gate's visual check), `generate_image`, `text_to_speech` (needs `MINIMAX_GROUP_ID`), `generate_video` (Hailuo). LLM is OpenAI-compatible (`minimaxBaseUrl` + `minimaxModel`, default `MiniMax-Text-01`; set `MINIMAX_MODEL=MiniMax-M2` for best coding). **All request shapes are UNVALIDATED from the sandbox (egress) — they fail gracefully; validate on the Droplet** and tune model ids/costs (`minimaxVlModel`/`minimaxImageModel`/`minimaxTtsModel`/`minimaxVideoModel`, `minimax*Cost`). Music stays on Suno (best value) — no MiniMax music tool.
- Orchestrator model **ArksAI Auto** (`arksai-auto`) + **ArksAI Max** (`arksai-max` = MiniMax LLM, shown/selectable when keyed). Routing in `server/src/agent/router.ts` (pure heuristic: task text + mode → Flash/Pro/MiniMax tiers, escalates to a stronger model when verification fails, MiniMax→Pro fallback on hard error). Cost is **server-authoritative**: summed per concrete model and streamed as `usage_update.costUsd`, so the footer blends models in Auto mode. Two routing layers: model-tier (text) here + capability tools (modalities) above.

## Gotchas learned the hard way
- Empty JSON body → Fastify 400. The client must not send `Content-Type: application/json` without a body; server has a tolerant JSON parser. (Caused the DELETE-not-working bug.)
- Agent apps default to `PORT=4000` (childEnv) so they can't collide with / kill ArksAI on 3000.
- DeepSeek v4 models default to THINKING mode — for tiny calls (titles) use the non-thinking `deepseek-chat` alias or the token budget is eaten by reasoning.
- The sandbox/container has noise listening ports that are NOT apps (saw 2024, 2025, plus ephemeral 34xxx). Canvas must never auto-load the *lowest* port (`ports[0]`). `pickPreviewPort` in Canvas.tsx prefers known dev ports (agent default 4000 first, then 5173/3000/8080/…) and only auto-picks a single plausible 3000–9999 port otherwise; `orderPorts` lists recognised dev ports first. (This was the "canvas won't load apps" bug — it had been loading port 2024 and showing 502/401.)

## Behavior defaults baked into the agent
- **Design philosophy (global, durable): minimal, classy, beautiful, typography-first — ALWAYS, for reports AND any UI/code build, unless the user explicitly opts out.** Every iteration should look designed, not default: embed high-quality fonts (self-host via @font-face / the `add_fonts` tool: Inter, Source Serif 4, Space Grotesk — or a quality Google Font), use a clear modular type scale + ~1.5 line-height + real hierarchy, light/restrained palette with one accent, generous whitespace. Baked into the code-mode UI defaults + the report protocol in `prompts.ts`.
- UI builds: modern/minimal/responsive, generous padding, micro-animations; ASK the user to choose a color palette (offer named complementary palettes) before building.
- Code mode: mandatory verification gate (static checks + runtime boot/flow for apps) before completion.
- Auto-export + auto-canvas: on a successful code run that touched a real project, the runner zips a complete export (`<name>-export.zip`, excludes node_modules/.git; download chip) and, for renderable output (web app or static HTML), boots a persistent preview server (`startPreviewServer`, PORT 4000 / python static server) and emits `open_canvas` so the client opens the Canvas. Code lives in `server/src/agent/canvasExport.ts`. The agent shouldn't hand-zip or start its own preview for this.
- UI verification: the runtime probe (`probeApp`) loads HTML apps in **headless Chromium** (Playwright, `server/src/agent/uiCheck.ts`) and hard-fails the verify gate on a blank page, uncaught JS errors, or failed same-origin asset/API requests — because DeepSeek is text-only and can't "see" the UI; these are signals it CAN read and fix. True visual/layout judgment would need a vision model via the orchestrator (not built). `uiCheck` degrades gracefully if Chromium is missing. The Dockerfile installs Chromium (`npx playwright install --with-deps chromium` → `/ms-playwright`) and `zip`.
- Music: act as a Suno expert; confirm the brief before the first (paid) generation.
- Global/project memory feature exists in-app (`/memory`, ARKS.md) — separate from this file.
