-- Migration 010: Relax prefix check constraints to allow recognition hints
-- The prefix column stores the key type prefix + first 5 chars of the random part
-- (e.g. ap_live_cb744) so users can identify keys without seeing the full value.

ALTER TABLE api_keys
  DROP CONSTRAINT IF EXISTS api_keys_prefix_check,
  ADD CONSTRAINT api_keys_prefix_check
    CHECK (prefix LIKE 'ap_live_%' OR prefix LIKE 'ap_test_%');

ALTER TABLE account_api_keys
  DROP CONSTRAINT IF EXISTS account_api_keys_prefix_check,
  ADD CONSTRAINT account_api_keys_prefix_check
    CHECK (prefix LIKE 'ap_account_%');
