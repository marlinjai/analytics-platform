-- Migration 002: Add browser and OS columns derived from user-agent parsing
-- Run against: analytics.events
-- Matches the LowCardinality(String) convention of the sibling enrichment
-- columns (country, device_type) defined in 001-clickhouse.sql.

ALTER TABLE analytics.events
    ADD COLUMN IF NOT EXISTS browser LowCardinality(String) DEFAULT '',
    ADD COLUMN IF NOT EXISTS os      LowCardinality(String) DEFAULT '';
