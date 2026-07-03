// PUBLIC payment flow: start a checkout for an order, then confirm on return.
// The confirm step verifies SERVER-SIDE with the provider — a client can never
// mark its own order paid. Rate-limited like every credential-adjacent endpoint.
import { Router } from 'express';
import { nanoid } from 'nanoid';
import { db } from '../db.js';
import { rateLimit } from '../lib/rateLimit.js';
import { providersConfigured, stripeCreateSession, stripeVerifySession, paypalCreateOrder, paypalCaptureOrder } from '../lib/payments.js';

const r = Router();
const limiter = rateLimit({ windowMs: 60_000, max: 30 });

// Which providers are live (drives the buttons the storefront shows).
r.get('/options', (_req, res) => res.json(providersConfigured()));

// A provider error (bad key, declined call) is actionable for the OWNER — surface the
// provider's actual message as a 502 instead of hiding it behind the generic 500.
const providerError = (res, e) => res.status(502).json({ error: `Payment provider error: ${e?.message ?? e}` });

// Start a checkout for a 'new' order → { url } to redirect the buyer to.
r.post('/checkout', limiter, async (req, res) => {
  try {
    const { orderId, provider, returnUrl } = req.body || {};
    const conf = providersConfigured();
    if (!orderId) return res.status(400).json({ error: 'orderId is required' });
    const p = String(provider || (conf.stripe ? 'stripe' : 'paypal'));
    if (!conf[p]) return res.status(400).json({ error: `online payment via ${p} isn't set up — the order stays recorded and the team will arrange payment` });
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(String(orderId));
    if (!order) return res.status(404).json({ error: 'not_found' });
    if (order.status !== 'new') return res.status(400).json({ error: 'this order is already being processed' });
    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);

    const base = String(returnUrl || '').replace(/[?#].*$/, '') || '/';
    const mk = (q) => `${base}${base.includes('?') ? '&' : '?'}${q}`;
    let session;
    if (p === 'stripe') {
      session = await stripeCreateSession({
        order, items,
        successUrl: mk('paid=stripe&session_id={CHECKOUT_SESSION_ID}'),
        cancelUrl: mk('paycancel=1'),
      });
    } else {
      session = await paypalCreateOrder({
        order, totalCents: order.total_cents,
        successUrl: mk('paid=paypal'),
        cancelUrl: mk('paycancel=1'),
      });
    }
    db.prepare('INSERT INTO payments (id, order_id, provider, provider_ref, status, amount_cents, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('pay_' + nanoid(12), order.id, p, session.ref, 'pending', order.total_cents, Date.now());
    res.json({ url: session.url, provider: p });
  } catch (e) { providerError(res, e); }
});

// Confirm on return: verify with the provider, then mark the order paid.
r.post('/confirm', limiter, async (req, res) => {
  try {
    const { provider, sessionId, token } = req.body || {};
    let verdict = null;
    if (provider === 'stripe' && sessionId) verdict = await stripeVerifySession(String(sessionId));
    else if (provider === 'paypal' && token) verdict = await paypalCaptureOrder(String(token));
    else return res.status(400).json({ error: 'provider + its reference are required' });

    if (!verdict.paid || !verdict.orderId) return res.status(402).json({ error: 'the payment has not completed — nothing was charged beyond what the provider shows' });
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(verdict.orderId);
    if (!order) return res.status(404).json({ error: 'not_found' });
    db.prepare("UPDATE payments SET status = 'paid' WHERE order_id = ? AND provider = ?").run(order.id, String(provider));
    if (order.status === 'new') db.prepare("UPDATE orders SET status = 'paid' WHERE id = ?").run(order.id);
    res.json({ ok: true, orderId: order.id, status: 'paid' });
  } catch (e) { providerError(res, e); }
});

export default r;
