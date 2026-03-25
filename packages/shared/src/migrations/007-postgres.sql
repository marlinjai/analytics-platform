-- Migration 007: Account-level API keys
-- These keys are user-scoped (not project-scoped) and grant access
-- to all projects the user is a member of, including project creation.

CREATE TABLE IF NOT EXISTS account_api_keys (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key_hash    TEXT NOT NULL,
    prefix      TEXT NOT NULL CHECK (prefix = 'ap_account_'),
    label       TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ,
    revoked_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_account_api_keys_user ON account_api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_account_api_keys_hash ON account_api_keys(key_hash);
