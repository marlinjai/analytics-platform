-- Migration 013: Per-project allowed origins for ingestion gating.
-- Empty array = legacy behavior (allow events from any origin).
-- Populated array = only events whose Origin/Referer matches are accepted.
ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS allowed_origins TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_projects_allowed_origins
    ON projects USING GIN (allowed_origins);
