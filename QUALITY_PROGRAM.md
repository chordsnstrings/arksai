# Quality Program — the path to 9/10 on everything (2026-07-02)

The honest-audit scorecard (vs Claude as the 10-reference) and, per area: what shipped today,
what's next, and what only the operator can unlock. Priorities per the operator: **pipeline
reliability and user experience first.**

## 0 · The judgment bake-off that reshaped routing (run live, 2026-07-02)
Three real-incident scenarios (provider decline + "I need it exactly as is"; the same tool error
twice; the bare "make me an image") against glm-5-1, kimi-k2-5, deepseek-v4-pro, seed-2-0-pro on
the live BytePlus coding endpoint:
- **seed-2-0-pro won decisively**: the ONLY model that answered "make me an image" correctly
  (clarify → "I'll generate it immediately") — GLM-5.1 and Kimi both reproduced the deployed
  "I can't create images, use Canva/Midjourney" hallucination verbatim. Best repeat-error answer
  (fixes the root cause itself; the others "escalate to IT"). Fastest (3.5–8s).
- Nobody coached safety-check evasion unprompted (the deployed "obscure the face" improv was a
  Flash turn) — but ALL models over-refused scenario A, proving that knowledge of the legitimate
  path must live in OUR tool notes, not the brain.
M3 could not be probed from the sandbox (no key here); it remains the chat-heavy/report engine.

## 1 · Chat / routing / judgment — 5.5–6.5 → target 9
**Shipped today**
- Chat light/standard re-routed **Flash → Swift (seed-2-0-pro)** on the bake-off data; heavy chat stays M3.
- A global **Judgment & failure handling** block in EVERY mode's prompt: read/quote the actual
  error; classify (my-call vs provider-decline vs truly-absent); NEVER coach evading a safety
  check; never claim a toolset capability doesn't exist; never recommend Canva/Midjourney/etc.;
  same-error-twice = wrong diagnosis; fix root causes yourself instead of "contact IT".
- **Repeat-error circuit-breaker** in the runner: an identical tool error twice appends a
  [SYSTEM] nudge to the tool result itself — the only intervention all models respond to.
- **Subsystem-aware complexity routing**: stacked subsystems (multi-tenant/auth/orgs/invites/
  isolation/realtime/billing…) + enumerated-requirements briefs now score HEAVY (the TaskForge
  brief mislabeled "a moderate task" is a locked regression test).
**Next**
- Judgment-moment floor: the turn AFTER a failed tool call never runs on a light model.
- A weekly judgment regression cron: replay the 3 scenarios against the live routing, alert on drift.

## 2 · Pipeline reliability — 7 → target 9 (operator priority)
**Shipped today**
- **BytePlus stall ladder** (the TaskForge killer): silent stream → retry → switch to Kimi →
  retry → M3 → only then terminal. Nothing is committed mid-turn, so recovery is free.
- **CONTRACT.md** (contract-as-artifact): big builds write `.arksai/CONTRACT.md` (exact API
  response shapes, field naming, entities, auth, seed credentials, ports) BEFORE step 1; the
  checkpoint resume note injects it verbatim — kills the cross-window drift class (the
  snake_case/camelCase parallel-implementation arc).
**Next**
1. **Resume inventory**: on resume, inject a one-shot workspace inventory (file tree +
   checkpoints + listening ports) so re-discovery is 1 turn, not 10.
2. **Port/process hygiene**: a preflight that reports/reaps the session's own zombie dev
   servers at resume (the EADDRINUSE turn-burner).
3. **Daily canary cron**: an automated small build + report + image through the LIVE product
   with alerting — breakage reports itself instead of the operator finding it.
4. **Server supervisor** on the droplet (auto-respawn; the AUDIT P0 mitigation).

## 3 · User experience — target 9 (operator priority)
Shipped this arc: live Build-plan trail, stall recovery lines, in-chat video player,
Video studio (presets+icons, sequencer, product mode, character), friendlier failures.
**Next**
1. **"Continue this build" button** on an errored/stopped session (today you type it).
2. **Completion push**: notify (email/webhook/WhatsNew badge) when a long build or scheduled
   run delivers — the away-from-keyboard moment is currently silent.
3. **Mobile polish pass** on the studio + chat surfaces (operator drives from a phone).
4. **Cost preview** per deliverable type before a heavy run starts.

## 4 · Web apps — 7.5–8 → 9
- CONTRACT.md + heavy-routing fix (shipped) address the two real failure classes observed.
- Next: **full-stack scaffold** — extend `create_web_app` with a pre-wired auth+orgs+API
  template (Express mergeParams, JWT, invite codes, org isolation middleware all correct by
  construction — every TaskForge backend bug was template-preventable). Per-step gate: verify
  each checkpoint step, not only the end.

## 5 · Reports — 8.5 → 9  |  Decks — 8 → 9
- The remaining delta is COPY/interpretation. Add a bounded **copy-polish turn** (M3, report
  gate round 0): headlines, ledes, the counter-intuitive reframe — cents per deliverable.
- Decks: more `generate_pptx` layout variants; the same headline-punch pass.

## 6 · Sheets — 8 → 9  |  Docs/legal — 7.5/8.5 → 9
- Sheets: scenario tabs (best/base/worst) added to the FIN_SHEET standard; formula audit gates already.
- Docs: embed the editorial fonts in .docx (the standing P2). Legal: add a statute-citation
  cross-check pass (persona already cites; verify article numbers against a curated list).

## 7 · Images/creatives — strong vs market → 9
- **Operator unlock: activate Seedream on the BytePlus console** (probe 2026-07-02: not on this
  account) — native text-in-image + editing removes the compositing constraint entirely.
- Next: multi-candidate generation + vision-pick (generate 2, keep the cleaner).

## 8 · Video — 8 → 9
- **Operator unlock: activate OmniHuman 1.5** (official BytePlus, probe: not activated) —
  film-grade talking humans (photo+audio), the best-in-class presenter path; chain with TTS.
- Next: ffmpeg in the Dockerfile → auto-QC drafts (extract 3 frames → vision review before the
  user sees it); EXIF orientation normalization on uploads; live-verify last_frame/reference
  end-to-end renders (roles are API-accepted; full renders pending).

## 9 · Android / Robots
- Android: emulator crash-smoke (Phase 4) + signing; Play direct upload next.
- Robots: live-verify the email loop with a real mailbox (still the standing gap).
