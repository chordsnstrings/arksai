// Provider layer — Stripe Checkout + PayPal Orders over plain REST (no SDK deps).
// TRUTH RULE: an order is only marked paid after a SERVER-SIDE verify against the
// provider's API (retrieve session / capture order) — never from a client claim.
// Keys live in payment_settings (the owner pastes them on the in-app Payments page);
// env vars STRIPE_SECRET_KEY / PAYPAL_CLIENT_ID / PAYPAL_SECRET override if present.
import { db } from '../db.js';

export function getSettings() {
  const row = db.prepare('SELECT * FROM payment_settings WHERE id = 1').get() || {};
  return {
    stripeSecretKey: process.env.STRIPE_SECRET_KEY || row.stripe_secret_key || '',
    paypalClientId: process.env.PAYPAL_CLIENT_ID || row.paypal_client_id || '',
    paypalSecret: process.env.PAYPAL_SECRET || row.paypal_secret || '',
    paypalLive: !!row.paypal_live,
  };
}
export function saveSettings(patch) {
  const cur = db.prepare('SELECT * FROM payment_settings WHERE id = 1').get();
  db.prepare('UPDATE payment_settings SET stripe_secret_key = ?, paypal_client_id = ?, paypal_secret = ?, paypal_live = ?, updated_at = ? WHERE id = 1').run(
    patch.stripeSecretKey ?? cur.stripe_secret_key,
    patch.paypalClientId ?? cur.paypal_client_id,
    patch.paypalSecret ?? cur.paypal_secret,
    patch.paypalLive !== undefined ? (patch.paypalLive ? 1 : 0) : cur.paypal_live,
    Date.now(),
  );
}
export const providersConfigured = () => {
  const s = getSettings();
  return { stripe: !!s.stripeSecretKey, paypal: !!(s.paypalClientId && s.paypalSecret) };
};

const form = (obj) => new URLSearchParams(obj).toString();

// ── Stripe (Checkout Sessions; test vs live is decided by the key itself) ──
export async function stripeCreateSession({ order, items, successUrl, cancelUrl, currency = 'usd' }) {
  const { stripeSecretKey } = getSettings();
  const params = { mode: 'payment', success_url: successUrl, cancel_url: cancelUrl, 'metadata[orderId]': order.id, customer_email: order.email };
  items.forEach((it, i) => {
    params[`line_items[${i}][quantity]`] = String(it.qty);
    params[`line_items[${i}][price_data][currency]`] = currency;
    params[`line_items[${i}][price_data][unit_amount]`] = String(it.price_cents);
    params[`line_items[${i}][price_data][product_data][name]`] = it.name.slice(0, 120);
  });
  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${stripeSecretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form(params),
  });
  const d = await res.json();
  if (!res.ok) throw new Error(d?.error?.message || `Stripe error (${res.status})`);
  return { ref: d.id, url: d.url };
}
export async function stripeVerifySession(sessionId) {
  const { stripeSecretKey } = getSettings();
  const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
    headers: { Authorization: `Bearer ${stripeSecretKey}` },
  });
  const d = await res.json();
  if (!res.ok) throw new Error(d?.error?.message || `Stripe error (${res.status})`);
  return { paid: d.payment_status === 'paid', orderId: d.metadata?.orderId || null };
}

