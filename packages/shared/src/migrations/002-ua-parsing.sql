-- Migration 002: Add browser and OS columns derived from user-agent parsing
-- Run against: analytics.events

ALTER TABLE analytics.events
    ADD COLUMN IF NOT EXISTS browser VARCHAR DEFAULT '',
    ADD COLUMN IF NOT EXISTS os      VARCHAR DEFAULT '';
