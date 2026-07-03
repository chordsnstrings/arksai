CREATE TABLE IF NOT EXISTS payment_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  stripe_secret_key TEXT NOT NULL DEFAULT '',
  paypal_client_id TEXT NOT NULL DEFAULT '',
  paypal_secret TEXT NOT NULL DEFAULT '',
  paypal_live INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO payment_settings (id, updated_at) VALUES (1, 0);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,          -- 'stripe' | 'paypal'
  provider_ref TEXT NOT NULL,      -- checkout session id / paypal order id
  status TEXT NOT NULL DEFAULT 'pending', -- pending | paid | failed
  amount_cents INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
