// PUBLIC payment flow: start a checkout for an order, then confirm on return.
// Five rails — Stripe, PayPal, Ziina, Telr, N-Genius (Network International) — all through
// hosted pages (Apple Pay / Google Pay / Samsung Pay appear there automatically where the
// provider supports them). The confirm step verifies SERVER-SIDE with the provider — a
// client can never mark its own order paid. Rate-limited like every credential-adjacent
// endpoint.
import { Router } from 'express';
import { nanoid } from 'nanoid';
import { db } from '../db.js';
import { rateLimit } from '../lib/rateLimit.js';
import {
  allProviders,
  stripeCreateSession, stripeVerifySession,
  paypalCreateOrder, paypalCaptureOrder,
  ziinaCreateIntent, ziinaVerify,
  telrCreateOrder, telrVerify,
  ngeniusCreateOrder, ngeniusVerify,
  binanceCreateOrder, binanceVerify,
} from '../lib/payments.js';

const r = Router();
const limiter = rateLimit({ windowMs: 60_000, max: 30 });

// A provider error (bad key, declined call) is actionable for the OWNER — surface the
// provider's actual message as a 502 instead of hiding it behind the generic 500.
const providerError = (res, e) => res.status(502).json({ error: `Payment provider error: ${e?.message ?? e}` });

// Which providers are live + which card rail the storefront's "Pay now" uses.
r.get('/options', (_req, res) => res.json(allProviders()));

// Start a checkout for a 'new' order → { url } to redirect the buyer to.
r.post('/checkout', limiter, async (req, res) => {
  try {
    const { orderId, provider, returnUrl } = req.body || {};
    if (!orderId) return res.status(400).json({ error: 'orderId is required' });
    const conf = allProviders();
    const p = String(provider || conf.cardProvider || (conf.paypal ? 'paypal' : ''));
    if (!p || !conf[p]) return res.status(400).json({ error: "online payment isn't set up — the order stays recorded and the team will arrange payment" });
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(String(orderId));
    if (!order) return res.status(404).json({ error: 'not_found' });
    if (order.status !== 'new') return res.status(400).json({ error: 'this order is already being processed' });
    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);

    const base = String(returnUrl || '').replace(/[?#].*$/, '') || '/';
    const mk = (q) => `${base}${base.includes('?') ? '&' : '?'}${q}`;
    const args = {
      order, items, totalCents: order.total_cents,
      successUrl: mk(`paid=${p}${p === 'stripe' ? '&session_id={CHECKOUT_SESSION_ID}' : `&order=${order.id}`}`),
      cancelUrl: mk('paycancel=1'),
    };
    let session;
    if (p === 'stripe') session = await stripeCreateSession({ ...args, currency: conf.currencyCode.toLowerCase() });
    else if (p === 'paypal') session = await paypalCreateOrder({ ...args, currency: conf.currencyCode, successUrl: mk('paid=paypal') });
    else if (p === 'ziina') session = await ziinaCreateIntent(args);
    else if (p === 'telr') session = await telrCreateOrder(args);
    else if (p === 'binance') session = await binanceCreateOrder(args);
    else session = await ngeniusCreateOrder(args);

    db.prepare('INSERT INTO payments (id, order_id, provider, provider_ref, status, amount_cents, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('pay_' + nanoid(12), order.id, p, session.ref, 'pending', order.total_cents, Date.now());
    res.json({ url: session.url, provider: p });
  } catch (e) { providerError(res, e); }
});

// Confirm on return: verify with the provider, then mark the order paid.
// Stripe returns its session id; PayPal its token; Ziina/Telr/N-Genius are looked up by
// OUR order id → the pending payment row → the stored provider reference.
r.post('/confirm', limiter, async (req, res) => {
  try {
    const { provider, sessionId, token, orderId } = req.body || {};
    const p = String(provider || '');
    let verdict = null;
    let order = null;

    if (p === 'stripe' && sessionId) {
      const v = await stripeVerifySession(String(sessionId));
      verdict = { paid: v.paid };
      order = v.orderId ? db.prepare('SELECT * FROM orders WHERE id = ?').get(v.orderId) : null;
    } else if (p === 'paypal' && token) {
      const v = await paypalCaptureOrder(String(token));
      verdict = { paid: v.paid };
      order = v.orderId ? db.prepare('SELECT * FROM orders WHERE id = ?').get(v.orderId) : null;
    } else if (['ziina', 'telr', 'ngenius', 'binance'].includes(p) && orderId) {
      order = db.prepare('SELECT * FROM orders WHERE id = ?').get(String(orderId));
      const pay = order && db.prepare('SELECT * FROM payments WHERE order_id = ? AND provider = ? ORDER BY created_at DESC').get(order.id, p);
      if (!pay) return res.status(404).json({ error: 'not_found' });
      verdict =
        p === 'ziina' ? await ziinaVerify(pay.provider_ref)
        : p === 'telr' ? await telrVerify(pay.provider_ref)
        : p === 'binance' ? await binanceVerify(pay.provider_ref)
        : await ngeniusVerify(pay.provider_ref);
    } else {
      return res.status(400).json({ error: 'provider + its reference are required' });
    }

    if (!order) return res.status(404).json({ error: 'not_found' });
    if (!verdict?.paid) return res.status(402).json({ error: 'the payment has not completed — nothing was charged beyond what the provider shows' });
    db.prepare("UPDATE payments SET status = 'paid' WHERE order_id = ? AND provider = ?").run(order.id, p);
    if (order.status === 'new') db.prepare("UPDATE orders SET status = 'paid' WHERE id = ?").run(order.id);
    res.json({ ok: true, orderId: order.id, status: 'paid' });
  } catch (e) { providerError(res, e); }
});

export default r;
