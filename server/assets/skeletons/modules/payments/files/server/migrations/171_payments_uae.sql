-- UAE payment rails (Ziina, Telr, N-Genius) + checkout preferences.
ALTER TABLE payment_settings ADD COLUMN ziina_secret TEXT NOT NULL DEFAULT '';
ALTER TABLE payment_settings ADD COLUMN ziina_test INTEGER NOT NULL DEFAULT 1;
ALTER TABLE payment_settings ADD COLUMN telr_store_id TEXT NOT NULL DEFAULT '';
ALTER TABLE payment_settings ADD COLUMN telr_auth_key TEXT NOT NULL DEFAULT '';
ALTER TABLE payment_settings ADD COLUMN telr_test INTEGER NOT NULL DEFAULT 1;
ALTER TABLE payment_settings ADD COLUMN ngenius_api_key TEXT NOT NULL DEFAULT '';
ALTER TABLE payment_settings ADD COLUMN ngenius_outlet_ref TEXT NOT NULL DEFAULT '';
ALTER TABLE payment_settings ADD COLUMN ngenius_live INTEGER NOT NULL DEFAULT 0;
ALTER TABLE payment_settings ADD COLUMN currency_code TEXT NOT NULL DEFAULT 'USD';
ALTER TABLE payment_settings ADD COLUMN default_provider TEXT NOT NULL DEFAULT '';
