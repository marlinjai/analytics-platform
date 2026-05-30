---
title: Analytics Platform
---

# Analytics Platform

Self-hosted analytics, heatmap, and session replay platform.

## Features

- **Pageview & event tracking** — lightweight browser SDK (<6KB gzip)
- **Click heatmaps** — visualize where users click on any page
- **Session replay** — watch real user sessions with rrweb
- **Privacy-first** — self-hosted, no third-party data sharing, IP hashing
- **Real-time ingestion** — ClickHouse-powered analytics at scale

## Architecture

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Tracker SDK | TypeScript, rrweb | Browser-side data collection |
| Dashboard | Next.js 15, React 19 | API routes + analytics UI |
| Analytics DB | ClickHouse | Event storage & aggregation |
| Config DB | PostgreSQL | Projects, users, API keys |

## Quick Start

```bash
# Clone into ERP suite
git clone https://github.com/marlinjai/analytics-platform.git projects/analytics-platform

# Install dependencies
cd projects/analytics-platform
pnpm install

# Start databases
docker compose up -d postgres clickhouse

# Start dashboard
pnpm dev
```
