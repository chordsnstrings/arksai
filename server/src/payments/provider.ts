import type { LedgerSource } from '../wallet/store';

/**
 * Payment-gateway abstraction (scaffold). Real providers (Stripe, PayPal, …) are added LATER —
 * this defines the seam so they drop in without touching the wallet. A provider only needs to:
 *  (1) start a checkout for an org + USD amount, and (2) verify an incoming webhook into a
 *  normalized credit that the route hands to `wallet/store.creditOrg(...)`. Today only the
 *  `manual` provider exists (an operator top-up via the admin endpoint), which is just a direct
 *  `creditOrg(source:'manual')` and needs no gateway.
 */

export interface CheckoutRequest {
  orgId: string;
  amountUsd: number;
  /** Where to send the user after pay/cancel (provider hosted checkout). */
  returnUrl?: string;
}
export interface CheckoutSession {
  url: string; // hosted checkout URL to redirect the buyer to
  externalId: string; // the provider's session/intent id (becomes the ledger `ref`)
}

/** A verified, normalized top-up extracted from a gateway webhook. */
export interface VerifiedTopup {
  orgId: string;
  amountUsd: number;
  source: LedgerSource; // 'stripe' | 'paypal'
  ref: string; // provider transaction id → ledger idempotency key
  note?: string;
}

export interface PaymentProvider {
  id: LedgerSource;
  /** Configured + ready (its API keys are set). */
  available(): boolean;
  /** Start a hosted checkout. */
  createCheckout(req: CheckoutRequest): Promise<CheckoutSession>;
  /** Verify a raw webhook payload+signature → a normalized credit, or null if not a paid event. */
  verifyWebhook(rawBody: string, headers: Record<string, string>): Promise<VerifiedTopup | null>;
}

// Registry — empty until Stripe/PayPal land. `availableProviders()` drives the UI's
// "add funds with a card" options; while empty, only operator top-ups exist.
const PROVIDERS: PaymentProvider[] = [];

export function registerProvider(p: PaymentProvider): void {
  PROVIDERS.push(p);
}
export function providerById(id: string): PaymentProvider | undefined {
  return PROVIDERS.find((p) => p.id === id && p.available());
}
export function availableProviders(): { id: string }[] {
  return PROVIDERS.filter((p) => p.available()).map((p) => ({ id: p.id }));
}