// ── PayPal (Orders v2; sandbox unless the owner flips live) ──
const ppBase = () => (getSettings().paypalLive ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com');
async function paypalToken() {
  const { paypalClientId, paypalSecret } = getSettings();
  const res = await fetch(`${ppBase()}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${paypalClientId}:${paypalSecret}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  const d = await res.json();
  if (!res.ok) throw new Error(d?.error_description || `PayPal auth error (${res.status})`);
  return d.access_token;
}
export async function paypalCreateOrder({ order, totalCents, successUrl, cancelUrl, currency = 'USD' }) {
  const token = await paypalToken();
  const res = await fetch(`${ppBase()}/v2/checkout/orders`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [{ reference_id: order.id, amount: { currency_code: currency, value: (totalCents / 100).toFixed(2) } }],
      application_context: { return_url: successUrl, cancel_url: cancelUrl, user_action: 'PAY_NOW', shipping_preference: 'NO_SHIPPING' },
    }),
  });
  const d = await res.json();
  if (!res.ok) throw new Error(d?.message || `PayPal error (${res.status})`);
  const approve = (d.links || []).find((l) => l.rel === 'approve')?.href;
  if (!approve) throw new Error('PayPal did not return an approval link');
  return { ref: d.id, url: approve };
}
export async function paypalCaptureOrder(paypalOrderId) {
  const token = await paypalToken();
  const res = await fetch(`${ppBase()}/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  const d = await res.json();
  // Already-captured is success for our purposes (double return / refresh).
  if (!res.ok && d?.details?.[0]?.issue !== 'ORDER_ALREADY_CAPTURED') throw new Error(d?.message || `PayPal error (${res.status})`);
  const refId = d?.purchase_units?.[0]?.reference_id || null;
  const paid = d?.status === 'COMPLETED' || d?.details?.[0]?.issue === 'ORDER_ALREADY_CAPTURED';
  return { paid, orderId: refId };
}

/* ────────────────────────────────────────────────────────────────────────────
   UAE rails — Ziina (SME-friendly), Telr, N-Genius (Network International).
   Same doctrine as above: hosted pages (Apple Pay/Google Pay appear there
   automatically where the provider supports them), server-verified truth,
   plain REST, no SDK dependencies. Amount units differ per provider:
   Ziina + N-Genius take MINOR units (our cents), Telr takes MAJOR units.
   ──────────────────────────────────────────────────────────────────────── */

export function getSettingsExtended() {
  const row = db.prepare('SELECT * FROM payment_settings WHERE id = 1').get() || {};
  return {
    ...getSettings(),
    ziinaSecret: process.env.ZIINA_SECRET_KEY || row.ziina_secret || '',
    ziinaTest: row.ziina_test !== 0,
    telrStoreId: process.env.TELR_STORE_ID || row.telr_store_id || '',
    telrAuthKey: process.env.TELR_AUTH_KEY || row.telr_auth_key || '',
    telrTest: row.telr_test !== 0,
    ngeniusApiKey: process.env.NGENIUS_API_KEY || row.ngenius_api_key || '',
    ngeniusOutletRef: process.env.NGENIUS_OUTLET_REF || row.ngenius_outlet_ref || '',
    ngeniusLive: !!row.ngenius_live,
    currencyCode: (row.currency_code || 'USD').toUpperCase(),
    defaultProvider: row.default_provider || '',
  };
}
export function saveSettingsExtended(patch) {
  saveSettings(patch);
  const cur = db.prepare('SELECT * FROM payment_settings WHERE id = 1').get();
  db.prepare(
    'UPDATE payment_settings SET ziina_secret=?, ziina_test=?, telr_store_id=?, telr_auth_key=?, telr_test=?, ngenius_api_key=?, ngenius_outlet_ref=?, ngenius_live=?, currency_code=?, default_provider=?, updated_at=? WHERE id = 1',
  ).run(
    patch.ziinaSecret ?? cur.ziina_secret,
    patch.ziinaTest !== undefined ? (patch.ziinaTest ? 1 : 0) : cur.ziina_test,
    patch.telrStoreId ?? cur.telr_store_id,
    patch.telrAuthKey ?? cur.telr_auth_key,
    patch.telrTest !== undefined ? (patch.telrTest ? 1 : 0) : cur.telr_test,
    patch.ngeniusApiKey ?? cur.ngenius_api_key,
    patch.ngeniusOutletRef ?? cur.ngenius_outlet_ref,
    patch.ngeniusLive !== undefined ? (patch.ngeniusLive ? 1 : 0) : cur.ngenius_live,
    (patch.currencyCode ?? cur.currency_code ?? 'USD').toUpperCase().slice(0, 3),
    patch.defaultProvider ?? cur.default_provider,
    Date.now(),
  );
}

/** Every configured provider + which CARD rail the storefront's "Pay now" should use. */
export function allProviders() {
  const s = getSettingsExtended();
  const conf = {
    stripe: !!s.stripeSecretKey,
    paypal: !!(s.paypalClientId && s.paypalSecret),
    ziina: !!s.ziinaSecret,
    telr: !!(s.telrStoreId && s.telrAuthKey),
    ngenius: !!(s.ngeniusApiKey && s.ngeniusOutletRef),
  };
  const CARD_RAILS = ['ziina', 'telr', 'ngenius', 'stripe'];
  const cardProvider = (s.defaultProvider && conf[s.defaultProvider] && s.defaultProvider !== 'paypal')
    ? s.defaultProvider
    : CARD_RAILS.find((p) => conf[p]) || null;
  return { ...conf, cardProvider, currencyCode: s.currencyCode };
}

// ── Ziina: create payment intent → hosted redirect; verify by intent id ──
export async function ziinaCreateIntent({ order, totalCents, successUrl, cancelUrl }) {
  const s = getSettingsExtended();
  const res = await fetch('https://api-v2.ziina.com/api/payment_intent', {
    method: 'POST',
    headers: { Authorization: `Bearer ${s.ziinaSecret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: totalCents,
      currency_code: s.currencyCode,
      message: `Order ${order.id}`,
      success_url: successUrl,
      cancel_url: cancelUrl,
      failure_url: cancelUrl,
      test: s.ziinaTest,
    }),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || !d?.redirect_url) throw new Error(d?.message || `Ziina error (${res.status})`);
  return { ref: d.id, url: d.redirect_url };
}
export async function ziinaVerify(intentId) {
  const s = getSettingsExtended();
  const res = await fetch(`https://api-v2.ziina.com/api/payment_intent/${encodeURIComponent(intentId)}`, {
    headers: { Authorization: `Bearer ${s.ziinaSecret}` },
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d?.message || `Ziina error (${res.status})`);
  return { paid: d.status === 'completed' };
}

// ── Telr: hosted payment page (amounts in MAJOR units); verify by order ref ──
export async function telrCreateOrder({ order, totalCents, successUrl, cancelUrl }) {
  const s = getSettingsExtended();
  const res = await fetch('https://secure.telr.com/gateway/order.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      method: 'create',
      store: Number(s.telrStoreId),
      authkey: s.telrAuthKey,
      order: {
        cartid: `${order.id}-${order.created_at}`, // Telr requires a UNIQUE cart id per attempt
        test: s.telrTest ? '1' : '0',
        amount: (totalCents / 100).toFixed(2),
        currency: s.currencyCode,
        description: `Order ${order.id}`,
      },
      return: { authorised: successUrl, declined: cancelUrl, cancelled: cancelUrl },
    }),
  });
  const d = await res.json().catch(() => ({}));
  if (d?.error) throw new Error(`${d.error.message || 'Telr error'}${d.error.note ? ` — ${d.error.note}` : ''}`);
  if (!d?.order?.url) throw new Error(`Telr error (${res.status})`);
  return { ref: d.order.ref, url: d.order.url };
}
export async function telrVerify(orderRef) {
  const s = getSettingsExtended();
  const res = await fetch('https://secure.telr.com/gateway/order.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method: 'check', store: Number(s.telrStoreId), authkey: s.telrAuthKey, order: { ref: orderRef } }),
  });
  const d = await res.json().catch(() => ({}));
  if (d?.error) throw new Error(d.error.message || 'Telr error');
  const text = String(d?.order?.status?.text || '');
  const code = Number(d?.order?.status?.code || 0);
  const tx = String(d?.order?.transaction?.status || d?.transaction?.status || '');
  return { paid: /^(paid|authori[sz]ed)$/i.test(text) || code === 3 || code === 4 || tx === 'A' };
}

