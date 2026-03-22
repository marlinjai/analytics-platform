-- Migration 004: Add device_model, input_type, viewport dimensions
-- Run against: analytics.events

ALTER TABLE analytics.events
    ADD COLUMN IF NOT EXISTS device_model LowCardinality(String) DEFAULT '';

ALTER TABLE analytics.events
    ADD COLUMN IF NOT EXISTS input_type LowCardinality(String) DEFAULT '';

ALTER TABLE analytics.events
    ADD COLUMN IF NOT EXISTS viewport_width Nullable(UInt16);

ALTER TABLE analytics.events
    ADD COLUMN IF NOT EXISTS viewport_height Nullable(UInt16);
