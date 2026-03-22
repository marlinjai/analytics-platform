-- Migration 003: Funnel Builder tables
-- Tables: funnels

CREATE TABLE IF NOT EXISTS funnels (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    steps       JSONB NOT NULL, -- [{type: 'pageview', url: '/pricing'} | {type: 'custom', eventName: 'signup_click'}]
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_funnels_project ON funnels(project_id);
