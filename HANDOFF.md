# ArksAI — Session Hand-off

**If you're a new session picking this up: do this first.**
1. Read **`CLAUDE.md`** (full project memory — vision, current state, architecture, gotchas, secrets policy).
2. Read **`FEATURES.md`** (the living feature list — what's built).
3. Then continue from "Current direction" below.

Those two files carry almost everything; this file is the quick orientation + the deploy process.

---

## What ArksAI is / what we're trying to do
A self-hosted, Claude-Code-style web coding agent (DeepSeek brain; MiniMax + Suno as
capability engines) for **general, non-technical people — NOT developers**.

**The promise:** describe something once → get **one finished thing** that looks perfect,
works perfectly, and is actually live/usable, with **zero user iteration**. "Apple, not
Windows" — the brain is swappable; quality comes from the SYSTEM. Two pillars, both built:
- **A. One-shot quality** — task classification → an opinionated design system + UI kit + a
  gating visual design-critique loop + bulletproof verification (static + runtime + interaction
  + post-publish smoke test) so the user never sees an error or has to iterate.
- **B. Live deployment** — `publish_app` snapshots the built app to a durable, public,
  auth-free URL at `/apps/<slug>/` that survives restarts.

## Current direction (the active north star)
A **B2B pivot**: onboard companies by empowering distinct **corporate functions** ("not just
another wrapper for all"). The app is organized around **departments** — Marketing, Sales,
Finance/Strategy, HR·People & Ops, Engineering — each with a ~50-task catalog (grouped
Create / Analyze / Operate) and server-side **per-task expert standards** (FP&A rigor,
inclusive HR, RevOps, etc.). Identity is **light/warm editorial**; Engineering gets dark mode.

**Shipped:** department studio + catalog + expertise, B2B landing + lead capture, a durable
recurring-task scheduler, credential-free `fetch_data` / `send_webhook`, image recognition,
auto mode/engine switching, the full streamline + progress + delivery-moment UX.

**Next big arc (NOT yet built):** the org/team **multi-seat platform** — per-user accounts
(replacing the single `APP_PASSWORD`), roles/invites, org-scoped data, departments → per-org
templates. It's security-sensitive and gets its own plan + review before building.

**Staged (needs Droplet credentials, not committed to the PUBLIC repo):** OAuth connectors for
private Google Sheets/Drive + CRM, a Slack app, SMTP email.

## Working rules
- **Land everything on `main`.** The task harness may assign a `claude/...` branch, but
  auto-deploy only watches `main` — so commit/merge to `main`.
- **Before claiming done:** `npm run typecheck && npm test && npm run build` — all must pass.
- **Update `FEATURES.md`** in the SAME commit as any feature add/remove/meaningful change.
- The repo **`chordsnstrings/arksai` is PUBLIC** — NEVER commit secrets. Secrets live only in
  gitignored `.env` (local) and `/opt/arksai/.env` (Droplet).
- Design philosophy is baked in: minimal, classy, typography-first, ALWAYS (see CLAUDE.md).

## Deployment process (how to ship — there is no manual deploy)
1. Make changes; run `npm run typecheck && npm test && npm run build` (all green).
2. **Commit and push to `main`.** That's the deploy.
3. The Droplet runs a **systemd timer that pulls + rebuilds `main` every ~2 minutes**, so a
   push to `main` goes live automatically.
4. **Don't hand-edit files in `/opt/arksai`** on the Droplet — auto-deploy overwrites them.
   The exception is `/opt/arksai/.env` (live secrets: `DEEPSEEK_API_KEY`, `MINIMAX_API_KEY`,
   `APP_PASSWORD`, `SUNO_API_KEY`, `SERPER_API_KEY`, `GITHUB_TOKEN`) — safe and persistent.
5. **The assistant can't reach the Droplet directly** (sandbox egress blocks its IP/SSH, and
   the DO API token manages infra, not shell). Ship via push→auto-deploy. Anything needing a
   real model key or open egress (live builds, MiniMax vision calls, scheduled runs firing,
   external data/webhook delivery) is wired + tested in the sandbox but only fully exercised
   **on the Droplet** — validate there.

## Deployment facts
- Droplet **arksai**, 4 GB, DO region **blr1 (Bangalore)**, project "ARKS AI Platform".
- Public IP **159.89.172.210**; app at **http://159.89.172.210** (plain HTTP; TLS/domain parked).
- Managed Postgres **arksai-db** exists but is only used if `DATABASE_URL` is set; currently on
  SQLite + the `arksai-data` volume (dual-driver DB).
- Manual redeploy if ever needed: `cd /opt/arksai && ./deploy.sh`.

## Local dev (optional, for testing)
- The ephemeral container's gitignored `.env` does **not** carry over — re-paste keys.
- Build then run in an ISOLATED command (a `pkill`/`kill` in the same command kills the new
  start):
  ```
  npm run build
  APP_PASSWORD=testpass PORT=3000 DEEPSEEK_API_KEY=... node server/dist/server/src/index.js &
  ```
- To repro UI bugs, drive a real headless browser (Playwright is installed) — curl misses
  frontend-path bugs. To verify generated PDFs, rasterize with the `mupdf` npm package
  (`npm i mupdf --no-save`) → PNG → look at it (Chromium can't screenshot a PDF).

## Stack & layout (1-minute version; full detail in CLAUDE.md)
- npm workspaces: `server/` (Fastify + TS), `client/` (React + Vite), `shared/types.ts` (the contract).
- Agent loop: `server/src/agent/runner.ts`; tools in `server/src/agent/tools/`; prompts in
  `server/src/agent/prompts.ts`; engines in `server/src/engines/`.
- Department catalog: `client/src/lib/departments.ts`; per-task standards:
  `server/src/agent/expertise.ts`.
- Dual-driver storage in `server/src/db`; the async store in `server/src/sessions/store.ts`.
