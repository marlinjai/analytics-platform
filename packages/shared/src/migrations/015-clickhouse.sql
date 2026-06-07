-- Migration 015: Re-add browser and OS columns (forward fix for poisoned 002)
--
-- 002-clickhouse.sql was recorded as applied during an early boot when
-- ClickHouse was unreachable (CLICKHOUSE_URL unset), so its browser/os ALTER
-- never actually ran. The columns stayed missing and /api/stats/browsers +
-- /api/stats/os 500'd with UNKNOWN_IDENTIFIER. Because 002 remains marked
-- applied in _migrations, this forward migration re-adds the columns
-- idempotently. The corrected runner now records a ClickHouse migration only
-- after it actually executes, so this cannot be re-poisoned.
-- Run against: analytics.events

ALTER TABLE analytics.events
    ADD COLUMN IF NOT EXISTS browser LowCardinality(String) DEFAULT '',
    ADD COLUMN IF NOT EXISTS os      LowCardinality(String) DEFAULT '';
