-- Binance Pay (crypto checkout — USDT settlement).
ALTER TABLE payment_settings ADD COLUMN binance_api_key TEXT NOT NULL DEFAULT '';
ALTER TABLE payment_settings ADD COLUMN binance_secret TEXT NOT NULL DEFAULT '';
