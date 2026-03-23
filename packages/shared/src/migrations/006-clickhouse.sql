-- Migration 006: A/B Testing & Experimentation
-- Add experiment columns to events table
-- Materialized views: heatmap_clicks_by_variant_mv, heatmap_selectors_by_variant_mv, experiment_conversions_mv

ALTER TABLE analytics.events ADD COLUMN IF NOT EXISTS experiment_id String DEFAULT '';
ALTER TABLE analytics.events ADD COLUMN IF NOT EXISTS variant String DEFAULT '';

-- Per-variant heatmap aggregation MV (coordinate-based)
CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.heatmap_clicks_by_variant_mv
ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(day)
ORDER BY (project_id, url, experiment_id, variant, device_type, x_bucket, y_bucket, day)
AS SELECT
    project_id, url, experiment_id, variant, device_type,
    toDate(timestamp) AS day,
    intDiv(toUInt32(assumeNotNull(x)), 10) * 10 AS x_bucket,
    intDiv(toUInt32(assumeNotNull(y)), 10) * 10 AS y_bucket,
    count() AS click_count
FROM analytics.events
WHERE type = 'click' AND x IS NOT NULL AND y IS NOT NULL AND experiment_id != ''
GROUP BY project_id, url, experiment_id, variant, device_type, day, x_bucket, y_bucket;

-- Per-variant selector-based heatmap MV
CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.heatmap_selectors_by_variant_mv
ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(day)
ORDER BY (project_id, url, experiment_id, variant, selector, day)
AS SELECT
    project_id, url, experiment_id, variant, selector,
    toDate(timestamp) AS day,
    count() AS click_count,
    uniqExact(session_id) AS session_count
FROM analytics.events
WHERE type = 'click' AND selector != '' AND experiment_id != ''
GROUP BY project_id, url, experiment_id, variant, selector, day;

-- Experiment conversion aggregation MV
CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.experiment_conversions_mv
ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(day)
ORDER BY (project_id, experiment_id, variant, day)
AS SELECT
    project_id,
    experiment_id,
    variant,
    toDate(timestamp) AS day,
    uniqExact(session_id) AS unique_sessions,
    count() AS total_events,
    countIf(type = 'pageview') AS pageviews,
    countIf(type = 'click') AS clicks
FROM analytics.events
WHERE experiment_id != ''
GROUP BY project_id, experiment_id, variant, day;
