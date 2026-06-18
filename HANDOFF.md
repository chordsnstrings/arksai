# ArksAI — Session Handoff (read this first)

You have **SSH access to the production Droplet** and the repo is at latest `main`.
Work top-to-bottom: fix the live outage first, then resume normal development.
(Background: read `CLAUDE.md` for full project memory and `FEATURES.md` for the feature list.)

---

## 🚨 1. THE LIVE SITE IS DOWN — fix this before anything else

**Symptom:** https://arksai.studio is unreachable and operator login fails.

**Root cause:** During a manual MiniMax-key setup, a `docker compose down --remove-orphans`
deleted the **Caddy** container — the HTTPS/TLS reverse proxy that serves arksai.studio.
The app was then brought up with the *plain* `docker-compose.yml` (port 80, no TLS). Because
`COOKIE_SECURE=true` and the site is HTTPS-only, the domain is down and the auth cookie can't
be set → "can't log in as operator." The app process itself is fine; only the TLS front door is gone.

**The fix (one command over SSH):**
```bash
ssh root@159.89.172.210 'cd /opt/arksai && ./deploy.sh'
```
`deploy.sh` reads `SITE_ADDRESS=arksai.studio` from `.env` → TLS mode → stops the conflicting
stack → brings up **arksai + Caddy** together → health-checks.

**Verify:**
```bash
ssh root@159.89.172.210 'cd /opt/arksai && docker compose -f docker-compose.tls.yml ps'
#   → arksai-arksai-1 AND arksai-caddy-1 both "running"
curl -sI https://arksai.studio | head -1     #   → HTTP/2 200
```
Then load https://arksai.studio and confirm operator login works.

**Data is 100% safe** — it lives on the `arksai-data` *named volume*; `docker compose down`
(without `-v`) never touches named volumes. Nothing was lost.

---

## 2. SSH + infra access

- **Droplet:** DigitalOcean, project "ARKS AI Platform", droplet `arksai` (id 577088981),
  public IP **159.89.172.210**, app dir `/opt/arksai`. Connect: `ssh root@159.89.172.210`.
  Test first: `ssh root@159.89.172.210 'hostname && uptime'`.
- A **DigitalOcean API token** also exists (account gicbdfacebook@gmail.com). Note: the DO API
  manages infrastructure (reboot/snapshot/resize/DNS) but **cannot run shell commands inside a
  Droplet** — SSH is the automation path. The token is only needed for infra actions.
- **Rotate** the SSH exposure + the DO token + the MiniMax key once stable — all were shared in
  chat, so treat them as exposed.

---

## 3. One cleanup on the Droplet (non-urgent)

`/opt/arksai/.env` has the `MINIMAX_API_KEY` line **twice** (appended during the fix; harmless,
last one wins). Dedupe + restart:
```bash
ssh root@159.89.172.210 "cd /opt/arksai && cp .env .env.bak && awk '!(/^MINIMAX_API_KEY=/ && s++)' .env > .env.tmp && mv .env.tmp .env && ./deploy.sh"
```

---

## 4. MiniMax key — the image-generation unblock (now set)

Image generation, vision, and **ArksAI Max / M3** all use **MiniMax** — a separate provider
and key from DeepSeek (which powers text / "ArksAI Pro/Flash"). The Droplet was missing
`MINIMAX_API_KEY`, which is why image generation failed with "unknown tool generate_creative".
It is **now set** in `/opt/arksai/.env` (an `sk-cp-…` Subscription key). The server's boot log
makes this self-evident:
```
[capabilities] text (DeepSeek): enabled · image generation + vision + ArksAI Max/M3 (MiniMax): enabled · web search: enabled
```
Check it: `ssh root@159.89.172.210 'cd /opt/arksai && docker compose -f docker-compose.tls.yml logs --tail=80 arksai | grep -i capabilit'`.
(Must be `sk-cp-…`; a pay-as-you-go `sk-api-…` key returns `insufficient_balance`.)

---

## 5. Going forward — normal commit → auto-deploy

Once `deploy.sh` has run once, it pulls latest `main` (including the auto-deploy fix) onto the
box and the systemd timer resumes normal operation:
**push to `main` → ~2 min → live on https://arksai.studio (TLS), automatically.**

