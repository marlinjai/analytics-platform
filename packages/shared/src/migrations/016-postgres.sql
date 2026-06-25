-- Replay asset rehosting (Phase 1): per-unique-asset capture state.
-- Each absolute asset URL referenced by any replay is fetched server-side once
-- (SSRF-guarded), stored content-addressed in R2, and rewritten at replay read
-- time. One row per unique source URL, deduped across all sessions/projects.
-- See docs/superpowers/plans/2026-06-25-session-replay-asset-rehosting-pipeline.md

CREATE TABLE IF NOT EXISTS replay_assets (
  url_hash     TEXT PRIMARY KEY,          -- sha256(absolute source URL)
  source_url   TEXT NOT NULL,
  r2_key       TEXT,                       -- sha256(content); null until fetched
  content_type TEXT,
  bytes        INTEGER,
  status       TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'ready', 'failed', 'skipped')),
  attempts     INTEGER NOT NULL DEFAULT 0,
  fetched_at   TIMESTAMPTZ,
  last_error   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The fetch worker drains pending rows oldest-first. Partial index on the
-- pending subset; status is constant in the predicate so the key is created_at.
CREATE INDEX IF NOT EXISTS idx_replay_assets_pending
  ON replay_assets (created_at)
  WHERE status = 'pending';
