-- Migration 003: Add selector-based heatmap materialized view
-- Aggregates clicks by CSS selector for element-based heatmap rendering.
-- The existing heatmap_clicks_mv (x/y coordinate-based) is preserved.

CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.heatmap_selectors_mv
ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(day)
ORDER BY (project_id, url, device_type, selector, day)
AS SELECT
    project_id,
    url,
    device_type,
    toDate(timestamp)              AS day,
    selector,
    count()                        AS click_count,
    uniqExact(session_id)          AS session_count
FROM analytics.events
WHERE type = 'click'
  AND selector != ''
GROUP BY project_id, url, device_type, day, selector;

-- Backfill historical data (run manually, may be slow on large datasets):
--
-- INSERT INTO analytics.heatmap_selectors_mv
-- SELECT
--     project_id, url, device_type,
--     toDate(timestamp) AS day,
--     selector,
--     count() AS click_count,
--     uniqExact(session_id) AS session_count
-- FROM analytics.events
-- WHERE type = 'click' AND selector != ''
-- GROUP BY project_id, url, device_type, day, selector;
