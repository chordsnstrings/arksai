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
