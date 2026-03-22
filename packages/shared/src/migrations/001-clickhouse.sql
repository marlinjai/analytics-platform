-- Migration 001: Initial ClickHouse schema
-- Tables: analytics.events
-- Materialized views: pageviews_hourly_mv, heatmap_clicks_mv, sessions_summary_mv

CREATE DATABASE IF NOT EXISTS analytics;

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
    x               Nullable(Float32),
    y               Nullable(Float32),
    selector        String DEFAULT '',
    scroll_depth    Nullable(Float32),
    event_name      String DEFAULT '',
    properties      String DEFAULT '{}',
    replay_chunk    String DEFAULT '',
    screen_width    Nullable(UInt16),
    screen_height   Nullable(UInt16),
    device_type     LowCardinality(String) DEFAULT '',
    user_agent      String DEFAULT '',
    ip_hash         String,
    country         LowCardinality(String) DEFAULT ''
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (project_id, type, timestamp)
TTL toDateTime(timestamp) + INTERVAL 12 MONTH
SETTINGS index_granularity = 8192;

CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.pageviews_hourly_mv
ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(hour)
ORDER BY (project_id, url, hour)
AS SELECT
    project_id, url,
    toStartOfHour(timestamp) AS hour,
    count() AS pageviews,
    uniqExact(ip_hash) AS visitors
FROM analytics.events
WHERE type = 'pageview'
GROUP BY project_id, url, hour;

CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.heatmap_clicks_mv
ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(day)
ORDER BY (project_id, url, device_type, x_bucket, y_bucket, day)
AS SELECT
    project_id, url, device_type,
    toDate(timestamp) AS day,
    intDiv(toUInt32(assumeNotNull(x)), 10) * 10 AS x_bucket,
    intDiv(toUInt32(assumeNotNull(y)), 10) * 10 AS y_bucket,
    count() AS click_count
FROM analytics.events
WHERE type = 'click' AND x IS NOT NULL AND y IS NOT NULL
GROUP BY project_id, url, device_type, day, x_bucket, y_bucket;

CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.sessions_summary_mv
ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(day)
ORDER BY (project_id, session_id, day)
AS SELECT
    project_id, session_id,
    toDate(min(timestamp)) AS day,
    min(timestamp) AS started_at,
    max(timestamp) AS ended_at,
    countIf(type = 'pageview') AS pageviews,
    any(country) AS country,
    any(device_type) AS device_type
FROM analytics.events
GROUP BY project_id, session_id;