// ── N-Genius (Network International): token → SALE order → hosted paypage ──
const ngBase = () => (getSettingsExtended().ngeniusLive ? 'https://api-gateway.ngenius-payments.com' : 'https://api-gateway.sandbox.ngenius-payments.com');
async function ngeniusToken() {
  const s = getSettingsExtended();
  const res = await fetch(`${ngBase()}/identity/auth/access-token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${s.ngeniusApiKey}`, 'Content-Type': 'application/vnd.ni-identity.v1+json' },
    body: '{}',
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || !d?.access_token) throw new Error(d?.message || `N-Genius auth error (${res.status})`);
  return d.access_token;
}
export async function ngeniusCreateOrder({ order, totalCents, successUrl }) {
  const s = getSettingsExtended();
  const token = await ngeniusToken();
  const res = await fetch(`${ngBase()}/transactions/outlets/${encodeURIComponent(s.ngeniusOutletRef)}/orders`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/vnd.ni-payment.v2+json', Accept: 'application/vnd.ni-payment.v2+json' },
    body: JSON.stringify({
      action: 'SALE',
      amount: { currencyCode: s.currencyCode, value: totalCents },
      emailAddress: order.email,
      merchantAttributes: { redirectUrl: successUrl, skipConfirmationPage: true },
    }),
  });
  const d = await res.json().catch(() => ({}));
  const url = d?._links?.payment?.href;
  if (!res.ok || !url) throw new Error(d?.message || d?.errors?.[0]?.message || `N-Genius error (${res.status})`);
  return { ref: d.reference, url };
}
export async function ngeniusVerify(orderRef) {
  const s = getSettingsExtended();
  const token = await ngeniusToken();
  const res = await fetch(`${ngBase()}/transactions/outlets/${encodeURIComponent(s.ngeniusOutletRef)}/orders/${encodeURIComponent(orderRef)}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.ni-payment.v2+json' },
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d?.message || `N-Genius error (${res.status})`);
  const states = [d?.state, ...((d?._embedded?.payment || []).map((p) => p?.state))].filter(Boolean);
  return { paid: states.some((x) => /PURCHASED|CAPTURED/i.test(String(x))) };
}
