# BDT currency + Org wallet / invoicing — plan

Two related pieces: (A) show costs in **BDT** (a *floating* currency) honestly, and (B) an
**org wallet** (prepaid balance) with admin top-ups and a usage ledger, built so PayPal/Stripe
slot in later. **Decisions (locked):** operator-set BDT rate now (live-feed-ready) · wallet is
**USD-canonical**, BDT shown as an indicative conversion · **observe-first** enforcement
(record, don't block, during the BD pilot).

---

## The principle that ties it together
**USD is the canonical accounting unit.** All provider costs are already computed/stored in USD
(`shared/currency.ts`: "all costs are computed and stored in USD"). The wallet balance, top-ups,
charges and invoices all settle in **USD**. BDT (and any non-pegged currency) is a **display-only,
clearly-stamped estimate** — never presented as exact — because a floating rate can't be. That's
the "clearer picture": one true number (USD), plus a transparent BDT figure with its rate + date.

---

## PART A — BDT (floating) display

### Today
`shared/currency.ts` only supports **fixed-peg** currencies (USD + GCC), each a hardcoded `rate`
(units/USD). It says non-pegged currencies "would need a rate feed before they can be added
safely." BDT floats (~118–123/USD), so a hardcoded constant silently drifts.

### Changes
1. **`shared/currency.ts`**
   - Add `pegged: boolean` to `CurrencyDef` (GCC + USD = `true`).
   - Add `BDT: { code:'BDT', symbol:'৳', rate:122, name:'Bangladeshi Taka', pegged:false }` — the
     `rate` here is only a **fallback default**; the live value comes from the operator-set store.
   - `convertFromUsd`/`formatMoney` gain an **optional `rateOverride`** param so the server can
     pass the resolved (operator-set) rate; with no override they use the table default (keeps the
     module pure + back-compatible).
2. **`server/src/lib/fx.ts`** (new) — the rate resolver for non-pegged currencies:
   - `getRate(code) → { rate, asOf, source }`. Pegged codes return the fixed table rate
     (`source:'peg'`, no date). Non-pegged: read `app_settings` key `fx.<code>` (operator-set) →
     else the table fallback. (Phase-2: a daily live-FX fetch cached here, same shape.)
   - `setRate(code, rate, byUserId)` — superadmin sets it; stamps `asOf = now`.
   - Stored in the existing **`app_settings`** table (already used for build config) — no new table.
3. **Surfacing the basis (honesty):** anywhere BDT is shown, append the basis —
   `৳128.40 · 1 USD = ৳122 (24 Jun)` — via a small `formatMoneyWithBasis(usd, code, rate)` and a
   tooltip; the canonical **USD is shown alongside** for BDT/non-pegged orgs.
4. **Admin:** the currency control (Admin → org settings) — when a non-pegged currency is picked,
   show the current rate + "as of", an operator field to **update the rate**, and an "indicative"
   note. Selecting BDT just sets `orgs.currency='BDT'` (existing `updateOrgCurrency`).
5. **Tests:** `pegged` flag; BDT conversion with an override rate; `৳` formatting; `fx.getRate`
   fallback chain (app_settings → table default).

---

## PART B — Org wallet + invoicing

### Data (integer **micro-USD** = USD×1e6, so no float drift on money)
- **`org_wallets`**: `org_id PK, balance_micros BIGINT NOT NULL DEFAULT 0, updated_at`. (A cached
  balance; always reconcilable as `SUM(ledger.amount_micros)`.)
- **`wallet_ledger`** (append-only, the invoice/statement source of truth):
  `id, org_id, ts, type('topup'|'usage'|'adjustment'|'refund'), amount_micros (signed: + credit,
  − debit), balance_after_micros, source('manual'|'stripe'|'paypal'|'system'), ref, note,
  created_by`. Indexes on `(org_id, ts)`. `ref` = session/run id for usage, external txn id for a
  gateway — so a Stripe/PayPal webhook later writes the same row shape.
- A single **`creditOrg(orgId, micros, {source, ref, note, by})`** / **`debitOrg(...)`** core does
  the atomic `INSERT ledger + UPDATE balance`; **idempotent on `(org_id, source, ref)`** so a retry
  or a re-fired `run_finished` never double-charges.

### Top-up (admin) — payment-gateway-ready
- `POST /api/admin/orgs/:id/wallet/topup { amount, currency?, note }` (superadmin-gated, like the
  existing `/api/admin/orgs`). `amount` may be entered in USD or the org's currency → converted to
  USD micros at the current rate → `creditOrg(..., source:'manual')`.
- `GET /api/orgs/:id/wallet` → `{ balanceUsd, balanceDisplay, currency, rate, asOf }` (org-admin
  sees own; operator sees any — same `canSeeOrg` gate as analytics).
- `GET /api/orgs/:id/wallet/ledger?limit=` → the statement (token-free).
- The top-up endpoint is the **same `creditOrg` chokepoint** a future `POST /api/payments/webhook`
  (Stripe/PayPal) will call with `source:'stripe'|'paypal'` + the gateway `ref`. A thin
  `payments/provider.ts` interface (`createCheckout`, `verifyWebhook`) is stubbed now (manual
  provider only) so the gateways are a drop-in.

### Usage debit
- In the runner's existing `run_finished` block (has `orgId` + `costUsd`), fire-and-forget
  `debitOrg(orgId, costUsd→micros, {source:'system', ref:`run:<sessionId>:<ts>`})`. **Only for real
  tenant orgs** (`orgId && orgId !== DEFAULT_ORG_ID` — mirrors the existing `isTenant`); the
  operator workspace isn't metered. Never blocks the run from completing (work's already done).

