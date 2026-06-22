# ArksAI — Android Apps Section (durable build plan)

> Goal: a dedicated **Android Apps** surface where a non‑technical user describes an app and gets **one finished thing** — a real installable **APK** + its **live backend** + an instant phone preview — built on **our own infra** (ephemeral DO build droplet ≈ $0.10/build). Every app is **minimal, modern, aesthetically pleasing** (a bundled mobile UI kit) and **crash‑safe**. Covers the full range: a small **QR scanner** to a large **Tinder‑style** app.

## Locked decisions (recommended approach — approved)
- **Client:** React Native + **Expo** (TypeScript). Web‑target preview in Canvas, future iOS on the same codebase, builds to APK via Gradle.
- **Backend:** node **Fastify** + DB (SQLite dev → managed Postgres), published on the existing pipeline at `<slug>.apps.arksai.studio`.
- **Android build:** **ALWAYS on our own ephemeral DO droplet** (`s-4vcpu-8gb`) from a pre‑baked Android‑SDK **snapshot** — `expo prebuild` + Gradle `assembleRelease`; create→build→destroy; never the live droplet. **NEVER via EAS / `expo build`** — Expo's cloud build is **Apple‑only** (see iOS below). (The client is still Expo/RN — one codebase; Android just builds locally with Gradle, not through EAS.)
- **Artifacts:** stored **on the droplet** + served via a download route (no DO Spaces / no extra keys needed); APKs are ~20–50 MB with a TTL+cleanup. (Spaces remains an optional future upgrade.)
- **DO access:** authorized for THIS project — build droplets, snapshot bake, and SSH key are created/destroyed via the DO API in the droplet's account (`gicbdfacebook@gmail.com`).
- **Push:** deferred to Phase 4 (FCM).
- **Hosting backend:** reuse the existing publish/subdomain pipeline.
- **iOS / Apple:** built via **EAS (Expo cloud build) ONLY** — macOS is required and EAS provides it. Separate later track, same RN codebase. **EAS is used for Apple ONLY; Android never touches it.**

## Architecture
1. **Monorepo per app:** `/app` (Expo/RN) + `/server` (Fastify API + DB) + `/shared` (types). Client wired to the backend's live URL (typed API client + auth).
2. **Backend auto‑generated when needed** (auth / multi‑user / persistence → yes; calculator / single‑player → no).
3. **Build pipeline:** app finished → create droplet from snapshot (boots ready ~60s) → push source → `expo prebuild` + `./gradlew assembleRelease` (signed) → pull APK → upload to Spaces → **destroy droplet**. Guaranteed teardown (`finally`) + **orphan reaper** (destroy `arksai-build`‑tagged droplets >30 min) + hard timeout. ≈ $0.10/build.

## Aesthetics — mobile UI kit (non‑negotiable quality)
- New bundled **`server/assets/mobile-ui-kit/`** (RN): design **tokens** (color/spacing/type scale/radius/motion), **components** (Button, Card, Input, ListItem, Tab/BottomNav, Avatar, Sheet, EmptyState, Skeleton), and **themes** — the *same* minimal/modern/typography‑first philosophy as the web kit, adapted to mobile (safe‑area, 8pt grid, system‑native feel, tasteful motion). An **`add_mobile_ui_kit`** tool installs it; app builds compose from its patterns (never default RN look).
- **Backend quality standard:** typed, RESTful, input validation, consistent error envelope, auth middleware, migrations — clean and minimal, mirroring the front‑end's polish.

## "Any app" — capability‑aware scaffolding
Intake classifies the app's needs and wires the right **Expo modules + backend capabilities**:
- **Device:** camera (QR/photo), location/maps, notifications, media library, biometrics, haptics.
- **Backend:** auth, data model/CRUD, realtime (chat/matching via WebSocket), media/image storage (Spaces), search/geo, payments‑stub.
- **Complexity tiers:** small (QR scanner = camera + a result screen, no backend) → large (Tinder = auth + profiles + geo + swipe/matching + realtime chat + media upload + push). The same pipeline builds both; the scaffold scales.

## Crash‑safety (must "run smoothly, not suddenly crash")
- App‑level **Error Boundary** + safe navigation + defensive data handling + loading/empty/error states everywhere.
- **Gate before an APK is built:** the app must boot cleanly in the **web‑target preview** (no uncaught errors — existing Chromium gate), the **backend must pass its smoke test**, and the **build must compile**.
- **Optional emulator smoke test** on the build droplet (it has the SDK): boot the APK in an Android emulator, assert it launches without crashing, before delivery.