The auto-deploy bug that caused this outage is fixed: `scripts/autodeploy.sh` previously chose
the stack by *"is the Caddy container running?"* (so a stopped Caddy stranded the site on plain
HTTP forever). It now delegates to `deploy.sh`, which picks the stack from `SITE_ADDRESS` in
`.env` — a stopped Caddy can never silently downgrade TLS again. (Tradeoff: each auto-deploy now
does a brief `down → rebuild → up` instead of a rolling swap — a few seconds' blip per commit.
Optional follow-up: rolling rebuild on the same stack, only downing the other stack when
actually switching plain↔TLS.)

---

## 6. Development state (all on `main`, working tree clean, ~256 tests green)

Latest commits (newest first): auto-deploy TLS fix · boot capability log · legal→M2.7 routing ·
vision-fetch bounding · catalog integrity (88 plays) · image-tools-always-present · image-gen
escape-hatch removal · M3 headers-hang fix.

This session's arc:
- **Image generation fixed end-to-end.** The marketing persona had a "fall back to a CSS/SVG
  graphic" escape hatch the model took on *any* error, claiming "no image tool" and switching to
  code. Removed it; `generate_creative`/`generate_image` are now always in the toolset with a
  clear "key not configured" error instead of "unknown tool"; the real root cause was the Droplet
  missing `MINIMAX_API_KEY` (now set). Verified live — real creatives generate.
- **Legal → M2.7-highspeed (live-proven).** On a long bilingual UAE contract, M3 produced a
  34-char stub and froze; M2.7 produced a complete 24k-char bilingual document. `createMinimaxStream`
  now routes `legal.*` to the fast model in all modes.
- **M3 hang fixed.** The response-headers `await` is raced against the stall deadline (undici's
  `ac.abort()` doesn't reject a pending header-wait, so it hung at 0 tokens). Verified live: a 50ms
  deadline rejected a real M3 call in 52ms → falls back to DeepSeek. Vision (`analyzeImage`) got
  the same bounding (it had frozen a verify gate for 11 minutes).
- **Hardening:** HTTP input validation (malformed JSON / wrong-typed → clean 4xx, never 500),
  accessibility (every dialog form control labeled), Arabic-filename downloads (RFC-6266 +
  injection-safe), session-list perf (stop hauling the full transcript on every list), SSRF-via-
  redirect, non-leaking 5xx error handler, boot capability log.
- **Live deliverable audit (~13 types end-to-end, all PASS):** web app, BI dashboard, formula
  `.xlsx`, `.docx`, PDF report, charts, marketing creative image, `.pptx` deck, compliance
  `.sif`/PINT-AE `.xml`/FAF `.csv`, VAT-201 working paper, bilingual legal contract, published
  static site. Bugs found + fixed (chart "undefined" legend; `.pptx` hand-rolling → steered to
  `generate_pptx`).

---

## 7. Pending / next steps

- **Grade the in-flight audit batch:** `scripts/audit/out/` has fresh runs (sales.proposal,
  people.jd, bi.scorecard, finance.boardupdate) that completed but weren't graded — render the
  PDFs (mupdf), re-open the docx/xlsx, screenshot the web apps, eyeball quality.
- Optionally continue the exhaustive ~80-play audit (every TYPE is validated; remaining work is
  per-play breadth across the shared generators/gates).
- Zero-downtime auto-deploy refinement (see §5).
- Keep `FEATURES.md` + `client/src/components/WhatsNewModal.tsx` current per project rules.

---

## 8. Standing rules (full detail in CLAUDE.md)

- Repo `chordsnstrings/arksai` is **PUBLIC** — **never commit a secret** (it gets scraped +
  auto-revoked). Secrets live only in `/opt/arksai/.env` (prod) and the gitignored local `.env`.
- **Commit to `main`** — it auto-deploys. Gate every change on `npm run typecheck && npm test &&
  npm run build` (all green).
- Don't put the model identifier in commits/PRs/code.
- Verify, don't guess — the operator runs models newer than the training cutoff (MiniMax M3).
