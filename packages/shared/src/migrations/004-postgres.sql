-- Migration 004: Project settings for remote SDK configuration
-- Stores arbitrary key/value pairs per project (e.g. feature toggles for the tracker)

CREATE TABLE IF NOT EXISTS project_settings (
    project_id  UUID  NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    key         TEXT  NOT NULL,
    value       TEXT  NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, key)
);

CREATE INDEX IF NOT EXISTS idx_project_settings_project ON project_settings(project_id);