## The section UI
- Distinct sidebar surface "Android Apps". Mobile intake (purpose, screens, auth?, data, device features, branding). Workspace: live **Expo‑web preview in Canvas** + **Expo Go QR**; **Backend panel** (URL, model, endpoints, logs); **Build panel** (Build APK → create→build→destroy progress → download + history + per‑build cost).

## Phases (autonomous, each gated + live‑validated)
1. **Section + RN/Expo scaffolding + mobile UI kit + in‑Canvas web preview + Expo Go QR** — software only, no infra, no accounts. *(fully autonomous + operator‑testable)*
2. **Backend auto‑gen + auto‑publish + client wiring** (auth/DB/storage + e2e verify) — reuses the shipped pipeline. *(autonomous + operator‑testable)*
3. **Ephemeral Android build pipeline** — snapshot bake + `androidBuild.ts` orchestrator + teardown/reaper/timeout + Spaces upload → **APK**. *(needs the external inputs below)*
4. **Crash gate (emulator smoke) + release signing/keystore + Play Store submit.**
5. **Per‑build cost metering → billing** (your ~$0.10 cost → charge $1–5/build).

## Autonomous execution framework (per phase)
implement → `npm run typecheck && npm test && npm run build` (fix‑loop) → commit to `main` → wait for auto‑deploy → **live‑validate via operator** (create a session in the section, build a sample app, exercise it) → self‑correct on failure → advance. Sample apps used to validate: **QR scanner** (small) and a **Tinder‑style** app (large).

## External deps — now mostly cleared
- ✅ **DO access:** authorized for this project (build droplets + snapshot + SSH key via the API, droplet account). Real spend (~$0.10/build) approved.
- ✅ **Artifact storage:** on the droplet (no Spaces key needed).
- **Remaining (optional):** a real **device** for the final human crash‑confirmation (the automated **emulator smoke test** covers the auto‑check). **Google Play ($25)** only for store submission (not for sideload). **Apple Developer ($99/yr)** only for the later iOS/EAS track.

