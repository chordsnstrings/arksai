# ArksAI — Live Deployment Check & Fix Runbook

**For a session WITH live SSH access to the production Droplet.** Run this top-to-bottom against
the **real** deployment (https://arksai.studio), diagnose anything that fails, and fix it on the go.
The repo's in-code audits run on `localhost` and never touch the deployed TLS/Caddy/publish layer —
so treat *this* as deployment-truth. Everything here is read-only unless a "Fix" step says otherwise.

---

## 0. Access, layout, and the golden rules

- **SSH:** `ssh root@159.89.172.210`
- **App dir:** `/opt/arksai` (Docker Compose). Live stack = **TLS** → `docker-compose.tls.yml`
  (the `arksai` app container + a `caddy` container that terminates HTTPS and reverse-proxies to
  `arksai:3000`).
- **Site:** https://arksai.studio  (HTTPS via Caddy; `SITE_ADDRESS=arksai.studio`, `COOKIE_SECURE=true`).
- **Secrets:** `/opt/arksai/.env` — `APP_PASSWORD` (operator login), `DEEPSEEK_API_KEY` (text),
  `MINIMAX_API_KEY` (image/vision/M3 — `sk-cp-…`), `SITE_ADDRESS`, `CADDY_TLS`, `COOKIE_SECURE=true`.
- **Data:** the `arksai-data` **named volume** (SQLite). It survives `down`/`up`/rebuilds.
- **GOLDEN RULES:**
  - **Never** `docker compose down -v` (that deletes the data volume).
  - **Never** `docker compose up -d` with the *plain* `docker-compose.yml`, and **never**
    `--remove-orphans` on the plain file — it deletes Caddy and takes the HTTPS site down. Always use
    **`./deploy.sh`** (it auto-detects `SITE_ADDRESS` → TLS, stops both stacks cleanly, rebuilds).
  - Repo is **public** — never commit a secret.
  - Deploy = **push to `main`** → the systemd timer runs `./deploy.sh` (~2 min). Or on the box:
    `cd /opt/arksai && ./deploy.sh`.

---

## 1. Run the automated checks first

```bash
# infra + TLS + auth + DB + capabilities + publish/serve path (read-only, no deps)
ssh root@159.89.172.210 'cd /opt/arksai && git pull --ff-only && bash scripts/deploy-check.sh'

# in-browser render + iframe test of a published app (Playwright, inside the container)
ssh root@159.89.172.210 "cd /opt/arksai && docker compose -f docker-compose.tls.yml exec -T arksai \
  sh -c 'BASE=https://arksai.studio APP_PASSWORD=\$APP_PASSWORD node /app/scripts/deploy-check-browser.mjs'"
```

Read the `✓ / ! / ✗` lines. Then walk the manual checklist below for anything the scripts flag or
don't cover.

---

## 2. Comprehensive manual checklist

Each row: **what** · **command** · **expected** · **fix if it fails**.

### A. Containers & process
- **Both containers up** · `cd /opt/arksai && docker compose -f docker-compose.tls.yml ps` ·
  `arksai-arksai-1` **and** `arksai-caddy-1` both `running`/`Up` ·
  **Fix:** `cd /opt/arksai && ./deploy.sh` (restores both + TLS).
- **No crash loop** · `docker compose -f docker-compose.tls.yml logs --tail=120 arksai` ·
  ends with `listening on :3000` + a `[capabilities]` line, no repeating stack traces ·
  **Fix:** read the error; if a bad build, `./deploy.sh` rebuilds from `main`; if `.env`, fix and redeploy.

### B. TLS & reachability
- **HTTPS health** · `curl -sI https://arksai.studio/healthz` · `HTTP/2 200`, valid cert (no `curl: (60)`) ·
  **Fix:** caddy down → `./deploy.sh`; cert issue → check `CADDY_TLS` (email) + `SITE_ADDRESS` in `.env`,
  and `docker compose -f docker-compose.tls.yml logs caddy`.
- **App shell loads** · `curl -s -o /dev/null -w '%{http_code}' https://arksai.studio/` · `200`.

### C. Auth & login
- **Operator login** · `curl -s -o /dev/null -w '%{http_code}' -X POST https://arksai.studio/api/auth/login -H 'content-type: application/json' --data "{\"password\":\"$(grep '^APP_PASSWORD=' /opt/arksai/.env|cut -d= -f2-)\"}"` · `200` ·
  **Fix:** if `401`, `APP_PASSWORD` in `.env` is wrong/blank; if the login page won't even load, the
  app or Caddy is down (§A/§B). Remember `COOKIE_SECURE=true` → login only works over **HTTPS**.
- **A member login works** (if orgs exist) · log in via the UI with a known member · lands in their org.

### D. Database & data integrity
- **Sessions/orgs present** · (authenticated) `GET /api/sessions`, `GET /api/admin/orgs` return data ·
  non-empty arrays · **Fix:** if empty/errors, the volume may not be mounted at `DATA_DIR` — check
  `docker run --rm -v arksai-data:/data alpine ls -la /data` shows the `*.db`, and that `.env` has
  `DATA_DIR=/data`.
- **Volume intact** · `docker run --rm -v arksai-data:/data alpine ls -la /data` · the SQLite db file
  exists and is non-trivial in size.

### E. Capabilities (the providers)
- **Capability log** · `docker compose -f docker-compose.tls.yml logs --tail=300 arksai | grep -i capabilit` ·
  `text (DeepSeek): enabled · image generation + vision + ArksAI Max/M3 (MiniMax): enabled` ·
  **Fix:** if MiniMax `DISABLED`, add a valid `MINIMAX_API_KEY=sk-cp-…` to `/opt/arksai/.env`
  (a `sk-api-…` key returns `insufficient_balance`), dedupe any double line, then `./deploy.sh`.
- **Image gen actually works** · in the app, run a marketing creative (or the UK-visa post) ·
  a real PNG renders (not a CSS/HTML fallback, not "unknown tool") · **Fix:** confirm the key (above);
  the agent code is already fixed so a real error surfaces clearly instead of falling back.

### F. Publish & serve  (`/apps/<slug>/`)
- **Published app serves** · `curl -sI https://arksai.studio/apps/<slug>/` · `200`, `text/html` ·
- **Assets load (not 404/HTML)** · grab a `.js`/`.css` from the served HTML, `curl -sI` it ·
  `200` + correct content-type · **Fix:** if `404`, the `<base href>` rewrite or the snapshot is wrong
  (see `server/src/routes/deployments.ts rewriteHtml`).
- **No mixed content** · none of the asset URLs are `http://` on the HTTPS page ·
  **Fix (likely Canvas bug, §4):** if an asset/script is `http://…`, the browser blocks it in the iframe.

### G. Canvas & preview  ← **the reported bug**
- **Symptom:** publish works, but the **Canvas won't load the published app on the deployment.**
- **Diagnose:** run `scripts/deploy-check-browser.mjs` (§1) — it renders `/apps/<slug>/` and loads it in
  an iframe, reporting console errors, failed requests, and mixed-content. Also open the app in the UI,
  open the Canvas, and check the browser devtools Network/Console for blocked (`http://`) requests or a
  dead preview port.
- **Two prime causes — see §4 for the fix.**

### H. Per-deliverable spot check (optional, deeper)
Run one play of each type via the UI and confirm it completes + the artifact opens:
web app, BI dashboard, PDF report, `.docx`, formula `.xlsx`, `.pptx` deck, marketing creative (image),
compliance `.sif`/PINT-AE `.xml`, bilingual legal contract. (~13 types share the generators/gates
already validated locally; this confirms they work in the deployed runtime too.)

### I. Background systems
- **Scheduler** · `docker compose -f docker-compose.tls.yml logs arksai | grep -i scheduler` · started ·
- **Auto-deploy timer** · `systemctl status arksai-autodeploy.timer` (or `list-timers | grep arksai`) ·
  active; last run succeeded (`journalctl -u arksai-autodeploy.service --no-pager | tail`).
- **Analytics digest** (if `ANALYTICS_DIGEST_WEBHOOK` set) · no repeated errors in logs.

### J. Resource health
- **Disk** · `df -h /` · not >90% · **Fix:** `docker system prune -f` (safe; doesn't touch the named volume).
- **Memory** · `free -m` · headroom · note: heavy concurrent agent runs + LibreOffice can spike memory.
- **Errors** · `docker compose -f docker-compose.tls.yml logs --since=1h arksai | grep -iE 'error|fatal|unhandled' | tail`.

### K. Security
- **No secret in git** · `git -C /opt/arksai log -p -3 | grep -iE 'sk-cp-|sk-api-|dop_v1_|APP_PASSWORD='` → nothing.
- **Org isolation** · a member cannot see another org's data (covered by `redteam-isolation.test.ts`;
  spot-check in the UI if multiple orgs exist).

---

## 3. Fixing on the go

**Code fix (most bugs, incl. the Canvas one):**
1. Edit the code locally in the repo checkout.
2. Gate: `npm run typecheck && npm test && npm run build` (all must pass).
3. `git commit` + `git push origin main`.
4. The systemd timer auto-deploys (~2 min), or force it: `ssh root@159.89.172.210 'cd /opt/arksai && ./deploy.sh'`.
5. Re-run `scripts/deploy-check.sh` to confirm green.

**Env / infra fix (keys, domain, TLS):**
- Edit `/opt/arksai/.env`, then `cd /opt/arksai && ./deploy.sh`. Never commit `.env`.

**NEVER:** commit secrets · `down -v` · bring up the plain stack / `--remove-orphans` on the plain file
(use `./deploy.sh`).

---

## 4. The Canvas bug — likely causes & fixes

The Canvas iframe shows the app via `client/src/components/Canvas.tsx` (it loads the **dev preview**
`/api/sessions/:id/preview/:port/`, and a published app is at `/apps/<slug>/`). Locally both serve
cleanly, so the failure is deployment-specific. The two prime causes:

1. **Mixed content (most likely).** The site is HTTPS; if the served app references any asset/script as
   `http://…` (a hardcoded URL, an http CDN, or a rewrite that emitted `http://`), the browser silently
   blocks it inside the iframe → blank Canvas. **Confirm:** `deploy-check-browser.mjs` will list it as a
   failed request / mixed-content console error. **Fix:** make the rewrite/`<base href>` and any emitted
   URLs protocol-relative or https (`server/src/routes/deployments.ts` `rewriteHtml`, and the preview
   proxy in `server/src/routes/preview.ts`); ensure the agent's generated apps don't hardcode `http://`.

2. **Canvas points at a dead dev-preview port.** After publishing, the dev server the Canvas was framing
   may be gone, but the Canvas keeps loading `/api/sessions/:id/preview/:port/` (which now 502s) instead
   of falling back to the published `/apps/<slug>/` URL. **Confirm:** in the UI, devtools shows the iframe
   src is a `/preview/<port>/` URL returning an error. **Fix (Canvas.tsx):** after a publish/`open_canvas`
   with a deployment, prefer the published `/apps/<slug>/` URL for the iframe; or detect a dead preview
   port and fall back to it.

Run the browser check, read which one it is, apply the matching fix via §3, redeploy, re-check.

---

## 5. Done when

`scripts/deploy-check.sh` is all `✓` (no `✗`), `deploy-check-browser.mjs` reports the app renders in an
iframe, https://arksai.studio loads, operator login works, image generation produces a real image, and a
published app opens in the Canvas. Report what failed, what you changed, and the green re-check.
