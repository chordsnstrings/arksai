# GitHub OAuth — connect a user's GitHub & choose the repo to push to (scope)

**Decisions (locked):** OAuth App (not a GitHub App) · per-USER connection.
Goal: a user connects their own GitHub account, picks (or creates) a repo, and the agent
pushes the generated code there — instead of everything going through the single global
`GITHUB_TOKEN` to `chordsnstrings/arksai`.

## What already exists (reuse it)
- `server/src/connectors/crypto.ts` — `signState`/`verifyState` (HMAC CSRF for the OAuth
  round-trip) + `encryptSecret`/`decryptSecret` (AES-256-GCM via `connectorEncKey`). **Reuse as-is.**
- The OAuth route shape in `routes/connectors.ts` (connect → provider → callback → store),
  redirect-URI builder, admin/auth gating via `scopeOf`. **Mirror the pattern.**
- Push today: `sessions/workspace.ts` `authedUrl()` injects the GLOBAL `config.githubToken`;
  `agent/tools/git.ts` `gitPushTool` pushes `session.repoUrl`. Sessions carry `repoUrl` + branch.
- The ads `connectors` table/`Adapter` interface is **fetchReport-shaped → not reused**; GitHub
  gets its own small module.

## Auth & storage
- Operator registers a **GitHub OAuth App** → Client ID + Secret. Authorization callback URL =
  `${publicBaseUrl}/api/github/callback` (i.e. `https://arksai.studio/api/github/callback`).
  Scopes requested: **`repo`** (push to private+public) + **`read:user`** (identity);
  add `workflow` only if we push `.github/workflows/*`.
- `config.ts`: `githubOauthClientId`, `githubOauthClientSecret`. Feature gated on those +
  `connectorEncKey` (encryption). Absent → dormant with a clear "not configured" message.
- New table **`github_connections`** (per user): `id, user_id, org_id, github_login,
  github_user_id, avatar_url, access_token_enc, scopes, status, created_at`. Unique on
  `user_id` (one GitHub per user; reconnect replaces). Token AES-256-GCM at rest. Classic OAuth
  tokens don't expire → no refresh path needed (add later only if we enable expiring tokens).

## Routes — `server/src/routes/github.ts` (all auth'd to the current user)
- `GET /api/github/status` → `{ enabled, connected, login, avatarUrl }`.
- `GET /api/github/connect` → signed `state{userId,orgId,nonce}` → redirect to
  `github.com/login/oauth/authorize?client_id&redirect_uri&scope=repo read:user&state`.
- `GET /api/github/callback` → verify state → POST `github.com/login/oauth/access_token`
  (exchange `code`) → `GET api.github.com/user` (identity) → save encrypted connection for
  THAT user → redirect `/?github=connected`.
- `GET /api/github/repos?query=` → with the user's token, `GET /user/repos?affiliation=owner,
  collaborator,organization_member&sort=updated&per_page=100` (cap/paginate), optional name
  filter → token-free `[{fullName, private, defaultBranch, pushedAt}]`.
- `POST /api/github/repos` → `{name, private, org?}` → `POST /user/repos` (or `/orgs/{org}/repos`)
  → `{cloneUrl, defaultBranch}`.
- `DELETE /api/github/connection` → delete the row (+ best-effort revoke the grant).
- **Isolation:** every route resolves the connection by the authenticated `userId`; a user can
  never read or push with another user's token.

## Repo selection → session
- `shared/types.ts`: add `session.githubConnectionId?`. (Session already has `repoUrl` + `branch`.)
- **NewSessionDialog** gets a "Push target": not-connected → "Connect GitHub"; connected →
  searchable repo dropdown (`/api/github/repos`) + "New repo…" (name + private → `POST`) +
  branch. Selecting sets `repoUrl` + `branch` + `githubConnectionId`.
- A per-session "Connect a repo to push to" affordance in the TopBar/Canvas so a user can attach
  a target after the fact, then `git_push` works.

## Push / clone integration
- Add `resolvePushUrl(session)` (async) in `workspace.ts`: if `session.githubConnectionId` is set,
  decrypt that user's token → `https://x-access-token:<token>@github.com/<owner>/<repo>`; else
  fall back to the global PAT (operator self-host). Clone-on-setup uses the same resolver.
- `gitPushTool` calls the async resolver; the token is injected **only for that one exec** and
  **added to the secret-scrub list** so it never appears in command output/logs.

## Security
- Tokens encrypted at rest; never returned by any API (token-free views) and never sent to the
  model. Token injected only for the single git exec + scrubbed from output.
- CSRF via signed `state` (reuse `connectors/crypto`). Strict per-user isolation (red-team tested).
- Least privilege scopes; **document the OAuth-App trade-off**: `repo` grants access to ALL the
  user's repos (a GitHub App would scope to chosen repos — the option we declined for speed).
- Dormant unless the OAuth creds + `connectorEncKey` are set. Operator registers the app, sets
  the two env vars, and rotates them via `secretValues()`.

## Tests
- `github.test.ts` (pure): authorize-URL builder (scope/redirect/state), token-exchange parse,
  repo-list normalize, scrub includes the live token, `resolvePushUrl` chooses user-token vs PAT.
- Red-team isolation: user B cannot read/use user A's connection or push A's session.

## Files
- `server/src/github/oauth.ts` (pure URL/parse helpers), `server/src/github/store.ts` (CRUD,
  encrypted) — reuse `connectors/crypto.ts`.
- `server/src/routes/github.ts` (+ register), `server/src/db/index.ts` (table + index),
  `server/src/config.ts` (creds), `server/src/sessions/workspace.ts` + `agent/tools/git.ts`
  (per-session token + scrub), `shared/types.ts` (`githubConnectionId`).
- Client: `NewSessionDialog` push-target picker + a GitHub card in settings/connections +
  `state/githubStore.ts`. `FEATURES.md` + `WhatsNewModal`.

## Phasing
1. OAuth connect + status + disconnect (account link).
2. Repo list + create + the session push-target picker.
3. Push/clone use the user token (+ scrub) + isolation tests.
- Later: GitHub-App upgrade (per-repo scoping), PR creation, auto-create a repo named after the app.