## Execution reality (honest)
- This is a **large, multi‑session** autonomous build (new section + mobile UI kit + backend generator + build orchestrator + snapshot). It ships **phase‑by‑phase to production** and is validated via operator each phase.
- The build **orchestrator runs on the production server** (it can reach build droplets on DO's network). From the dev sandbox I can trigger + observe via the API/operator, but cannot directly shell into a build droplet — so build‑droplet internals are validated by the server‑side run + the resulting APK, not by me reaching the droplet.

## Progress log / handoff (a fresh session continues from here)
- ✅ **Decisions locked + blockers cleared** (DO authorized; APKs on-droplet; no Spaces/extra creds).
- ✅ **Mobile UI kit foundation** shipped — `server/assets/mobile-ui-kit/` (tokens.ts light+dark+brandTheme, components.tsx Screen/AppText/Button/Card/Field/EmptyState/Loading, ErrorBoundary.tsx, README).
- ✅ **`add_mobile_ui_kit` tool** shipped + registered (installs the kit into an app's src/ui, returns wiring + quality rules).
- ✅ **Phase 1 cont. — `create_expo_app` scaffold tool** shipped + registered. Unpacks a complete runnable Expo/expo-router app (`server/assets/expo-app-template/`: package.json [expo ~52, expo-router, safe-area], app.json [scheme, Android package, `web.output:single` for the Canvas preview], tsconfig/babel, `app/_layout.tsx` wired AppErrorBoundary → SafeAreaProvider → ThemeProvider(brandTheme) → Stack, `app/index.tsx` sample home from the kit) AND drops the mobile UI kit into `src/ui/`. Personalizes name/slug/Android-package/accent. `designSystem.ts` mobile typePack now steers the native flow to `create_expo_app` → `add_app_backend` (not hand-rolled npx). 4 locking tests in `mobileTools.test.ts`.
- ✅ **Phase 2 foundation — `add_app_backend`** shipped + registered (`server/assets/mobile-backend-kit/`: Fastify+SQLite, JWT auth, sample CRUD, error envelope, per-route JSON-schema validation, CORS, idempotent migrations). The backend counterpart of the UI kit.
- ⏭ **Phase 2 cont.:** the **"Android Apps" section** surface (sidebar entry / department, mobile intake, workspace view with Expo-web preview in Canvas + Expo Go QR) + auto-publish wiring + capability-aware intake (camera/location/realtime/etc.).
- ✅ **Phase 3 — build orchestrator** shipped (DORMANT until the one-time snapshot bake). `server/src/build/`: `do.ts` (tiny DO API client — create/get/destroy/list-by-tag), `store.ts` (`builds` table + CRUD; one-time per-build token), `androidBuild.ts` (tars the workspace → token-gated source route → creates a droplet from `ANDROID_SNAPSHOT_ID` with **cloud-init** that pulls source, `npm install`, `expo prebuild`, Gradle `assembleRelease`, POSTs the APK back — **no SSH**; watcher always destroys the droplet (finally) + hard timeout; **10-min orphan reaper** kills any stray `arksai-build` droplet). Routes `routes/builds.ts`: authed `POST /api/sessions/:id/build-apk`, `GET /api/builds/:id`, `GET .../builds`, `GET .../download`; open+token-gated `source`/`artifact`/`fail` for the droplet (allowlisted in `auth.ts`). Config gate `isBuildConfigured()` = `DO_API_TOKEN` **and** `ANDROID_SNAPSHOT_ID` (else 503 "not configured", reaper no-ops). Reaper booted in index.ts. **PWA/web builds unaffected.** One-time bake documented in **`BUILD_BAKE.md`**. 5 tests (`androidBuild.test.ts`).
- ✅ **BUILDER IS LIVE (2026-06-22):** the one-time snapshot bake ran via the server-side `runBake` (operator endpoints) and SUCCEEDED — toolchain verified `RESULT=OK` (Node 20.20.2, JDK 17.0.19, Android sdkmanager 12.0). Snapshot **`233935491`** (`arksai-android-sdk-2026-06-22`, blr1) created, bake droplet destroyed. Builder **activated** (`/api/admin/build/configure` stored the DO token encrypted + snapshot id in `app_settings`; `isBuildConfigured()` true, no `.env`/SSH edit). Bake bugs fixed live: `/fail` sink forced status=error → moved to neutral `/bakelog`; snapshot-list race → retry; direct snapshot-id activation. **DO token is per-build-account `gicbdfacebook@gmail.com`; ROTATE it (was pasted in chat) and re-run configure with the new token (no redeploy).**
- 🔶 **Phase 4 (partial):** the **web crash-gate** is enforced (the existing Chromium boot/error gate + steering "verify the Expo web target boots clean before build_apk"). The **emulator crash-smoke** + **release-signing keystore** are documented as bake-time steps in `BUILD_BAKE.md` but NOT yet wired into cloud-init (the snapshot has the SDK to run an emulator) — implement once the snapshot exists. Then VALIDATE by building a **small (QR scanner)** and a **large (Tinder-style)** app to real APKs via operator → REPORT BACK.
- 🔶 **Phase 5 (metering done; pricing deferred):** per-build **cost is metered** (`ANDROID_BUILD_COST`, recorded on each `builds` row + added to the session cost via `build_apk`/the watcher). **Charging** the user a margin ($1–5/build) is deferred to the billing layer.
- ⏭ **Agent integration shipped:** `build_apk` tool (code mode, available only when configured) lets the agent deliver the APK in-chat after the web gate; the mobile typePack steers create_expo_app → add_app_backend → web-gate → build_apk. The standalone **"Android Apps" section UI** (sidebar surface + build panel + Expo Go QR) is still optional polish — the seamless-chat flow already delivers via the agent.

## Honest limits
- APK build latency is **minutes** (preview is instant; APK builds in the background).
- iOS is a separate later track (EAS, ~$2/build + Apple account).
- **The one remaining gate to LIVE APKs is the one-time snapshot bake** (`BUILD_BAKE.md`) + setting `DO_API_TOKEN`+`ANDROID_SNAPSHOT_ID` in `/opt/arksai/.env`. ALL the code (scaffold → kit → backend → orchestrator → reaper → routes → build_apk tool) is shipped and gated (502 tests), but stays **dormant** until that env exists. I (from the sandbox) **cannot bake the snapshot, SSH a build droplet, or crash-test a real APK** — so the final done-condition (a small + a large APK built and verified crash-free) needs the bake first, then an operator/live run. Until then PWA/web is the delivered mobile app and nothing about it changed.
