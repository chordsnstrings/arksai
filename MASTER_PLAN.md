# ArksAI Master Plan — One‑Shot Quality + Accuracy, Executed Autonomously

> North star: **describe it once → get ONE finished thing that looks perfect, works perfectly, and is live — zero user iteration.** Quality comes from the SYSTEM iterating internally, never from the user. The plan‑gate is the single intentional checkpoint; everything after approval runs to completion on its own.

---

## 0. Principle the recent updates drifted from
Separate **internal iteration** (always invisible — the system loops so the user doesn't) from **user‑facing stops** (only when truly blocked / ambiguous / destructive). The past weeks added user‑facing stops (mandatory plan‑gate, layered clarification) AND left the autonomous build fragile (Next.js→proxy→thrash→budget cutoff ×3). This plan restores autonomy *and* hardens execution, then adds structural accuracy.

---

## 1. Diagnosis (grounded in code — verified live)
1. **Plan‑gate stop** — `prompts.ts` 247‑249/273‑278 + PLAN block 671‑689 hard‑mandate `submit_plan` → turn ends → wait. **KEEP IT** (operator is fine with it *if* execution is flawless).
2. **Publish never builds `node` apps** — `deploy/publish.ts` ~196‑202 runs `npm install --omit=dev` + `next start`, no `npm run build` → "Could not find a production build."
3. **Path‑proxy can't serve SSR** — `routes/deployments.ts rewriteHtml` rewrites HTML attrs + `<base>` + a fetch shim, but Next/webpack inject root‑absolute `/_next/...` chunk URLs in JS → bypass all three → 404→HTML → "Unexpected token '<'".
4. **`NODE_ENV=production` leak** — `Dockerfile` ENV → `childEnv()` → agent `npm install` drops devDeps (token‑wasting loop).
5. **Stall guard too narrow** — `runner.ts` ~818‑829 only catches *identical* repeated batches; missed the varied‑diagnostic thrash → only the budget cutoff stopped it (×3).
6. **DNS clarity (resolved)** — `arksai.studio` zone lives in the operator's *second* DO account (`marketing.gicbd@gmail.com`, 11 domains); droplet is in `gicbdfacebook@gmail.com`. Wildcard **`A *.apps → 159.89.172.210` already added**.

---

## 2. Claude's take — what to improve in the system (beyond the infra fixes)
1. **Accuracy is structural, not hopeful — adopt the grounded‑research loop** (`ARKS_Verification_Loop_Spec.md`). Today "verify vs unverified" is *prompted*; it should be a **gate**. Draft (cheap) → extract atomic claims → search → **adjudicate (strong model)** → revise from the **claim ledger only** → final‑gate re‑extract+diff. Makes confabulated figures/dates/entities *structurally impossible* to ship as fact. **G0‑gated to fact‑sensitive research only; runs internally (no user stops); honest boundary — fixes facts, not ranking** (narrow the judgment gap with M3 self‑consistency §10.3 + rubric §10.4, or route adjudication to the strongest model). Produces a queryable provenance ledger.
2. **Make every internal loop observable + bounded** (the lesson from the robot‑poller fix): verify/publish/research loops should report what they did and stop on a repeated blocker — never silently thrash.
3. **Truthful platform self‑model** — the agent must *know* what the publish environment supports (static/SPA/SSR at a subdomain root; port‑binding servers) so it never thrashes against a real constraint, and never invents a "CDN/platform outage."
4. **Quality‑first model routing stays** — heavy generators on M3 with the concurrency limiter; research adjudication on the strongest model; cheap models for mechanical steps (extract/diff).
5. **The user never iterates** — reaffirmed; all of the above is invisible.

---

## 3. The phases (complete)

**Phase 0 — Safety audit (no code).** Inspect how the droplet fronts TLS for `arksai.studio` today (it serves HTTPS, so something terminates it). Confirm before touching Caddy so the live site can't break. *Exit:* current web/TLS front documented; rollback path noted.

**Phase 1 — Pre‑provision deps (no wasted build tokens).**
- `lib/exec.ts childEnv()` → agent workspace `NODE_ENV=development` (server stays production).
- `Dockerfile` → warm npm cache with the web stack (next/react/vite/tailwind/postcss/autoprefixer/typescript/framer-motion/zustand/lucide-react).
- Publish installs use `--prefer-offline`.
*Exit:* a fresh `npm install` in a workspace pulls devDeps from cache, offline, in seconds.

**Phase 2 — Build `node` apps on publish.**
- `deploy/publish.ts` node path: install **with** devDeps → `npm run build` if present → start cmd → `npm prune --omit=dev`. Surface real build errors to the agent.
*Exit:* a Next app publishes with a real production build; a broken build returns its actual error.

**Phase 3 — Subdomain serving + wildcard TLS (the SSR fix).**
- **Caddy** (un‑park `docker-compose.tls.yml`) terminates TLS, reverse‑proxies to Fastify with `Host`. Wildcard **`*.apps.arksai.studio`** cert via DO **DNS‑01** (the `marketing.gicbd` token), + apex/www.
- `routes/deployments.ts` → **Host‑based root serving**: `<slug>.apps.arksai.studio` → static files at root, or reverse‑proxy to the app's `41xxx` port **at root, no rewrite** (fixes `/_next/` for every framework). Keep `/apps/<slug>/` path serving as fallback.
- `deploy/publish.ts` records `hostname` + returns `https://<slug>.apps.arksai.studio`.
*Exit:* a published Next app loads cleanly at its subdomain over HTTPS — no "Unexpected token '<'".

**Phase 4 — Truthful guidance + anti‑thrash.**
- `prompts.ts:730` → accurate publish guidance (SSR supported via subdomain build; fix code, don't blame platform). Plan‑gate untouched.
- `runner.ts` stall guard → also detect repeated failure of the same heavy op / same error signature → switch strategy or surface the blocker before the budget cutoff.
*Exit:* a forced repeated failure is caught + reported once, not thrashed.

**Phase 5 — Accuracy: grounded‑research loop (Claude's take).**
- New `server/src/agent/research/groundedLoop.ts` implementing G0→draft→extract→search→adjudicate→revise→final‑gate, tool‑call‑channel structure (§10.1), strongest model on adjudicate/revise (or M3 + self‑consistency §10.3 + rubric §10.4), claim ledger persisted, label unverified / surface conflicts / never confabulate. G0‑gated to fact‑sensitive research; runs internally.
*Exit:* the VC‑research prompt returns dated sources, "could not verify," no confabulated figures — verified live.

**Phase 6 — Final validation sweep.** Re‑run the coffee‑store prompt (Next → subdomain, flawless, no stops/thrash) AND the VC‑research prompt (grounded). Update `FEATURES.md` + WhatsNew.

---

## 4. Autonomous execution framework (goals + loops)
Each phase is a **goal** with a self‑validating loop; no user intervention between phases.

**Per‑phase loop:**
1. Implement the phase's changes.
2. **Gate loop:** `npm run typecheck && npm test && npm run build` → if red, diagnose + fix + repeat (bounded; on a repeated identical failure, switch approach).
3. Commit to `main`, push (the operator's standing rule: land on `main`).
4. **Deploy wait:** auto‑deploy is ~2 min — poll the live bundle/health; do not `sleep`‑spin, re‑check on a timer.
5. **Live‑validate** on `arksai.studio` (Playwright/API): exercise the exact behavior the phase fixes (coffee prompt for 1‑4/6; VC prompt for 5).
6. **Self‑correct:** if live validation fails, loop back to step 1 with the observed defect. Bounded retries; if a hard external blocker (e.g., Caddy needs a droplet shell action) → record it and continue with the next independent phase, surfacing the blocker at the end.
7. **Exit criteria met → advance** to the next phase.

**Sequencing (dependency‑ordered, each independently shippable):**
`Phase 0 → Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 6`.
Phases 1, 4, 5 are independent of 3; if Phase 3 hits a droplet‑shell blocker (Caddy), continue 4/5 and report 3's blocker.

**Safety rails (always on):**
- Never break the live `arksai.studio` site/TLS; keep `/apps/<slug>/` path serving during cutover; keep changes behind config flags where feasible (`AUTO_BRIEF`‑style) for instant rollback.
- DNS wildcard already added (additive, no risk).
- Every push must pass typecheck+tests+build first.
- Honest reporting: a phase is "done" only after **live** validation, not local green.

**Stop condition (this goal):** all phases implemented + live‑validated, or any residual blocker is a true external dependency (droplet shell / token) that's clearly surfaced with the exact action needed.

---

## 5. Files
`lib/exec.ts` · `Dockerfile` · `deploy/publish.ts` · `routes/deployments.ts` · Caddy config · `agent/prompts.ts` · `agent/runner.ts` · new `agent/research/groundedLoop.ts` · tests · `FEATURES.md` · WhatsNew.

## 6. Risk & rollback
Caddy is the only production‑risky change (Phase 0 audit gates it). Everything else is additive or flag‑guarded. Rollback = revert the commit (auto‑deploy restores in ~2 min).

## 7. Future tracks
- External hosts (DO App Platform), per‑org custom domains, producer–verifier role split (§10.5).
- **True native mobile (Android + iOS) — own track, not part of this plan.** M3 can *write* native (Kotlin/Compose, React Native/Expo, Flutter); the gap is build + delivery:
  - **Android** builds on Linux (Android SDK + JDK + Gradle → APK/AAB) — addable to the image; needs signing keystore + a Google Play account ($25 one‑time) for store delivery.
  - **iOS** builds **require macOS + Xcode** — *impossible on the Linux droplet*. Needs a Mac builder or a cloud build (Expo **EAS Build** / Codemagic / Bitrise), an Apple Developer account ($99/yr), signing certs + provisioning, and App Store review.
  - **Realistic single path for BOTH:** adopt **Expo (React Native) + EAS Build** — write once in TS, EAS produces the Android APK/AAB *and* the iOS IPA on managed cloud builders (no Mac to own), preview via Expo Go, submit via EAS Submit. Pipeline work: wire the EAS CLI/API + store credentials, deliver binaries (download) or auto‑submit. Verification is on‑device (Expo Go), not the web canvas.
  - **Now:** for "make me a mobile app," default to a first‑class **PWA** (installable, instant, live at the subdomain); treat native as this deliberate track.

## 8. Execution status (autonomous run)
- ✅ **Phase 1** (NODE_ENV devDeps leak), **Phase 2** (build any node stack on publish), **Phase 4** (truthful publish + anti‑thrash *prompt*), **Phase 5** (grounded‑research loop — structural core + 9 tests) — implemented, gated (492 tests), shipped to `main`.
- 🔒 **Phase 3 (subdomain TLS) — careful droplet deploy required (can't validate blind).** DNS wildcard `*.apps → droplet` is live. Remaining: a `*.apps.arksai.studio` Caddy site. Cleanest with the already‑running stock `caddy:2` = **on‑demand TLS** (no custom image / DO token): add a `*.apps.arksai.studio` block with `tls { on_demand }`, a global `on_demand_tls { ask http://arksai:3000/internal/tls-check }`, reverse_proxy `arksai:3000`; add a Fastify `ask` endpoint that 200s only for valid deployment hostnames + Host‑based root serving (additive — safe to land). This is NOT auto‑deployed blind (a bad Caddyfile would drop the live site); it needs a deliberate `./deploy.sh tls` + cert‑issuance check on the droplet.
- ⏭ **Follow‑ups (need a model key + live runs):** Phase 5 live wiring (`deps.llm`→MiniMax adapter, `deps.search`→web_search, invoke on the research family behind a flag) + Phase 6 live validation (coffee prompt → subdomain; VC prompt → grounded). The runner‑level anti‑thrash backstop (C1) is a careful core‑loop refinement, intentionally not rushed.

---

*Operator follow‑ups: rotate both DO tokens + the mailbox password pasted in‑thread once execution completes.*
