-- Migration 012: Page versioning for historical heatmaps
-- Adds page_hash to events, creates version-aware heatmap MV and version discovery MV

ALTER TABLE analytics.events ADD COLUMN IF NOT EXISTS page_hash String DEFAULT '';

-- Heatmap aggregation partitioned by page version
CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.heatmap_selectors_by_version_mv
ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(day)
ORDER BY (project_id, url, page_hash, device_type, selector, day)
AS SELECT
    project_id, url, page_hash, device_type, selector,
    toDate(timestamp) AS day,
    count() AS click_count,
    uniqExact(session_id) AS session_count
FROM analytics.events
WHERE type = 'click' AND selector != '' AND page_hash != ''
GROUP BY project_id, url, page_hash, device_type, selector, day;

-- Page version discovery: list known versions with date ranges
CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.page_versions_mv
ENGINE = AggregatingMergeTree()
PARTITION BY toYYYYMM(first_seen)
ORDER BY (project_id, url, page_hash)
AS SELECT
    project_id, url, page_hash,
    min(timestamp) AS first_seen,
    max(timestamp) AS last_seen,
    count() AS event_count
FROM analytics.events
WHERE page_hash != '' AND type IN ('pageview', 'click')
GROUP BY project_id, url, page_hash;
