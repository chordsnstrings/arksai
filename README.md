# ArksAI

A self-hosted, Claude Code-style web coding agent powered by the **DeepSeek API**.

Replicates the Claude Code web workflow: a dark terminal-style chat UI with a
sidebar of recent sessions, **Plan / Code** modes, live streaming of the agent's
tool activity ("Bash · 5"), a running status footer ("38s · 11.6k tokens ·
1 running task"), and full GitHub integration — the agent can clone a repo,
edit files, run commands, commit, and **push** branches back to GitHub.

```
React + Vite SPA  ──REST + SSE──►  Fastify (TypeScript)
                                     ├─ Agent loop → DeepSeek (OpenAI-compatible, tool calling)
                                     ├─ Tools: bash, read/write/edit, glob, grep, git commit/push
                                     ├─ Per-session git workspaces under /data
                                     └─ SQLite persistence (sessions survive restarts)
```

## Quick start (local)

```bash
cp .env.example .env     # fill in DEEPSEEK_API_KEY, APP_PASSWORD, GITHUB_TOKEN
npm install
npm run dev              # client on http://localhost:5173, server on :3000
```

Log in with `APP_PASSWORD`, create a session (optionally pointing at a GitHub
repo), and give the agent a task. **Plan mode** is read-only exploration that
ends with an implementation plan; **Code mode** executes, verifies, commits,
and pushes when asked.

Use the **+** button in the composer (or drag & drop onto it) to upload files
into the session workspace — they land in `uploads/` where the agent can read
text files or extract archives (25 MB/file limit). Note: DeepSeek models are
text-only, so the agent can work with text/code uploads but cannot see image
content. Switch models per session via the model badge in the composer.

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DEEPSEEK_API_KEY` | yes | DeepSeek API key (env only — never commit it) |
| `APP_PASSWORD` | yes (prod) | Login password for the UI. The app executes shell commands; never run it without this. |
| `GITHUB_TOKEN` | for GitHub | Fine-grained PAT, `contents: read/write` on the specific repos only |
| `PORT` | no | HTTP port (default 3000) |
| `DATA_DIR` | no | SQLite DB + workspaces dir (default `./data`, `/data` in Docker) |
| `DEEPSEEK_BASE_URL` | no | Default `https://api.deepseek.com` |
| `MAX_CONCURRENT_RUNS` | no | Default 3 |
| `WORKSPACE_TTL_DAYS` | no | Boot-time cleanup of stale workspaces (default 14) |
| `COOKIE_SECURE` | no | Set `true` when serving over HTTPS |

## Deploy — DigitalOcean Droplet (recommended)

The droplet path keeps sessions and workspaces on durable disk.

```bash
# on an Ubuntu droplet (>= 2 GB RAM) with Docker installed:
git clone https://github.com/chordsnstrings/arksai.git && cd arksai
cp .env.example .env && nano .env        # set the three secrets
docker compose up -d --build
```

The app is now on port 3000. Put TLS in front (Caddy or nginx + certbot),
then set `COOKIE_SECURE=true` and restart. Data persists in `./data`.

## Deploy — DigitalOcean App Platform

1. Create an App from this GitHub repo; it auto-detects the `Dockerfile`.
2. Set **encrypted** env vars: `DEEPSEEK_API_KEY`, `APP_PASSWORD`, `GITHUB_TOKEN`, and `COOKIE_SECURE=true`.
3. HTTP port `3000`, health check path `/healthz`, **1 instance** (the run
   registry is single-process).

> **Caveat:** App Platform containers have *ephemeral* disks — sessions and
> workspaces are lost on every redeploy. Fine for demos; use the Droplet path
> for durable use.

## Security model

Single-tenant, trusted-operator software — it executes shell commands by design.

- Password-gated UI (signed httpOnly cookie, rate-limited login).
- The agent's shell gets an **allowlisted environment**: it cannot read
  `DEEPSEEK_API_KEY` / `GITHUB_TOKEN` / `APP_PASSWORD`; known secret values are
  scrubbed from all tool output.
- The GitHub token is injected per clone/push invocation and never written to
  the on-disk git remote.
- File tools are jailed to the session workspace (realpath-verified — no `..`
  or symlink escapes). Plan mode additionally blocks mutating bash commands.
- Container runs as the non-root `node` user. The container is the blast-radius
  boundary: don't keep other secrets on the host, and don't expose the app
  without the password gate and TLS.

## Development

```bash
npm run typecheck   # both packages
npm test            # server unit tests (path-escape, plan-mode denylist, ...)
npm run build       # client (vite) + server (tsc)
npm start           # serve the built app on :3000
```
