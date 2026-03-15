/**
 * ClickHouse DDL for the analytics platform.
 *
 * Design: one wide `events` table with sparse columns.
 * Three materialized views for common query patterns.
 */

export const CREATE_DATABASE = `CREATE DATABASE IF NOT EXISTS analytics`;

export const CREATE_EVENTS_TABLE = `
CREATE TABLE IF NOT EXISTS analytics.events
(
    event_id        UUID DEFAULT generateUUIDv4(),
    project_id      UUID,
    session_id      String,
    type            LowCardinality(String),
    timestamp       DateTime64(3, 'UTC'),
    received_at     DateTime64(3, 'UTC'),
    url             String,
    referrer        String DEFAULT '',
    title           String DEFAULT '',

    -- Click / Scroll
    x               Nullable(Float32),
    y               Nullable(Float32),
    selector        String DEFAULT '',
    scroll_depth    Nullable(Float32),

    -- Custom events
    event_name      String DEFAULT '',
    properties      String DEFAULT '{}', -- JSON string

    -- Replay
    replay_chunk    String DEFAULT '',   -- JSON string (rrweb events)

    -- Device
    screen_width    Nullable(UInt16),
    screen_height   Nullable(UInt16),
    device_type     LowCardinality(String) DEFAULT '',
    user_agent      String DEFAULT '',

    -- Server-enriched
    ip_hash         String,
    country         LowCardinality(String) DEFAULT ''
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (project_id, type, timestamp)
TTL toDateTime(timestamp) + INTERVAL 12 MONTH
SETTINGS index_granularity = 8192
`;

// ── Materialized Views ───────────────────────────────────────

/** Hourly pageview + visitor counts per project + URL. */
export const CREATE_PAGEVIEWS_MV = `
CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.pageviews_hourly_mv
ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(hour)
ORDER BY (project_id, url, hour)
AS SELECT
    project_id,
    url,
    toStartOfHour(timestamp) AS hour,
    count()                  AS pageviews,
    uniqExact(ip_hash)       AS visitors
FROM analytics.events
WHERE type = 'pageview'
GROUP BY project_id, url, hour
`;

/** Click heatmap aggregation per project + URL + coordinates. */
export const CREATE_HEATMAP_MV = `
CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.heatmap_clicks_mv
ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(day)
ORDER BY (project_id, url, device_type, x_bucket, y_bucket, day)
AS SELECT
    project_id,
    url,
    device_type,
    toDate(timestamp)                    AS day,
    intDiv(toUInt32(x), 10) * 10         AS x_bucket,
    intDiv(toUInt32(y), 10) * 10         AS y_bucket,
    count()                              AS click_count
FROM analytics.events
WHERE type = 'click' AND x IS NOT NULL AND y IS NOT NULL
GROUP BY project_id, url, device_type, day, x_bucket, y_bucket
`;

/** Session summary: duration, pageviews, first/last timestamp. */
export const CREATE_SESSIONS_MV = `
CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.sessions_summary_mv
ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(day)
ORDER BY (project_id, session_id, day)
AS SELECT
    project_id,
    session_id,
    toDate(min(timestamp))               AS day,
    min(timestamp)                        AS started_at,
    max(timestamp)                        AS ended_at,
    countIf(type = 'pageview')           AS pageviews,
    any(country)                         AS country,
    any(device_type)                     AS device_type
FROM analytics.events
GROUP BY project_id, session_id
`;

/** All DDL statements in execution order. */
export const ALL_DDL = [
  CREATE_DATABASE,
  CREATE_EVENTS_TABLE,
  CREATE_PAGEVIEWS_MV,
  CREATE_HEATMAP_MV,
  CREATE_SESSIONS_MV,
] as const;
