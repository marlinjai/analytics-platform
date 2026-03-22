#!/bin/bash
# migrate.sh — Apply pending SQL migrations to Postgres and ClickHouse.
#
# Naming convention for migration files in packages/shared/src/migrations/:
#   NNN-postgres.sql   → applied to PostgreSQL
#   NNN-clickhouse.sql → applied to ClickHouse (each statement separated by semicolons)
#
# Migration state is tracked in the `_migrations` table in Postgres.
# Only migrations that have not yet been applied are executed.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS_DIR="${SCRIPT_DIR}/../packages/shared/src/migrations"

# ── Ensure _migrations tracking table exists ─────────────────────────────────
echo "[migrate] Ensuring _migrations tracking table exists in Postgres..."
docker compose -f "${SCRIPT_DIR}/../docker-compose.yml" exec -T postgres \
  psql -U analytics -d analytics <<'SQL'
CREATE TABLE IF NOT EXISTS _migrations (
    id          SERIAL PRIMARY KEY,
    filename    TEXT NOT NULL UNIQUE,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
SQL

# ── Helper: check if migration has been applied ───────────────────────────────
is_applied() {
  local filename="$1"
  local result
  result=$(docker compose -f "${SCRIPT_DIR}/../docker-compose.yml" exec -T postgres \
    psql -U analytics -d analytics -tAc \
    "SELECT COUNT(*) FROM _migrations WHERE filename = '${filename}';")
  [ "${result}" -gt 0 ]
}

# ── Helper: record applied migration ─────────────────────────────────────────
record_migration() {
  local filename="$1"
  docker compose -f "${SCRIPT_DIR}/../docker-compose.yml" exec -T postgres \
    psql -U analytics -d analytics -c \
    "INSERT INTO _migrations (filename) VALUES ('${filename}');" > /dev/null
}

# ── Collect and sort migration files ─────────────────────────────────────────
mapfile -t POSTGRES_FILES < <(
  ls "${MIGRATIONS_DIR}"/*-postgres.sql 2>/dev/null | sort
)
mapfile -t CLICKHOUSE_FILES < <(
  ls "${MIGRATIONS_DIR}"/*-clickhouse.sql 2>/dev/null | sort
)

APPLIED_COUNT=0
SKIPPED_COUNT=0

# ── Apply Postgres migrations ─────────────────────────────────────────────────
for filepath in "${POSTGRES_FILES[@]}"; do
  filename="$(basename "${filepath}")"
  if is_applied "${filename}"; then
    echo "[migrate] SKIP (already applied): ${filename}"
    SKIPPED_COUNT=$((SKIPPED_COUNT + 1))
    continue
  fi

  echo "[migrate] Applying Postgres migration: ${filename}"
  docker compose -f "${SCRIPT_DIR}/../docker-compose.yml" exec -T postgres \
    psql -U analytics -d analytics < "${filepath}"

  record_migration "${filename}"
  echo "[migrate] OK: ${filename}"
  APPLIED_COUNT=$((APPLIED_COUNT + 1))
done

# ── Apply ClickHouse migrations ───────────────────────────────────────────────
for filepath in "${CLICKHOUSE_FILES[@]}"; do
  filename="$(basename "${filepath}")"
  if is_applied "${filename}"; then
    echo "[migrate] SKIP (already applied): ${filename}"
    SKIPPED_COUNT=$((SKIPPED_COUNT + 1))
    continue
  fi

  echo "[migrate] Applying ClickHouse migration: ${filename}"
  docker compose -f "${SCRIPT_DIR}/../docker-compose.yml" exec -T clickhouse \
    clickhouse-client --multiquery < "${filepath}"

  record_migration "${filename}"
  echo "[migrate] OK: ${filename}"
  APPLIED_COUNT=$((APPLIED_COUNT + 1))
done

echo ""
echo "[migrate] Done. Applied: ${APPLIED_COUNT}, Skipped (already applied): ${SKIPPED_COUNT}."
