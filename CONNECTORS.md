# Ad-platform connectors (Meta · Google Ads · TikTok)

Connect a customer organization's ad accounts so the agent can pull **live** performance
into dashboards and reports via the `fetch_ads` tool. Connections are **per-org**, OAuth-based,
and tokens are stored **encrypted** (AES-256-GCM). Users connect in **Settings → Connections**
(org admins only); the agent then calls `fetch_ads` on demand.

## How it works
- `connectors` table (org-scoped) holds encrypted access/refresh tokens per connected ad account.
- `GET /api/connectors/:provider/connect` → provider OAuth consent → `…/callback` exchanges the
  code, resolves the accessible ad accounts, and stores one connector per account.
- `fetch_ads` (agent tool) finds the org's active connector, refreshes the token if expired, hits
  the provider's reporting API, and returns normalized rows (spend, impressions, clicks, ctr, …).
- Each provider lights up only when its app credentials AND a token-encryption key are set.

## Required env (set in `/opt/arksai/.env`, never commit)
```
CONNECTOR_ENC_KEY=<any long random string>      # REQUIRED — encrypts tokens at rest
PUBLIC_BASE_URL=https://arksai.studio           # used to build OAuth redirect URIs (HTTPS)

# Meta (Facebook/Instagram) Ads
META_APP_ID=
META_APP_SECRET=

# Google Ads
GOOGLE_ADS_CLIENT_ID=
GOOGLE_ADS_CLIENT_SECRET=
GOOGLE_ADS_DEVELOPER_TOKEN=

# TikTok Ads
TIKTOK_CLIENT_KEY=
TIKTOK_CLIENT_SECRET=
```
Optional version pins (defaults are sensible; bump if a provider deprecates): `META_API_VERSION`,
`GOOGLE_ADS_API_VERSION`, `TIKTOK_API_VERSION`.

## Per-platform setup + the redirect URIs to register
The OAuth **redirect URI** each provider must whitelist is:
`https://<PUBLIC_BASE_URL>/api/connectors/<provider>/callback`
e.g. `https://arksai.studio/api/connectors/meta/callback`.

### Meta — developers.facebook.com
1. Create an app (Business type) → add the **Marketing API** product.
2. Request permissions **`ads_read`** + **`business_management`** → submit for **App Review**
   and complete **Business Verification** (the long pole; ~2–5 business days).
3. Add the redirect URI above under Facebook Login → Settings → Valid OAuth Redirect URIs.
4. Put the App ID / App Secret in env.

### Google Ads — Google Cloud + Google Ads
1. Cloud project → OAuth consent screen (External) + OAuth **client (Web app)**; add the redirect URI.
   Scope: `https://www.googleapis.com/auth/adwords` (sensitive → consent-screen verification).
2. In a Google Ads **Manager (MCC)** account → API Center → get a **developer token**; apply for
   **Standard Access** (Basic/test access is limited).
3. Put client id/secret + developer token in env.

### TikTok — TikTok for Business / developers.tiktok.com
1. Create a Marketing API app → get **client key/secret**; add the redirect URI.
2. Pass **app review** + the **data-security compliance audit**, and onboard a Business Center
   (the most gated of the three).
3. Put client key/secret in env.

## Notes
- **HTTPS is mandatory** for all three redirect URIs (✓ arksai.studio serves TLS).
- For multi-tenant B2B, each customer authorizes **their own** ad account through the consent
  screen — your apps must be **approved/public**, not in test/sandbox mode.
- Tokens never appear in agent output (added to `secretValues`); the `fetch_ads` tool only ever
  returns aggregated/normalized numbers.
- Adding another platform = one new adapter implementing the `Adapter` interface in
  `server/src/connectors/` + a registry entry; the framework (storage, OAuth routes, refresh, the
  tool, the UI) is shared.
