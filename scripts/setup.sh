#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== Analytics Platform Setup ==="
echo ""

# Check prerequisites
command -v docker >/dev/null 2>&1 || { echo "Error: docker is required"; exit 1; }
command -v pnpm >/dev/null 2>&1 || { echo "Error: pnpm is required"; exit 1; }

# Start databases
echo "Starting PostgreSQL and ClickHouse..."
docker compose -f "${SCRIPT_DIR}/../docker-compose.yml" up -d postgres clickhouse

# Wait for healthy
echo "Waiting for databases to be healthy..."
until docker compose -f "${SCRIPT_DIR}/../docker-compose.yml" exec postgres pg_isready -U analytics >/dev/null 2>&1; do sleep 1; done
until docker compose -f "${SCRIPT_DIR}/../docker-compose.yml" exec clickhouse clickhouse-client --query "SELECT 1" >/dev/null 2>&1; do sleep 1; done
echo "Databases are ready."

# Run migrations
echo "Running schema migrations..."
bash "${SCRIPT_DIR}/migrate.sh"

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
