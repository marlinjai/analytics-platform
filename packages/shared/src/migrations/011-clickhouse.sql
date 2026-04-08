-- Migration 011: Drop pixel-bucket heatmap materialized views
-- Element-based rendering via heatmap_selectors_mv replaces coordinate-based heatmaps
DROP TABLE IF EXISTS analytics.heatmap_clicks_mv;
DROP TABLE IF EXISTS analytics.heatmap_clicks_by_variant_mv;
