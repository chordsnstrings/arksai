# Private-data connector scope (parked)

> **Status:** PARKED on 2026-06-21 — written up, intentionally NOT built yet.
> **Revisit by: 2026-06-28** (the "remind me in 7 days" marker).
> Context: we paused this to pivot toward a standing/agentic-AI runtime first.
> The two are coupled — see the last section.

## What already exists to build on
- **`fetchPublic`** (`server/src/lib/web.ts`) — SSRF-guarded HTTP client; **`fetch_data`** (`tools/data.ts`)
  uses it for **public** URLs only, no credentials.
- **Token-vault primitive, sketched** — `config.ts` already has an AES-256-GCM key "to encrypt
  connector OAuth tokens at rest" + a public base URL "used to build OAuth redirect URIs."
- **Two ad-platform connectors half-scaffolded** — `GOOGLE_ADS_CLIENT_ID/SECRET/DEVELOPER_TOKEN`
  and `TIKTOK_CLIENT_SECRET` config gates. (Direction chosen earlier = marketing ad-platforms first.)
- Everything else below is greenfield.

## The connectors that matter, by department
**Foundation — everyone (build first)**
- Google Workspace (OAuth): private Sheets, Drive, Docs, Gmail, Calendar. *Highest value.*
- Microsoft 365 / Graph (OAuth): Excel, OneDrive, SharePoint, Outlook, Teams.
- Slack (OAuth app): read channels, post deliverables.
- Notion / Airtable (OAuth or API key): lightweight team databases.

**Finance / Tax / BI**
- Accounting: QuickBooks, Xero, **Zoho Books** (UAE) — OAuth.
- Direct DB / warehouse: Postgres, MySQL, BigQuery, Snowflake (connection string / service account).
- Payments: Stripe (API key). ERP (NetSuite/Odoo/SAP) = heavy, later.

**Sales / RevOps**
- CRM: Salesforce, HubSpot, Pipedrive, Zoho CRM (OAuth). *The sales data itself.*

**Marketing (already started)**
- Ad platforms: Google Ads (scaffolded), Meta Ads, TikTok Ads (scaffolded), LinkedIn Ads.
- Analytics: GA4, Search Console. Email/CRM: Mailchimp, Klaviyo, HubSpot.

**People & Ops**
- HRIS / payroll: BambooHR, Rippling, **Deel** (UAE/remote), Gusto, Workday. ATS: Greenhouse, Lever.

**Engineering**
- GitHub/GitLab, Jira/Linear, Sentry. (GitHub MCP pattern already proven in-session.)

**Legal (per the UAE legal plan)**
- DocuSign / e-signature, contract repositories, and the gov rails already named: UAE Pass e-notary,
  MOEC, courts (Tier-1/2/3 filing).

## The honest cost — it's N integrations, not one feature
Each connector = its own **auth method** (OAuth 2.0 / API key / connection string) + **provider app
registration & review** (Google/Microsoft/Meta verification can take weeks) + **its own API client,
data model, rate limits, pagination**. Work = auth + governance + N clients.

## Strategic shape
A small set covers ~80% of SMB reality: **Google Workspace + Microsoft 365 + Slack + one CRM (HubSpot)
+ one accounting tool (Zoho/QuickBooks) + a raw SQL/Sheets connection.** UAE-weighting: Zoho, Deel,
UAE Pass.

## Coupling constraint (why this waits on auth/isolation)
The moment we hold a customer's private OAuth token, **per-user auth, the encrypted vault, and
org-scoping stop being "Phase 3 nice-to-have" and become prerequisites** — you can't store a company's
Drive/CRM token behind a single shared `APP_PASSWORD`. And a **standing/agentic agent acting
autonomously with those credentials** makes the host-isolation gap blocking too. So: connectors ride
on (a) per-user auth + token vault and (b) the agent sandbox. Sequence accordingly.
