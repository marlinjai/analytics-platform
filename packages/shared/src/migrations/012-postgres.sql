-- Migration 012: Page snapshots for historical heatmap replay
CREATE TABLE IF NOT EXISTS page_snapshots (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    url         TEXT NOT NULL,
    page_hash   TEXT NOT NULL,
    snapshot    JSONB NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, url, page_hash)
);
CREATE INDEX IF NOT EXISTS idx_page_snapshots_lookup
    ON page_snapshots(project_id, url);