### Enforcement — observe-first (locked)
- Kill-switch `WALLET_ENFORCE` (default **off**). When **off**: record usage + balance, show a
  **low-balance banner** (`balance < WALLET_LOW_USD`), allow negative (visible as a debt). When
  **on** (later): the run-start path (messages route / `manager.startRun`) **blocks** at
  `balance ≤ 0` with a clear "wallet empty — ask your admin to top up" message.

### Display
- The cost bar / analytics show the org-currency amount with the BDT basis; a **Wallet** card in
  Admin: balance (USD + BDT), top-up form, and the **ledger statement** (date/type/amount/balance/
  ref) with **CSV export** (reuse `analyticsCharts` `downloadCsv`). Formal **invoice PDFs** =
  later phase (we already have HTML→PDF infra).

### Tests
- micro-USD round-trip + `formatMoney`; `creditOrg`/`debitOrg` atomicity + **idempotency**
  (same ref twice = one charge); balance == `SUM(ledger)`; superadmin-only top-up + per-org ledger
  isolation (red-team: org B can't read org A's wallet/ledger); enforcement gate honors the
  kill-switch.

---

## Phasing
1. **BDT display** (Part A) + **wallet schema + `creditOrg`/`debitOrg` + admin top-up + balance/
   ledger view** (Part B core). No enforcement.
2. **Usage debit** on `run_finished` + **low-balance banner** + **CSV statement**.
3. **Hard enforcement** (kill-switch on) + **invoice PDFs**.
4. **Payment gateways** (Stripe/PayPal) via `payments/provider.ts` + org-admin **self-serve top-up**.

## Files
- `shared/currency.ts` (BDT + `pegged` + rate override), `server/src/lib/fx.ts` (new),
  `server/src/wallet/store.ts` (new: wallets + ledger + credit/debit), `server/src/payments/
  provider.ts` (new stub), `server/src/routes/wallet.ts` (+ register), `server/src/db/index.ts`
  (2 tables), `server/src/agent/runner.ts` (debit at `run_finished`), `server/src/routes/orgs.ts`
  (rate setter), client: `AdminDialog` Wallet card + a low-balance banner + cost-bar BDT basis,
  `state` wiring. `FEATURES.md` + `WhatsNewModal`. Tests as above.

## Notes / risks
- Money as **integer micro-USD** end-to-end; never float-add balances.
- The **ledger is the truth**; the cached `balance_micros` is reconcilable.
- Real provider billing is USD → USD-canonical wallet keeps reconciliation exact; BDT is only ever
  a display estimate with a visible rate + date.
