-- Migration 009: CLI device authorization codes for browser-based auth flow
CREATE TABLE IF NOT EXISTS cli_device_codes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_code TEXT NOT NULL UNIQUE,
    poll_secret TEXT NOT NULL UNIQUE,
    user_id     UUID REFERENCES users(id),
    account_key TEXT,
    status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','expired')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '10 minutes')
);
CREATE INDEX IF NOT EXISTS idx_cli_device_codes_poll ON cli_device_codes(poll_secret);
CREATE INDEX IF NOT EXISTS idx_cli_device_codes_device ON cli_device_codes(device_code);
