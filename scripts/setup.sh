#!/bin/bash
set -euo pipefail

echo "=== Analytics Platform Setup ==="
echo ""

# Check prerequisites
command -v docker >/dev/null 2>&1 || { echo "Error: docker is required"; exit 1; }
command -v pnpm >/dev/null 2>&1 || { echo "Error: pnpm is required"; exit 1; }

# Start databases
echo "Starting PostgreSQL and ClickHouse..."
docker compose up -d postgres clickhouse

# Wait for healthy
echo "Waiting for databases to be healthy..."
until docker compose exec postgres pg_isready -U analytics >/dev/null 2>&1; do sleep 1; done
until docker compose exec clickhouse clickhouse-client --query "SELECT 1" >/dev/null 2>&1; do sleep 1; done
echo "Databases are ready."

# Run Postgres DDL
echo "Initializing Postgres schema..."
docker compose exec -T postgres psql -U analytics -d analytics <<'SQL'
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email       TEXT NOT NULL UNIQUE,
    name        TEXT,
    avatar_url  TEXT,
    password_hash TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    domain      TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memberships (
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    role        TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'viewer')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, project_id)
);

CREATE TABLE IF NOT EXISTS api_keys (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    key_hash    TEXT NOT NULL,
    prefix      TEXT NOT NULL CHECK (prefix IN ('ap_live_', 'ap_test_')),
    label       TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ,
    revoked_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_api_keys_project ON api_keys(project_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);

-- NextAuth required tables
CREATE TABLE IF NOT EXISTS accounts (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "userId"            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type                TEXT NOT NULL,
    provider            TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    refresh_token       TEXT,
    access_token        TEXT,
    expires_at          INTEGER,
    token_type          TEXT,
    scope               TEXT,
    id_token            TEXT,
    session_state       TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "sessionToken"  TEXT NOT NULL UNIQUE,
    "userId"        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires         TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS verification_tokens (
    identifier  TEXT NOT NULL,
    token       TEXT NOT NULL UNIQUE,
    expires     TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (identifier, token)
);
SQL

# Run ClickHouse DDL
echo "Initializing ClickHouse schema..."
docker compose exec -T clickhouse clickhouse-client --multiquery <<'SQL'
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
    intDiv(toUInt32(x), 10) * 10 AS x_bucket,
    intDiv(toUInt32(y), 10) * 10 AS y_bucket,
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
SQL

echo ""
echo "=== Setup complete! ==="
echo ""
echo "Next steps:"
echo "  1. Copy .env.example to .env and configure:"
echo "     - NEXTAUTH_SECRET (generate with: openssl rand -base64 32)"
echo "     - GITHUB_ID + GITHUB_SECRET (for OAuth)"
echo "  2. Run: pnpm install && pnpm build"
echo "  3. Run: pnpm dev"
echo "  4. Open http://localhost:3000"
