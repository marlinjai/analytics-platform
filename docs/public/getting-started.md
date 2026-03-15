---
title: Getting Started
---

# Getting Started

## Prerequisites

- Node.js 20+
- pnpm 9+
- Docker & Docker Compose (for databases)

## Installation

```bash
cd projects/analytics-platform
pnpm install
```

## Start Development Databases

```bash
docker compose up -d postgres clickhouse
```

This starts:
- **PostgreSQL 16** on port 5432 (projects, users, API keys)
- **ClickHouse 24** on port 8123/9000 (event data)

## Start the Dashboard

```bash
pnpm dev
```

Opens at [http://localhost:3000](http://localhost:3000).

## Add the Tracker to Your Site

```html
<script type="module">
  import { init } from 'https://your-cdn.com/analytics-tracker.js';

  init({
    projectId: 'your-project-uuid',
    endpoint: 'http://localhost:3000/api/collect',
  });
</script>
```

Or install via npm:

```bash
pnpm add @marlinjai/analytics-tracker
```

```typescript
import { init } from '@marlinjai/analytics-tracker';

init({
  projectId: 'your-project-uuid',
  endpoint: 'http://localhost:3000/api/collect',
  replay: true,    // Enable session replay
  heatmap: true,   // Enable click heatmaps
});
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | — |
| `CLICKHOUSE_URL` | ClickHouse HTTP endpoint | `http://localhost:8123` |
| `CLICKHOUSE_USER` | ClickHouse username | `default` |
| `CLICKHOUSE_PASSWORD` | ClickHouse password | — |
| `NEXTAUTH_SECRET` | NextAuth session secret | — |
| `NEXTAUTH_URL` | Public URL for NextAuth | `http://localhost:3000` |
