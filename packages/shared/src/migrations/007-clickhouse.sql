-- Migration 007: Environment-aware analytics
-- Server infers environment from API key type + URL hostname during ingestion
ALTER TABLE analytics.events ADD COLUMN IF NOT EXISTS environment LowCardinality(String) DEFAULT 'production';
