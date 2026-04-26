---
title: Self-Hosting Guide
---

# Self-Hosting Guide

## Prerequisites

- **Docker** and **Docker Compose** v2+
- **Node.js** 20+ and **pnpm** 9+
- A domain or server with ports 3000, 5432, 8123 available

## Quick Start

```bash
# Clone the repository
git clone https://github.com/marlinjai/analytics-platform.git
cd analytics-platform

# Initialize databases (Postgres + ClickHouse)
./scripts/setup.sh

# Install dependencies
pnpm install

# Create environment file
cp .env.example .env
# Edit .env with your settings (see Configuration below)

# Build and start
pnpm build
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Configuration

Create a `.env` file in the project root:

```env
# Database
DATABASE_URL=postgres://analytics:analytics_dev@localhost:5432/analytics

# ClickHouse
CLICKHOUSE_URL=http://localhost:8123
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=clickhouse_dev

# NextAuth v5
AUTH_SECRET=your-secret-here  # generate: openssl rand -base64 32
AUTH_URL=http://localhost:3000

# GitHub OAuth (optional) — auto-discovered by NextAuth v5 from AUTH_GITHUB_* prefix
AUTH_GITHUB_ID=your-github-app-id
AUTH_GITHUB_SECRET=your-github-app-secret

# Password reset emails (Resend)
RESEND_API_KEY=re_your_key_here
RESEND_FROM_EMAIL=noreply@yourdomain.com
```

## Production with Docker Compose

```bash
# Build and start all services
docker compose up -d

# View logs
docker compose logs -f dashboard
```

Database migrations (Postgres and ClickHouse) run automatically on every app startup via the Next.js instrumentation hook. No manual schema initialization is needed. If you want to run them explicitly for local development:

```bash
./scripts/migrate.sh
```

The `docker-compose.yml` includes:
- **PostgreSQL 16** — user/project/API key storage
- **ClickHouse 24** — event analytics storage
- **Dashboard** — Next.js app (API + UI) on port 3000

## Tracker SDK Integration

Install the tracker in your website:

```html
<script type="module">
  import { init } from 'https://your-analytics-host/tracker.js';

  init({
    projectId: 'your-project-uuid',
    endpoint: 'https://your-analytics-host/api/collect',
    replay: false,     // Enable session replay (requires rrweb)
    heatmap: true,     // Track click coordinates
    scrollDepth: true, // Track scroll depth
  });
</script>
```

Or install via npm:

```bash
npm install @marlinjai/analytics-tracker
```

```typescript
import { init } from '@marlinjai/analytics-tracker';

init({
  projectId: 'your-project-uuid',
  endpoint: 'https://your-analytics-host/api/collect',
});
```

## Upgrading

```bash
git pull
pnpm install
pnpm build
docker compose up -d --build dashboard
```

## Data Retention

ClickHouse is configured with a 12-month TTL on the events table. Events older than 12 months are automatically deleted. To change this, modify the TTL in `packages/shared/src/clickhouse-ddl.ts` and re-run the DDL.

## Backup

### PostgreSQL
```bash
docker compose exec postgres pg_dump -U analytics analytics > backup.sql
```

### ClickHouse
```bash
docker compose exec clickhouse clickhouse-client --query \
  "SELECT * FROM analytics.events FORMAT Native" > events_backup.bin
```
