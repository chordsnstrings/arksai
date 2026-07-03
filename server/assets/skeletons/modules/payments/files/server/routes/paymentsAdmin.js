// Owner settings (signed-in): paste provider keys, pick the preferred card rail + currency.
// WRITE-ONLY — secrets are never returned over the API, only booleans + key tails.
import { Router } from 'express';
import { db } from '../db.js';
import { getSettingsExtended, saveSettingsExtended, allProviders, binanceSettings, saveBinanceSettings } from '../lib/payments.js';

const r = Router();
const CURRENCIES = ['USD', 'AED', 'SAR', 'EUR', 'GBP', 'KWD', 'BHD', 'QAR', 'OMR', 'EGP', 'INR'];

r.get('/settings', (_req, res) => {
  const s = getSettingsExtended();
  const tail = (v) => (v ? `…${String(v).slice(-4)}` : '');
  res.json({
    ...allProviders(),
    stripeKeyTail: tail(s.stripeSecretKey),
    paypalClientTail: tail(s.paypalClientId),
    paypalLive: s.paypalLive,
    ziinaKeyTail: tail(s.ziinaSecret),
    ziinaTest: s.ziinaTest,
    telrStoreTail: tail(s.telrStoreId),
    telrTest: s.telrTest,
    ngeniusKeyTail: tail(s.ngeniusApiKey),
    ngeniusOutletTail: tail(s.ngeniusOutletRef),
    ngeniusLive: s.ngeniusLive,
    binanceKeyTail: tail(binanceSettings().apiKey),
    defaultProvider: s.defaultProvider,
    currencies: CURRENCIES,
  });
});

r.put('/settings', (req, res) => {
  const b = req.body || {};
  const clean = (v) => (v === undefined ? undefined : String(v).trim().slice(0, 400));
  if (b.currencyCode !== undefined && !CURRENCIES.includes(String(b.currencyCode).toUpperCase()))
    return res.status(400).json({ error: `currency must be one of ${CURRENCIES.join(', ')}` });
  saveSettingsExtended({
    stripeSecretKey: clean(b.stripeSecretKey),
    paypalClientId: clean(b.paypalClientId),
    paypalSecret: clean(b.paypalSecret),
    paypalLive: b.paypalLive,
    ziinaSecret: clean(b.ziinaSecret),
    ziinaTest: b.ziinaTest,
    telrStoreId: clean(b.telrStoreId),
    telrAuthKey: clean(b.telrAuthKey),
    telrTest: b.telrTest,
    ngeniusApiKey: clean(b.ngeniusApiKey),
    ngeniusOutletRef: clean(b.ngeniusOutletRef),
    ngeniusLive: b.ngeniusLive,
    currencyCode: clean(b.currencyCode),
    defaultProvider: clean(b.defaultProvider),
  });
  if (b.binanceApiKey !== undefined || b.binanceSecret !== undefined) {
    saveBinanceSettings({ binanceApiKey: clean(b.binanceApiKey), binanceSecret: clean(b.binanceSecret) });
  }
  res.json({ ok: true, ...allProviders() });
});

// Payment history for the owner (order + provider + status).
r.get('/history', (_req, res) => {
  const rows = db.prepare('SELECT p.*, o.email AS buyer_email FROM payments p LEFT JOIN orders o ON o.id = p.order_id ORDER BY p.created_at DESC LIMIT 200').all();
  res.json(rows.map((p) => ({ id: p.id, orderId: p.order_id, provider: p.provider, status: p.status, amountCents: p.amount_cents, buyerEmail: p.buyer_email, createdAt: p.created_at })));
});

export default r;
